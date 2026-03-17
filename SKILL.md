# SKILL.md — Price Manager (V2+V3 Combined)
## ระบบจัดการราคาเครื่องสำอาง + หน้าร้านลูกค้า + AI Agent Line

> อ่านไฟล์นี้ทั้งหมดก่อนเขียนโค้ดทุกครั้ง
> อ่าน CHANGELOG.md ควบคู่เพื่อดูว่าทำอะไรไปแล้ว

---

## 🎯 บริบทธุรกิจ

| หัวข้อ | รายละเอียด |
|--------|-----------|
| ธุรกิจ | พ่อค้าคนกลางขายเครื่องสำอาง (Counter Brand / เกาหลี / ญี่ปุ่น) |
| สินค้า | 100–200 รายการ เลือกเฉพาะตัวขายดี |
| แม่ค้า supplier | 1 คน — ส่งรูปราคาใน Line OA |
| ลูกค้า | หลายคน — Login ด้วย Line แล้วสั่งผ่านลิ้ง |
| เจ้าของระบบ | ไม่มีพื้นฐาน Coding แต่เคยใช้ Supabase มาแล้ว |
| ประสบการณ์ | เคยทำโปรเจกต์เก็บข้อมูลหวยใน Supabase |

### โฟลว์ทั้งระบบ
```
[แม่ค้า] ส่งรูปราคาใน Line OA
    ↓
[Line Webhook] ส่ง event มาที่ Server
    ↓
[AI Agent] Gemini อ่านรูป → วิเคราะห์ราคา → เปรียบเทียบของเก่า
    ↓
[Supabase] บันทึกราคา + เก็บรูปใน Storage
    ↓
[Line Reply] แจ้งแม่ค้า "✅ บันทึกแล้ว ราคาเปลี่ยน X%"
    ↓
[แจ้งเจ้าของ] สรุปรายการที่อัปเดต + แจ้งถ้าราคาขึ้นเกิน 30%

[ลูกค้า] เปิดลิ้ง → Login Line → เลือกสินค้า → ใส่ตะกร้า → ยืนยัน
    ↓
[Line Notify] ส่งออเดอร์มาหาเจ้าของใน Line ทันที
```

---

## 🏗️ Architecture

```
price-manager/
├── SKILL.md                   ← ไฟล์นี้
├── CHANGELOG.md               ← บันทึกสิ่งที่ทำไปแล้ว (อัปเดตทุกครั้ง)
├── .env                       ← API Keys ทั้งหมด (ห้าม commit)
├── .env.example               ← template ตัวอย่าง (commit ได้)
│
├── server/                    ← Node.js Backend (deploy บน Render.com)
│   ├── index.js               ← Express server + Webhook endpoint
│   ├── agent.js               ← AI Agent logic หลัก
│   ├── gemini.js              ← Gemini Vision API
│   ├── lineService.js         ← Line Messaging API (reply/push)
│   ├── supabase.js            ← Supabase client + queries
│   └── package.json
│
├── web/                       ← Frontend (deploy บน Vercel หรือ Netlify ฟรี)
│   ├── admin/
│   │   └── index.html         ← หน้าจัดการราคา/สต็อก (เจ้าของใช้)
│   ├── shop/
│   │   └── index.html         ← หน้าร้านลูกค้า (Login Line + สั่งซื้อ)
│   └── shared/
│       ├── style.css          ← CSS รวม
│       └── supabase-client.js ← Supabase JS client
│
└── archive/
    └── SKILL_v1.md            ← เวอร์ชันเก่า (เก็บอ้างอิง)
```

---

## 🗄️ Supabase Schema

### ⚠️ กฎการ Migration
- **ห้ามลบ column เก่า** — แค่เพิ่ม column ใหม่เสมอ
- **column ใหม่ต้องมี DEFAULT value** เสมอ
- **เพิ่ม version ใน schema** เพื่อ track การเปลี่ยนแปลง

### Tables

