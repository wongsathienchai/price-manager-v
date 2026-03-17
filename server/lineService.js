// server/lineService.js — Line Messaging API + Line Notify
const axios = require('axios');

// ---- Download รูปจาก Line ------------------------------

/**
 * Download รูปภาพจาก Line Content API
 * @param {string} messageId — event.message.id
 * @returns {Buffer} binary ของรูป
 */
async function downloadImageFromLine(messageId) {
  const res = await axios.get(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
      responseType: 'arraybuffer',
    }
  );
  return Buffer.from(res.data);
}

// ---- Reply กลับใน Line ----------------------------------

/**
 * Reply กลับในห้องแชทของแม่ค้า
 * @param {string} replyToken — event.replyToken
 * @param {string} text — ข้อความที่ต้องการส่ง
 */
async function replyMessage(replyToken, text) {
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [{ type: 'text', text }],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );
}

// ---- Push แจ้งเจ้าของผ่าน Messaging API ----------------

/**
 * ส่งข้อความแจ้งเจ้าของผ่าน Messaging API push
 * @param {string} message — ข้อความ
 */
async function pushToOwner(message) {
  await axios.post(
    'https://api.line.me/v2/bot/message/push',
    {
      to: process.env.SUPPLIER_LINE_USER_ID,
      messages: [{ type: 'text', text: message }],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );
}

module.exports = { downloadImageFromLine, replyMessage, pushToOwner };
