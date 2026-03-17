// server/agent.js — AI Agent logic หลัก
// โฟลว์: รับรูปจาก Line → Gemini อ่าน → บันทึก Supabase → Reply แม่ค้า
const { readPriceFromImage, parseCorrection, GeminiError } = require('./gemini');
const { downloadImageFromLine, replyMessage, pushToOwner } = require('./lineService');
const {
  getProductByMatch,
  upsertProduct,
  updateProduct,
  updateProductCost,
  addPriceHistory,
  uploadImage,
} = require('./supabase');

// ---- Session store (จำผลล่าสุดของแต่ละ user ไว้ 10 นาที) ----
const SESSION_TTL = 10 * 60 * 1000;
const sessions = new Map();

function saveSession(userId, products) {
  sessions.set(userId, { products, expiresAt: Date.now() + SESSION_TTL });
}

function getSession(userId) {
  const session = sessions.get(userId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(userId);
    return null;
  }
  return session;
}

function clearSession(userId) {
  sessions.delete(userId);
}

// เปลี่ยนต่ำกว่านี้จะ push แจ้งเจ้าของ (30%)
const PRICE_ALERT_THRESHOLD = 30;

/**
 * จัดการ event รูปภาพจากแม่ค้า
 * เรียกจาก index.js แบบ async (ไม่ block HTTP response)
 */
async function handleSupplierImage(event) {
  const { replyToken, message, source } = event;
  const userId = source.userId;

  try {
    // 1. Download รูปจาก Line
    console.log(`[agent] Downloading image ${message.id}...`);
    const imageBuffer = await downloadImageFromLine(message.id);

    // 2. Upload รูปไปเก็บใน Supabase Storage
    const timestamp = Date.now();
    const filename  = `${timestamp}_incoming.jpg`;
    const imageUrl  = await uploadImage(imageBuffer, filename);
    console.log(`[agent] Image stored: ${imageUrl}`);

    // 3. ส่งรูปให้ Gemini อ่านราคา
    console.log('[agent] Sending to Gemini...');
    const geminiResult = await readPriceFromImage(imageBuffer);
    const { products: parsed, raw_text } = geminiResult;

    if (!parsed || parsed.length === 0) {
      await replyMessage(replyToken, MSG_CANT_READ);
      return;
    }

    // 4. Process แต่ละสินค้าที่อ่านได้
    const results = [];
    for (const item of parsed) {
      const result = await processProduct(item, imageUrl, raw_text);
      results.push(result);
    }

    // 5. Reply กลับแม่ค้า
    const replyText = buildReplyText(results);
    await replyMessage(replyToken, replyText);

    // 5.1 บันทึก session ไว้ให้แก้ไขได้ภายใน 10 นาที
    saveSession(userId, results);

    // 6. แจ้งเจ้าของถ้ามีราคาเปลี่ยนเกิน threshold
    const highChanges = results.filter(
      r => !r.isNew && Math.abs(r.changePercent) >= PRICE_ALERT_THRESHOLD
    );
    if (highChanges.length > 0) {
      const alertText = buildAlertText(highChanges);
      await pushToOwner(alertText).catch(err =>
        console.error('[agent] pushToOwner error:', err.message)
      );
    }

    console.log(`[agent] Done. Processed ${results.length} products.`);

  } catch (err) {
    console.error('[agent] Error:', err);

    if (err instanceof GeminiError && err.code === 'PARSE_ERROR') {
      await replyMessage(replyToken, MSG_CANT_READ).catch(() => {});
    } else if (err instanceof GeminiError && err.code === 'QUOTA_EXCEEDED') {
      await replyMessage(replyToken, '⚠️ AI quota หมดแล้ว กรุณาลองใหม่พรุ่งนี้').catch(() => {});
    } else {
      await replyMessage(replyToken, '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง').catch(() => {});
    }
  }
}

// ---- Process สินค้าแต่ละรายการ -------------------------

