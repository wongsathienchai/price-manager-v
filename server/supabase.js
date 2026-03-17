// server/supabase.js — Supabase client + query functions
// ใช้ SERVICE_ROLE key เพราะเป็น server-side เท่านั้น

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Products -------------------------------------------

/**
 * ดึงสินค้าทั้งหมด (เรียงตาม brand, name)
 */
async function getProducts({ availableOnly = false } = {}) {
  let query = supabase
    .from('products')
    .select('*')
    .order('brand')
    .order('name');

  if (availableOnly) {
    query = query.eq('is_available', true).gt('stock', 0);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * ค้นหาสินค้าด้วย brand + name + shade
 * ใช้สำหรับ AI Agent จับคู่สินค้าที่อ่านจากรูป
 */
async function getProductByMatch(brand, name, shade = null) {
  let query = supabase
    .from('products')
    .select('*')
    .ilike('brand', brand)
    .ilike('name', name);

  if (shade) {
    query = query.ilike('shade', shade);
  } else {
    query = query.is('shade', null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data; // null ถ้าไม่เจอ
}

/**
 * เพิ่มสินค้าใหม่ หรืออัปเดตถ้ามีอยู่แล้ว (upsert ด้วย id)
 * ถ้าไม่มี id ให้ insert ใหม่
 */
async function upsertProduct(data) {
  const { data: result, error } = await supabase
    .from('products')
    .upsert(data, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return result;
}

/**
 * อัปเดต current_cost และ image_url ของสินค้า
 */
async function updateProductCost(productId, newCost, imageUrl = null) {
  const updateData = { current_cost: newCost };
  if (imageUrl) updateData.image_url = imageUrl;
  const { data, error } = await supabase
    .from('products')
    .update(updateData)
    .eq('id', productId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- Price History --------------------------------------

/**
 * บันทึกประวัติราคา ทุกครั้งที่แม่ค้าส่งรูปราคามา
 */
async function addPriceHistory({ productId, costPrice, source = 'line_agent', imageUrl, agentConfidence, rawText, note }) {
  const { data, error } = await supabase
    .from('price_history')
    .insert({
      product_id:       productId,
      cost_price:       costPrice,
      source:           source,
      image_url:        imageUrl || null,
      agent_confidence: agentConfidence || null,
      raw_text:         rawText || null,
      note:             note || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * ดูประวัติราคาของสินค้า (ล่าสุดก่อน)
 */
async function getPriceHistory(productId, limit = 20) {
  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ---- Storage --------------------------------------------

/**
 * อัปโหลดรูปราคาไปเก็บใน Supabase Storage
 * @param {Buffer} buffer — binary ของรูปภาพ
 * @param {string} filename — ชื่อไฟล์ (ไม่มี path prefix)
 * @returns {string} publicUrl ของรูป
 */
async function uploadImage(buffer, filename) {
  const year  = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const path  = `${year}/${month}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from('price-images')
    .upload(path, buffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from('price-images')
    .getPublicUrl(path);

  return data.publicUrl;
}

// ---- Orders ---------------------------------------------

/**
 * สร้างออเดอร์ + order_items พร้อมกัน (transaction-style)
 * @param {object} orderData — { customer_line_id, customer_name, customer_display_name, total_amount, note }
 * @param {Array}  items     — [{ product_id, product_name, product_shade, quantity, unit_price, subtotal }]
 * @returns {object} ออเดอร์ที่สร้างแล้ว
 */
async function createOrder(orderData, items) {
  // 1. สร้าง order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert(orderData)
    .select()
    .single();
  if (orderError) throw orderError;

  // 2. สร้าง order_items
  const itemsWithOrderId = items.map(item => ({
    ...item,
    order_id: order.id,
  }));

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(itemsWithOrderId);
  if (itemsError) throw itemsError;

  return order;
}

/**
 * ดึงออเดอร์พร้อม items (สำหรับ admin)
 */
async function getOrders({ status, limit = 50 } = {}) {
  let query = supabase
    .from('orders')
    .select(`*, order_items(*)`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * เปลี่ยน status ออเดอร์
 */
async function updateOrderStatus(orderId, status) {
  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  supabase,
  // products
  getProducts,
  getProductByMatch,
  upsertProduct,
  updateProductCost,
  // price history
  addPriceHistory,
  getPriceHistory,
  // storage
  uploadImage,
  // orders
  createOrder,
  getOrders,
  updateOrderStatus,
};
