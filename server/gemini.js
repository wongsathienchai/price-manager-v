// server/gemini.js — Gemini Vision API สำหรับอ่านราคาจากรูปภาพ
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const AGENT_PROMPT = `คุณคือ AI อ่านข้อมูลสินค้าจากรูปภาพราคา สำหรับร้านขายเครื่องสำอาง
ตอบกลับเป็น JSON เท่านั้น ห้ามมี markdown หรือคำอธิบายนอก JSON

สินค้าในรูปอาจเป็น:
- เครื่องสำอาง/สกินแคร์ (ลิปสติก, บลัช, รองพื้น, ครีม, เซรั่ม, ฯลฯ)
- กระเป๋าเครื่องสำอาง / กระเป๋าแบรนด์เครื่องสำอาง (cosmetic bag, pouch)
- ชุดของขวัญ / เซ็ตสินค้า (gift set)
- อุปกรณ์แต่งหน้า (แปรง, ฟองน้ำ, ที่รองแป้ง)
- สินค้าอื่นๆ ที่มีในรูปภาพราคา
ข้อความในรูปอาจเป็นภาษาไทย เกาหลี ญี่ปุ่น หรืออังกฤษ

JSON format:
{
  "products": [{
    "name": "ชื่อสินค้า",
    "brand": "แบรนด์",
    "shade": "ชื่อเฉดสี (ถ้ามี)",
    "shade_code": "รหัสเฉดสี เช่น #01 (ถ้ามี)",
    "product_type": "ประเภทสินค้า",
    "origin": "เกาหลี/ญี่ปุ่น/Counter/อื่นๆ",
    "size": "ขนาด เช่น 50ml, 3.5g (ถ้ามี)",
    "price": 350,
    "unit": "ชิ้น/ใบ/ชุด/อัน",
    "confidence": 0.95,
    "is_guessed": false,
    "note": "หมายเหตุ หรือสิ่งที่ไม่แน่ใจ"
  }],
  "raw_text": "ข้อความทั้งหมดที่อ่านได้จากรูป"
}

กฎสำคัญ — ต้องทำตามเสมอ:
1. ต้องส่ง products กลับมาเสมอ ห้ามส่ง array ว่าง ถึงแม้รูปจะไม่ชัด ให้เดาให้ดีที่สุด
2. ถ้าอ่านชื่อสินค้าไม่ออก ให้ใช้ชื่อที่เห็นในรูป หรือตั้งชื่อตามลักษณะ เช่น "กระเป๋าเครื่องสำอาง" / "Cosmetic Bag" / "ลิปสติกสีชมพู"
3. ถ้าไม่แน่ใจ ให้ตั้ง is_guessed: true และเขียน note อธิบายว่าไม่แน่ใจอะไร
4. ต่างเฉดสี = แยก object เสมอ
5. อ่านราคาไม่ได้ = price: null
6. confidence คือความมั่นใจว่าอ่านถูก 0.0-1.0
7. ถ้าเห็นสินค้าหลายรายการในรูปเดียว ให้แยกแต่ละรายการ

product_type ตัวอย่าง:
ลิปสติก, ลิปกลอส, บลัช, ไฮไลท์, รองพื้น, คอนซีลเลอร์, อายแชโดว์, มาสคาร่า,
ครีม, เซรั่ม, โทนเนอร์, ซันสกรีน, มอยส์เจอร์ไรเซอร์,
กระเป๋าเครื่องสำอาง, กระเป๋าแบรนด์, ชุดของขวัญ, แปรงแต่งหน้า, อื่นๆ`;

/**
 * ส่งรูปให้ Gemini Vision อ่านราคาสินค้า
 * @param {Buffer} imageBuffer — binary ของรูปภาพ
 * @returns {{ products: Array, raw_text: string }}
 */
async function readPriceFromImage(imageBuffer) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.1 },
  });

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    },
  };

  let text;
  try {
    const result = await model.generateContent([AGENT_PROMPT, imagePart]);
    text = result.response.text().trim();
  } catch (err) {
    if (err.message?.includes('API_KEY_INVALID')) {
      throw new GeminiError('API_KEY_INVALID', 'GEMINI_API_KEY ไม่ถูกต้อง');
    }
    if (err.message?.includes('QUOTA_EXCEEDED') || err.status === 429) {
      throw new GeminiError('QUOTA_EXCEEDED', 'Gemini quota หมด');
    }
    throw err;
  }

  // ตัด markdown code block ออกถ้ามี
  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new GeminiError('PARSE_ERROR', `Gemini ตอบไม่ใช่ JSON: ${text.slice(0, 200)}`);
  }
}

class GeminiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Parse คำแก้ไขจากผู้ใช้ เพื่ออัปเดตข้อมูลสินค้า
 * @param {Array} products — รายการสินค้าที่ bot เพิ่งบันทึก [{name, brand, shade, price, ...}]
 * @param {string} userText — ข้อความที่ผู้ใช้พิมมา
 * @returns {{ index: number, updates: object, intent: string }}
 */
async function parseCorrection(products, userText) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.1 },
  });

  const productList = products.map((p, i) => {
    const label = p.shade ? `${p.brand} ${p.name} (${p.shade})` : `${p.brand} ${p.name}`;
    return `${i + 1}. ${label} — ราคา ${p.price ?? 'ไม่ระบุ'}฿`;
  }).join('\n');

  const prompt = `สินค้าที่บอทอ่านได้ล่าสุด:
${productList}

ผู้ใช้พิมแก้ไขว่า: "${userText}"

ตอบเป็น JSON เท่านั้น ห้ามมี markdown หรือข้อความอื่น:
{
  "index": 0,
  "updates": {},
  "intent": "correction"
}

กฎ:
- index คือลำดับสินค้า (0-based) ที่ต้องการแก้ไข ถ้าผู้ใช้บอกว่า "รายการที่ 2" ให้ index = 1 ถ้าไม่ระบุให้ใช้ 0
- updates ใส่เฉพาะ field ที่ต้องการเปลี่ยน ได้แก่: name, brand, shade, shade_code, product_type, origin, size, price, unit
- price ต้องเป็น number ไม่ใช่ string
- intent เป็น "correction" ถ้าผู้ใช้ต้องการแก้ไขข้อมูล
- intent เป็น "cancel" ถ้าผู้ใช้บอกยกเลิก/ถูกแล้ว/ไม่ต้องแก้
- intent เป็น "unclear" ถ้าไม่แน่ใจว่าต้องการอะไร`;

  let text;
  try {
    const result = await model.generateContent(prompt);
    text = result.response.text().trim();
  } catch (err) {
    if (err.message?.includes('QUOTA_EXCEEDED') || err.status === 429) {
      throw new GeminiError('QUOTA_EXCEEDED', 'Gemini quota หมด');
    }
    throw err;
  }

  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new GeminiError('PARSE_ERROR', `Gemini ตอบไม่ใช่ JSON: ${text.slice(0, 200)}`);
  }
}

module.exports = { readPriceFromImage, parseCorrection, GeminiError };
