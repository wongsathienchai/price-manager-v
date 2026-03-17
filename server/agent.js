// server/agent.js — AI Agent logic หลัก
// โฟลว์: รับรูปจาก Line → Gemini อ่าน → บันทึก Supabase → Reply แม่ค้า
const { readPriceFromImage, GeminiError } = require('./gemini');
const { downloadImageFromLine, replyMessage, pushToOwner } = require('./lineService');
const {
  getProductByMatch,
  upsertProduct,
  updateProductCost,
  addPriceHistory,
  uploadImage,
} = require('./supabase');

// เปลี่ยนต่ำกว่านี้จะ push แจ้งเจ้าของ (30%)
const PRICE_ALERT_THRESHOLD = 30;

/**
 * จัดการ event รูปภาพจากแม่ค้า
 * เรียกจาก index.js แบบ async (ไม่ block HTTP response)
 */
async function handleSupplierImage(event) {
  const { replyToken, message } = event;

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

  return { brand, name, shade, price, isNew, oldCost, changePercent, confidence, isGuessed: !!is_guessed };
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

module.exports = { handleSupplierImage };