```sql
-- 1. สินค้า
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  shade TEXT,
  shade_code TEXT,
  product_type TEXT,
  origin TEXT CHECK (origin IN ('เกาหลี','ญี่ปุ่น','Counter','อื่นๆ')),
  size TEXT,
  unit TEXT DEFAULT 'ชิ้น',
  current_cost NUMERIC(10,2),
  sell_price NUMERIC(10,2),
  sell_price_locked BOOLEAN DEFAULT false,
  margin_percent NUMERIC(5,2),
  stock INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. ประวัติราคา (ทุกครั้งที่แม่ค้าส่งราคามา)
CREATE TABLE price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  cost_price NUMERIC(10,2) NOT NULL,
  source TEXT DEFAULT 'line_agent',  -- 'line_agent' | 'manual'
  image_url TEXT,                    -- URL รูปใน Supabase Storage
  agent_confidence NUMERIC(3,2),     -- 0.00–1.00 ความมั่นใจของ AI
  raw_text TEXT,                     -- ข้อความดิบที่ AI อ่านได้
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. ออเดอร์ลูกค้า
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_line_id TEXT NOT NULL,    -- LINE userId
  customer_name TEXT NOT NULL,
  customer_display_name TEXT,        -- ชื่อใน Line profile
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  total_amount NUMERIC(10,2),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. รายการในออเดอร์
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,        -- snapshot ชื่อตอนสั่ง
  product_shade TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL, -- snapshot ราคาตอนสั่ง
  subtotal NUMERIC(10,2) NOT NULL
);
```

### Supabase Storage
```
Bucket: price-images
  ├── policy: authenticated upload only (แม่ค้า + เจ้าของเท่านั้น)
  └── policy: public read (ทุกคนดูรูปได้ผ่าน URL)

โครงสร้างไฟล์:
  price-images/
  └── {year}/{month}/{timestamp}_{product_id}.jpg
```

### Row Level Security (RLS)
```sql
-- products: ทุกคนดูได้ แค่ admin แก้ได้
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read products" ON products FOR SELECT USING (true);
CREATE POLICY "Admin write products" ON products FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- orders: ลูกค้าดูเฉพาะออเดอร์ตัวเอง
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customer read own orders" ON orders FOR SELECT
  USING (customer_line_id = auth.jwt() ->> 'sub');
```

---

## 🤖 AI Agent Logic (server/agent.js)

### Flow การทำงาน
```
รับ event จาก Line Webhook
  ↓
เช็คว่าเป็น image message และมาจากแม่ค้า (whitelist LINE userId)
  ↓
Download รูปจาก Line Content API
  ↓
Upload รูปไปเก็บใน Supabase Storage → ได้ image_url
  ↓
ส่งรูป (base64) ให้ Gemini Vision อ่านราคา
  ↓
Gemini ตอบกลับเป็น JSON รายการสินค้า+ราคา
  ↓
สำหรับแต่ละสินค้าที่อ่านได้:
  - ค้นหาใน products table (match ด้วย brand + name + shade)
  - ถ้าเจอ: เปรียบเทียบราคา คำนวณ % เปลี่ยนแปลง
  - ถ้าไม่เจอ: สร้าง product ใหม่
  - บันทึก price_history ทุกรายการ
  - อัปเดต current_cost ใน products
  ↓
สรุปผลและ Reply กลับแม่ค้าใน Line
  ↓
Push แจ้งเจ้าของ (ถ้าราคาเปลี่ยนเกิน threshold)
```

### Gemini Prompt สำหรับ Agent
```javascript
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
- confidence คือความมั่นใจว่าอ่านถูก 0.0-1.0
- temperature: 0.1 (ความแม่นยำสูง)`;
```

### ข้อความ Reply กลับแม่ค้า
```javascript
// กรณีปกติ
`✅ รับราคาแล้ว ${products.length} รายการ

${products.map(p => {
  const change = p.isNew ? '🔵 ใหม่' :
    p.changePercent > 30 ? `🔴 ขึ้น ${p.changePercent}%` :
    p.changePercent > 0  ? `🟡 ขึ้น ${p.changePercent}%` :
    p.changePercent < 0  ? `🟢 ลด ${Math.abs(p.changePercent)}%` : '⚪ เท่าเดิม';
  return `• ${p.brand} ${p.name}${p.shade ? ` (${p.shade})` : ''} — ${p.price}฿ ${change}`;
}).join('\n')}`;

