// server/gemini.js — Gemini Vision API สำหรับอ่านราคาจากรูปภาพ
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const AGENT_PROMPT = `คุณคือ AI อ่านราคาเครื่องสำอางจากรูปภาพ
ตอบกลับเป็น JSON เท่านั้น ห้ามมี markdown หรือคำอธิบายนอก JSON

สินค้าคือเครื่องสำอาง/สกินแคร์ อาจเป็นภาษาเกาหลีหรือญี่ปุ่น

JSON format:
{
  "products": [{
    "name": "ชื่อสินค้า",
    "brand": "แบรนด์",
    "shade": "ชื่อเฉดสี",
    "shade_code": "รหัสเฉดสี เช่น #01",
    "product_type": "ลิปสติก/ครีม/เซรั่ม/ฯลฯ",
    "origin": "เกาหลี/ญี่ปุ่น/Counter/อื่นๆ",
    "size": "50ml",
    "price": 350,
    "unit": "ชิ้น",
    "confidence": 0.95,
    "note": "หมายเหตุ"
  }],
  "raw_text": "ข้อความทั้งหมดที่อ่านได้จากรูป"
}

กฎ:
- ต่างเฉดสี = แยก object เสมอ
- อ่านราคาไม่ได้ = price: null, confidence: 0
- confidence คือความมั่นใจว่าอ่านถูก 0.0-1.0`;

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

module.exports = { readPriceFromImage, GeminiError };
