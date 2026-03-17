// server/index.js — Express server + Line Webhook endpoint
// local ใช้ .env ใน root, production ใช้ env จาก Render.com
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
}

const express    = require('express');
const crypto     = require('crypto');
const path       = require('path');
const cors       = require('cors');
const { handleSupplierImage, handleSupplierText } = require('./agent');
const adminRoutes = require('./adminRoutes');
const shopRoutes  = require('./shopRoutes');

const app  = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ------------------------------------------

// CORS สำหรับ web frontend
app.use(cors());
// raw body สำหรับ verify Line signature
app.use('/webhook', express.raw({ type: 'application/json' }));
// JSON สำหรับ endpoint อื่น
app.use(express.json());

// ---- Static files (web pages) ---------------------------
const webDir = path.join(__dirname, '..', 'web');
app.use('/admin', express.static(path.join(webDir, 'admin')));
app.use('/shop',  express.static(path.join(webDir, 'shop')));

// ---- Shop API (public) ----------------------------------
app.use('/api/shop', shopRoutes);

// ---- Admin API ------------------------------------------
app.use('/api/admin', adminRoutes);

// ---- Health check ---------------------------------------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ทดสอบ Supabase connection — ลบ endpoint นี้ออกหลังทดสอบเสร็จ
app.get('/test-db', async (_req, res) => {
  try {
    const { getProducts } = require('./supabase');
    const products = await getProducts();
    res.json({ ok: true, count: products.length, products });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- Line Webhook ---------------------------------------

app.post('/webhook', async (req, res) => {
  // 1. ต้องตอบ 200 ก่อนเสมอ ป้องกัน Line timeout 30 วินาที
  res.status(200).send('OK');

  // DEBUG: log ทุก request ที่เข้ามา
  console.log('[webhook] Received request, body size:', req.body?.length ?? 0);

  // 2. Verify signature
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifyLineSignature(req.body, signature)) {
    console.warn('[webhook] Invalid signature — ignored. Has signature:', !!signature);
    return;
  }

  // 3. Parse events
  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch (e) {
    console.error('[webhook] JSON parse error:', e.message);
    return;
  }

  // 4. Process แต่ละ event แบบ async (ไม่รอ)
  console.log('[webhook] Events count:', body.events?.length ?? 0);
  for (const event of body.events || []) {
    console.log(`[webhook] Event type=${event.type} msgType=${event.message?.type} userId=${event.source?.userId}`);

    if (event.type !== 'message') continue;
    if (event.source.userId !== process.env.SUPPLIER_LINE_USER_ID) continue;

    if (event.message.type === 'image') {
      handleSupplierImage(event).catch(err =>
        console.error('[agent] Unhandled error:', err)
      );
    } else if (event.message.type === 'text') {
      handleSupplierText(event).catch(err =>
        console.error('[agent] Unhandled text error:', err)
      );
    }
  }
});

// ---- Line Login callback (แลก code → profile) -----------
// ใช้สำหรับหน้า shop — frontend จะเรียก GET /auth/line?code=xxx

app.get('/auth/line', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'missing code' });

  try {
    const axios = require('axios');

    // แลก code เอา access_token
    const tokenRes = await axios.post(
      'https://api.line.me/oauth2/v2.1/token',
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  req.query.redirect_uri || process.env.LINE_LOGIN_REDIRECT_URI,
        client_id:     process.env.LINE_LOGIN_CHANNEL_ID,
        client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenRes.data;

    // ดึง profile
    const profileRes = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    res.json(profileRes.data); // { userId, displayName, pictureUrl }
  } catch (err) {
    console.error('[auth/line] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'line_auth_failed' });
  }
});

// ---- Start ----------------------------------------------

app.listen(PORT, () => {
  console.log(`[server] Running on port ${PORT}`);
});

// ---- Helper ---------------------------------------------

function verifyLineSignature(body, signature) {
  const hmac = crypto
    .createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hmac === signature;
}