async function processProduct(item, imageUrl, rawText) {
  const { name, brand, shade, shade_code, product_type, origin, size, unit, price, confidence, note, is_guessed } = item;

  // ค้นหาสินค้าที่มีอยู่แล้ว
  let product = await getProductByMatch(brand, name, shade);
  const isNew = !product;
  let oldCost = null;
  let changePercent = 0;

  if (isNew) {
    // สร้างสินค้าใหม่
    product = await upsertProduct({
      name:          name || 'ไม่ระบุ',
      brand:         brand || 'ไม่ระบุ',
      shade:         shade || null,
      shade_code:    shade_code || null,
      product_type:  product_type || null,
      origin:        origin || 'อื่นๆ',
      size:          size || null,
      unit:          unit || 'ชิ้น',
      current_cost:  price || null,
      image_url:     imageUrl || null,
      stock:         0,
      is_available:  false, // ยังไม่เปิดขายจนกว่าเจ้าของจะตั้งราคา
    });
    console.log(`[agent] New product: ${brand} ${name} (${shade})`);
  } else {
    oldCost = product.current_cost;

    if (price !== null && price !== undefined && oldCost !== null) {
      changePercent = Math.round(((price - oldCost) / oldCost) * 100);
    }

    // อัปเดต current_cost และ image_url ถ้ามีราคาใหม่
    if (price !== null && price !== undefined) {
      await updateProductCost(product.id, price, imageUrl);
    }
  }

  // บันทึก price_history ทุกครั้ง
  if (price !== null && price !== undefined) {
    // ถ้า AI เดา ให้เพิ่ม note แจ้งเตือน admin
    const historyNote = is_guessed
      ? `[AI เดา — รอ admin ยืนยัน] ${note || ''}`.trim()
      : (note || null);

    await addPriceHistory({
      productId:       product.id,
      costPrice:       price,
      source:          'line_agent',
      imageUrl,
      agentConfidence: confidence || null,
      rawText,
      note:            historyNote,
    });
  }

  return { id: product.id, brand, name, shade, price, isNew, oldCost, changePercent, confidence, isGuessed: !!is_guessed };
}

// ---- สร้างข้อความ Reply ---------------------------------

function buildReplyText(results) {
  const lines = results.map(r => {
    const label = r.shade ? `${r.brand} ${r.name} (${r.shade})` : `${r.brand} ${r.name}`;
    const priceStr = r.price != null ? `${r.price}฿` : 'ไม่ระบุราคา';

    let status;
    if (r.isNew) {
      status = '🔵 ใหม่';
    } else if (r.changePercent >= PRICE_ALERT_THRESHOLD) {
      status = `🔴 ขึ้น ${r.changePercent}%`;
    } else if (r.changePercent > 0) {
      status = `🟡 ขึ้น ${r.changePercent}%`;
    } else if (r.changePercent < 0) {
      status = `🟢 ลด ${Math.abs(r.changePercent)}%`;
    } else {
      status = '⚪ เท่าเดิม';
    }

    // แจ้งเตือนถ้า AI เดาข้อมูล
    const guessTag = r.isGuessed ? ' ❓เดา' : '';

    return `• ${label} — ${priceStr} ${status}${guessTag}`;
  });

  const guessCount = results.filter(r => r.isGuessed).length;
  const guessWarning = guessCount > 0
    ? `\n\n❓ มี ${guessCount} รายการที่ AI เดา — กรุณาเข้า Admin ยืนยันข้อมูล`
    : '';

  return `✅ รับราคาแล้ว ${results.length} รายการ\n\n${lines.join('\n')}${guessWarning}`;
}

function buildAlertText(highChanges) {
  const lines = highChanges.map(r => {
    const label = r.shade ? `${r.brand} ${r.name} (${r.shade})` : `${r.brand} ${r.name}`;
    const dir   = r.changePercent > 0 ? 'ขึ้น' : 'ลด';
    return `• ${label}: ${r.oldCost}฿ → ${r.price}฿ (${dir} ${Math.abs(r.changePercent)}%)`;
  });

  return `\n⚠️ ราคาเปลี่ยนแปลงเกิน ${PRICE_ALERT_THRESHOLD}%\n${lines.join('\n')}`;
}