// กรณี AI อ่านไม่ได้
`❌ อ่านรูปไม่ได้ครับ กรุณาส่งรูปใหม่ที่ชัดขึ้น
(รูปอาจมืดเกิน หรือตัวหนังสือเล็กเกินไป)`;
```

---

## 🌐 Line Integration

### สิ่งที่ต้องสมัคร/ตั้งค่า
```
1. Line Developers Console (developers.line.biz)
   → สร้าง Provider
   → สร้าง Messaging API Channel (สำหรับรับรูปจากแม่ค้า)
   → เปิดใช้ Webhook
   → ปิด Auto-reply และ Greeting message

2. Line Login Channel (สำหรับลูกค้า Login)
   → สร้าง Line Login Channel แยกต่างหาก
   → เพิ่ม Callback URL: https://your-domain.com/auth/line/callback

3. Line Notify (สำหรับแจ้งเจ้าของ)
   → notify-bot.line.me
   → Generate token ส่วนตัว
```

### Webhook Endpoint
```javascript
// server/index.js
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  // 1. Verify signature จาก Line (สำคัญมาก — ป้องกัน fake request)
  const signature = req.headers['x-line-signature'];
  if (!verifySignature(req.body, signature)) {
    return res.status(401).send('Unauthorized');
  }

  const events = JSON.parse(req.body).events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'image') {
      // เช็คว่าเป็นแม่ค้า (whitelist)
      if (event.source.userId === process.env.SUPPLIER_LINE_USER_ID) {
        await handleSupplierImage(event);
      }
    }
  }
  res.status(200).send('OK'); // ต้องตอบ 200 ภายใน 30 วินาที
});
```

### Line Login สำหรับลูกค้า
```javascript
// web/shop/index.html
// ขั้นตอน:
// 1. ปุ่ม "Login ด้วย Line" → redirect ไป Line OAuth
// 2. Line redirect กลับมาพร้อม code
// 3. แลก code เอา access_token
// 4. ดึง profile (userId, displayName, pictureUrl)
// 5. เก็บ userId ใน localStorage สำหรับ session

const LINE_LOGIN_URL = `https://access.line.me/oauth2/v2.1/authorize?` +
  `response_type=code&` +
  `client_id=${LINE_LOGIN_CHANNEL_ID}&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  `state=${randomState}&` +
  `scope=profile%20openid`;
```

---

## 💻 Tech Stack

```
Backend:   Node.js + Express
AI:        Gemini 2.0 Flash API (ฟรี)
Database:  Supabase (PostgreSQL + Storage + Auth)
Line:      Messaging API + Line Login + Line Notify
Deploy:    Render.com (backend ฟรี) + Vercel (frontend ฟรี)
```

### Environment Variables (.env)
```env
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx          # สำหรับ server (full access)
SUPABASE_ANON_KEY=xxx             # สำหรับ frontend (limited access)

# Gemini
GEMINI_API_KEY=xxx

# Line Messaging API (รับรูปจากแม่ค้า)
LINE_CHANNEL_SECRET=xxx
LINE_CHANNEL_ACCESS_TOKEN=xxx

# Line Login (ลูกค้า login)
LINE_LOGIN_CHANNEL_ID=xxx
LINE_LOGIN_CHANNEL_SECRET=xxx

# Line Notify (แจ้งเจ้าของ)
LINE_NOTIFY_TOKEN=xxx

# ความปลอดภัย
SUPPLIER_LINE_USER_ID=xxx         # LINE userId ของแม่ค้า (whitelist)
ADMIN_SECRET=xxx                  # password สำหรับเข้าหน้า admin
```

---

## 📱 UI Pages

