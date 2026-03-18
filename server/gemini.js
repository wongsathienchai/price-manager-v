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

// ลำดับ fallback: ดีสุด → ใช้ได้มากสุด
// gemini-2.5-flash: คุณภาพดีสุด แต่ free tier 20 RPD
// gemini-2.0-flash: คุณภาพดี free tier ~1500 RPD
// gemini-2.0-flash-lite: เร็ว/ถูก free tier ~1500 RPD
const VISION_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

/**
 * ส่งรูปให้ Gemini Vision อ่านราคาสินค้า
 * ถ้า model หลัก quota หมด จะ fallback ไป model รองอัตโนมัติ
 * @param {Buffer} imageBuffer — binary ของรูปภาพ
 * @returns {{ products: Array, raw_text: string }}
 */
async function readPriceFromImage(imageBuffer) {
  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    },
  };

  let lastErr;
  for (const modelName of VISION_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.1 },
      });

      const result = await model.generateContent([AGENT_PROMPT, imagePart]);
      const text = result.response.text().trim();
      if (modelName !== VISION_MODELS[0]) {
        console.log(`[gemini] ใช้ fallback model: ${modelName}`);
      }

      const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      try {
        return JSON.parse(jsonText);
      } catch {
        throw new GeminiError('PARSE_ERROR', `Gemini ตอบไม่ใช่ JSON: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      if (err instanceof GeminiError) throw err; // PARSE_ERROR ไม่ต้อง retry

      if (err.message?.includes('API_KEY_INVALID')) {
        throw new GeminiError('API_KEY_INVALID', 'GEMINI_API_KEY ไม่ถูกต้อง');
      }

      const isQuota = err.message?.includes('QUOTA_EXCEEDED')
        || err.message?.includes('quota')
        || err.status === 429
        || err.message?.includes('429');

      if (isQuota) {
        console.warn(`[gemini] ${modelName} quota หมด → ลอง model ถัดไป`);
        lastErr = err;
        continue; // ลอง model ถัดไป
      }

      throw err; // error อื่นๆ throw ทันที
    }
  }

  // ทุก model quota หมดหมด
  throw new GeminiError('QUOTA_EXCEEDED', 'Gemini quota หมดทุก model แล้ว');
}

class GeminiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Parse คำแก้ไขจากผู้ใช้ — ใช้ regex ก่อน ถ้าซับซ้อนจึง fallback ไป Gemini
 * @param {Array} products — รายการสินค้าที่ bot เพิ่งบันทึก
 * @param {string} userText — ข้อความที่ผู้ใช้พิมมา
 * @returns {{ index: number, updates: object, intent: string }}
 */
async function parseCorrection(products, userText) {
  // ลองด้วย regex ก่อน (เร็ว ไม่เปลือง quota)
  const quick = parseWithRegex(userText);
  if (quick.intent === 'cancel') return quick;
  if (quick.intent === 'correction' && Object.keys(quick.updates).length > 0) return quick;

  // regex ไม่เจอ field ที่ชัดเจน → ใช้ Gemini
  return parseCorrectionWithGemini(products, userText);
}

/**
 * Regex-based parser สำหรับ pattern ทั่วไป
 */
function parseWithRegex(text) {
  const t = text.trim();

  // Cancel intent
  if (/^(โอเค|ถูกแล้ว|ok|ตกลง|cancel|ยกเลิก|ไม่ต้อง|เสร็จแล้ว|จบ)/i.test(t)) {
    return { index: 0, updates: {}, intent: 'cancel' };
  }

  const updates = {};

  // ราคา: "ราคา 450", "ราคา450", "แก้ไขราคา 40 บาท", "ราคาเป็น 450"
  const priceMatch = t.match(/ราคา(?:เป็น|:)?\s*[""]?(\d+(?:\.\d+)?)[""]?/);
  if (priceMatch) updates.price = parseFloat(priceMatch[1]);

  // จำนวน/สต็อก: "จำนวน 300 ชิ้น", "สต็อก 50"
  const stockMatch = t.match(/(?:จำนวน|สต็อก|stock)(?:เป็น|:)?\s*[""]?(\d+)[""]?/i);
  if (stockMatch) updates.stock = parseInt(stockMatch[1]);

  // ชื่อ: "ชื่อเป็น XXX", "ชื่อ XXX"
  const nameMatch = t.match(/ชื่อ(?:เป็น|:)?\s*[""]?([^""\n,]{2,})[""]?/);
  if (nameMatch) updates.name = nameMatch[1].trim();

  // แบรนด์: "แบรนด์ CLIO", "แบรนด์เป็น LANEIGE"
  const brandMatch = t.match(/แบรนด์(?:เป็น|:)?\s*[""]?([^""\n,]{2,})[""]?/i);
  if (brandMatch) updates.brand = brandMatch[1].trim();

  // เฉดสี: "เฉดสี Rose", "shade Rose Gold"
  const shadeMatch = t.match(/(?:เฉดสี|shade)(?:เป็น|:)?\s*[""]?([^""\n,]{2,})[""]?/i);
  if (shadeMatch) updates.shade = shadeMatch[1].trim();

  // ประเภท: "ประเภทเป็น ลิปสติก"
  const typeMatch = t.match(/ประเภท(?:เป็น|:)?\s*[""]?([^""\n,]{2,})[""]?/);
  if (typeMatch) updates.product_type = typeMatch[1].trim();

  // รายการที่: "รายการที่ 2 ..."
  let index = 0;
  const idxMatch = t.match(/รายการ(?:ที่)?\s*(\d+)/);
  if (idxMatch) index = parseInt(idxMatch[1]) - 1;

  const intent = Object.keys(updates).length > 0 ? 'correction' : 'unclear';
  return { index, updates, intent };
}

/**
 * Gemini fallback สำหรับ text ที่ซับซ้อน
 */
async function parseCorrectionWithGemini(products, userText) {
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
{"index":0,"updates":{},"intent":"correction"}

กฎ:
- index คือลำดับสินค้า (0-based) "รายการที่ 2" = index 1 ถ้าไม่ระบุใช้ 0
- updates: field ที่แก้ได้ คือ name, brand, shade, shade_code, product_type, origin, size, price, unit, stock
- price และ stock ต้องเป็น number
- intent: "correction"=แก้ไข, "cancel"=ถูกแล้ว/ยกเลิก, "unclear"=ไม่รู้ว่าต้องการอะไร`;

  let text;
  try {
    const result = await model.generateContent(prompt);
    text = result.response.text().trim();
  } catch (err) {
    if (err.message?.includes('QUOTA_EXCEEDED') || err.status === 429 || err.message?.includes('quota')) {
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