const MSG_CANT_READ =
  '❌ อ่านรูปไม่ได้ครับ กรุณาส่งรูปใหม่ที่ชัดขึ้น\n(รูปอาจมืดเกิน หรือตัวหนังสือเล็กเกินไป)';

// ---- จัดการข้อความแก้ไขจากผู้ใช้ -------------------------

/**
 * รับข้อความแก้ไขจากผู้ใช้ → parse → update Supabase
 */
async function handleSupplierText(event) {
  const { replyToken, message, source } = event;
  const userId = source.userId;
  const text = message.text.trim();

  const session = getSession(userId);
  if (!session) {
    await replyMessage(replyToken, '📸 กรุณาส่งรูปราคาก่อนนะครับ').catch(() => {});
    return;
  }

  let correction;
  try {
    correction = await parseCorrection(session.products, text);
  } catch (err) {
    console.error('[agent] parseCorrection error:', err.message);
    await replyMessage(replyToken, '❌ เกิดข้อผิดพลาดในการ parse คำแก้ไข').catch(() => {});
    return;
  }

  if (correction.intent === 'cancel') {
    clearSession(userId);
    await replyMessage(replyToken, '👍 โอเคครับ ข้อมูลถูกต้องแล้ว').catch(() => {});
    return;
  }

  if (correction.intent === 'unclear') {
    await replyMessage(
      replyToken,
      '❓ ไม่เข้าใจครับ ลองพิมแบบนี้นะครับ:\n' +
      '• "ชื่อเป็น XXX"\n' +
      '• "ราคา 450"\n' +
      '• "แบรนด์ CLIO"\n' +
      '• "รายการที่ 2 ราคา 350"'
    ).catch(() => {});
    return;
  }

  // หาสินค้าที่จะแก้ไข
  const idx = correction.index ?? 0;
  const product = session.products[idx];

  if (!product?.id) {
    await replyMessage(replyToken, `❌ ไม่พบรายการที่ ${idx + 1} ครับ`).catch(() => {});
    return;
  }

  if (!correction.updates || Object.keys(correction.updates).length === 0) {
    await replyMessage(replyToken, '❓ ไม่มีข้อมูลที่จะแก้ไขครับ').catch(() => {});
    return;
  }

  try {
    // Map field names จาก correction → column ใน Supabase
    const FIELD_MAP = { price: 'current_cost' };
    const FIELD_LABELS = {
      name: 'ชื่อ', brand: 'แบรนด์', shade: 'เฉดสี',
      shade_code: 'รหัสเฉดสี', product_type: 'ประเภท',
      origin: 'แหล่งที่มา', size: 'ขนาด', price: 'ราคา',
      unit: 'หน่วย', stock: 'จำนวน',
    };

    const dbUpdates = {};
    for (const [k, v] of Object.entries(correction.updates)) {
      dbUpdates[FIELD_MAP[k] ?? k] = v;
    }

    const updated = await updateProduct(product.id, dbUpdates);

    // อัปเดต session ให้ตรงกับข้อมูลล่าสุด
    session.products[idx] = { ...product, ...correction.updates };

    const label = updated.shade
      ? `${updated.brand} ${updated.name} (${updated.shade})`
      : `${updated.brand} ${updated.name}`;

    const changedFields = Object.keys(correction.updates)
      .map(k => `${FIELD_LABELS[k] ?? k}: ${correction.updates[k]}`)
      .join(', ');

    await replyMessage(
      replyToken,
      `✅ แก้ไขแล้วครับ\n${label}\n(${changedFields})\n\nจะแก้ไขเพิ่มเติมหรือเปล่าครับ?`
    ).catch(() => {});

    console.log(`[agent] Corrected product ${product.id}: ${changedFields}`);
  } catch (err) {
    console.error('[agent] updateProduct error:', err.message);
    await replyMessage(replyToken, '❌ แก้ไขไม่สำเร็จ กรุณาลองใหม่').catch(() => {});
  }
}

module.exports = { handleSupplierImage, handleSupplierText };