### 1. Admin Panel (web/admin/index.html)
ใช้งานบนมือถือได้ — เจ้าของและแม่ค้าใช้
```
Tab: [📦 สินค้า] [💰 ราคาขาย] [📋 ส่งลูกค้า] [📊 ออเดอร์] [⚙️ ตั้งค่า]
```
- ดูและแก้ไขสินค้าทั้งหมด
- อัปเดตสต็อกด้วยตนเอง (กรณี Agent อ่านผิด)
- ดูออเดอร์ที่เข้ามา + เปลี่ยน status
- ตั้งค่า margin และ threshold แจ้งเตือน

### 2. Shop Page (web/shop/index.html)
ลูกค้าเปิดจากลิ้งที่เจ้าของส่งใน Line
```
หน้าแรก: ปุ่ม Login ด้วย Line
หลัง login: รายการสินค้าพร้อมส่ง (is_available=true, stock>0)
           กรองตามหมวด + ค้นหา
           ใส่ตะกร้า + เลือกจำนวน
           หน้ายืนยัน: สรุปรายการ + ยอดรวม + กด "สั่งเลย"
```

### Color Theme
```css
/* Admin: ชมพู/ม่วง (เหมือน v1) */
--primary: #C2587A;
--accent: #7B5EA7;
--bg: #FFF5F8;

/* Shop: ขาว/ชมพูอ่อน สะอาด ดูดี */
--primary: #E91E8C;
--accent: #FF6B9D;
--bg: #FFFFFF;
```

---

## 🚀 ลำดับการสร้าง (Build Order)

> Claude Code ทำตามลำดับนี้ ทดสอบให้ผ่านก่อนไปขั้นต่อไป

### Phase 1: Supabase Foundation
- [ ] สร้าง tables ทั้งหมดตาม schema
- [ ] สร้าง Storage bucket `price-images`
- [ ] ตั้งค่า RLS policies
- [ ] ทดสอบ insert/select ข้อมูลตัวอย่าง

### Phase 2: Backend Server
- [ ] สร้าง Express server พร้อม health check endpoint
- [ ] เชื่อม Supabase client
- [ ] สร้าง Webhook endpoint + verify Line signature
- [ ] สร้าง Gemini Vision module
- [ ] สร้าง Agent logic (อ่านรูป → บันทึก → reply)
- [ ] ทดสอบ local ด้วย ngrok

### Phase 3: Admin Web
- [ ] หน้าสินค้า (ดู/แก้ไข/อัปเดตสต็อก)
- [ ] หน้าออเดอร์
- [ ] หน้าตั้งค่า
- [ ] ทดสอบบน mobile

### Phase 4: Shop Web
- [ ] Line Login flow
- [ ] หน้ารายการสินค้า + ตะกร้า
- [ ] หน้ายืนยันออเดอร์
- [ ] Line Notify ส่งออเดอร์มาหาเจ้าของ

### Phase 5: Deploy
- [ ] Deploy backend บน Render.com
- [ ] Deploy frontend บน Vercel
- [ ] ตั้งค่า Webhook URL ใน Line Console
- [ ] ทดสอบ end-to-end จริง

---

## ⚠️ ข้อควรระวังสำคัญ

| หัวข้อ | รายละเอียด |
|--------|-----------|
| Webhook timeout | Line ต้องการ HTTP 200 ภายใน 30 วินาที — ทำ async เสมอ |
| Line Signature | ต้อง verify ทุก request ป้องกัน fake webhook |
| Supplier whitelist | เช็ค LINE userId ทุกครั้ง ห้ามให้คนอื่น trigger Agent |
| ห้ามลบ column | Migration ต้องเพิ่มเท่านั้น ไม่ลบ |
| Service Key | ใช้เฉพาะ server เท่านั้น ห้ามใส่ใน frontend |
| Rate limit Gemini | 1,500 req/วัน — แม่ค้า 1 คนส่งวันละไม่กี่รูป ไม่เป็นปัญหา |
| Render.com sleep | Free tier จะ sleep ถ้าไม่มีใครใช้ 15 นาที ใช้ UptimeRobot ping ทุก 10 นาที |
