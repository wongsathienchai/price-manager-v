// server/shopRoutes.js — Public API สำหรับหน้าร้านลูกค้า
const express = require('express');
const router  = express.Router();
const { getProducts, createOrder } = require('./supabase');
const { pushToOwner } = require('./lineService');

// GET /api/shop/products — สินค้าที่เปิดขายและมีสต็อก
router.get('/products', async (_req, res) => {
  try {
    const products = await getProducts({ availableOnly: true });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shop/orders — สร้างออเดอร์ + แจ้งเจ้าของผ่าน Line Notify
router.post('/orders', async (req, res) => {
  const { customer_line_id, customer_name, customer_display_name, note, items } = req.body;

  if (!customer_line_id || !customer_name || !items?.length) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  }

  // คำนวณยอดรวม
  const total_amount = items.reduce((sum, i) => sum + (i.subtotal || 0), 0);

  try {
    const order = await createOrder(
      { customer_line_id, customer_name, customer_display_name, total_amount, note },
      items
    );

    // แจ้งเจ้าของผ่าน Line Notify
    const itemLines = items.map(i =>
      `• ${i.product_name}${i.product_shade ? ` (${i.product_shade})` : ''} x${i.quantity} = ${i.subtotal}฿`
    ).join('\n');

    const msg = `\n🛒 ออเดอร์ใหม่!\n👤 ${customer_name}\n${itemLines}\n💰 ยอดรวม ${total_amount}฿${note ? `\n📝 ${note}` : ''}`;
    await pushToOwner(msg).catch(err =>
      console.error('[shop] Line Notify error:', err.message)
    );

    res.json({ ok: true, orderId: order.id });
  } catch (err) {
    console.error('[shop] createOrder error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
