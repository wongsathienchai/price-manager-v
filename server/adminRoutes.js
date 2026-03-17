// server/adminRoutes.js — Admin API endpoints
// ทุก route ต้องผ่าน adminAuth middleware (X-Admin-Secret header)
const express = require('express');
const router  = express.Router();
const {
  getProducts, upsertProduct, updateProduct,
  getOrders, updateOrderStatus,
  getPriceHistory,
} = require('./supabase');

// ---- Middleware: ตรวจสอบ admin secret ----------------------
function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(adminAuth);

// ---- Products -------------------------------------------

// GET /api/admin/products
router.get('/products', async (_req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/products/:id
router.patch('/products/:id', async (req, res) => {
  try {
    const allowed = ['sell_price', 'sell_price_locked', 'stock', 'is_available', 'margin_percent', 'name', 'brand', 'shade', 'shade_code', 'product_type', 'origin', 'size', 'unit', 'current_cost'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    const product = await updateProduct(req.params.id, updates);
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Orders ---------------------------------------------

// GET /api/admin/orders?status=pending
router.get('/orders', async (req, res) => {
  try {
    const orders = await getOrders({ status: req.query.status });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/orders/:id
router.patch('/orders/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    const order = await updateOrderStatus(req.params.id, status);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Price History --------------------------------------

// GET /api/admin/price-history/:productId
router.get('/price-history/:productId', async (req, res) => {
  try {
    const history = await getPriceHistory(req.params.productId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
