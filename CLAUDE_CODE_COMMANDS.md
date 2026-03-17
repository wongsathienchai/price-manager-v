# CLAUDE_CODE_COMMANDS.md — คำสั่งสำหรับ Claude Code
## Price Manager V2+V3 (ทำพร้อมกัน)

> วิธีใช้: Copy คำสั่งทีละ Phase วางใน Claude Code
> ทำทีละ Phase และทดสอบให้ผ่านก่อนไป Phase ถัดไป

---

## 🔴 คำสั่งเริ่มต้น (ทำก่อนทุกครั้ง)

```
อ่านไฟล์ SKILL.md และ CHANGELOG.md ในโฟลเดอร์นี้ก่อน
แล้วบอกฉันว่า:
1. เข้าใจระบบที่ต้องสร้างอย่างไร
2. Phase ที่ยังไม่เสร็จมีอะไรบ้าง
3. จะเริ่มทำอะไรต่อไป
```

---

## Phase 1 — Supabase Foundation

```
อ่าน SKILL.md ส่วน Supabase Schema แล้วช่วยฉันสร้างฐานข้อมูลโดย:

1. เขียน SQL script สำหรับสร้าง tables ทั้งหมด:
   - products (พร้อม indexes บน brand, origin)
   - price_history (พร้อม index บน product_id)
   - orders
   - order_items

2. เขียน SQL สำหรับ RLS policies ทุกตาราง

3. บอกฉันว่าต้องทำอะไรใน Supabase Dashboard:
   - สร้าง Storage bucket ชื่อ price-images
   - ตั้งค่า bucket policy

4. สร้างไฟล์ server/supabase.js ที่มีฟังก์ชัน:
   - getProducts() — ดึงสินค้าทั้งหมด
   - getProductByMatch(brand, name, shade) — ค้นหาสินค้า
   - upsertProduct(data) — เพิ่ม/อัปเดตสินค้า
   - addPriceHistory(data) — บันทึกประวัติราคา
   - uploadImage(buffer, filename) — อัปโหลดรูปใน Storage
   - createOrder(orderData, items) — สร้างออเดอร์

5. สร้างไฟล์ .env.example

เมื่อเสร็จแต่ละขั้น อัปเดต CHANGELOG.md ด้วย
```

---

## Phase 2 — Backend Server + AI Agent

```
สร้าง Backend Server ตาม SKILL.md โดย:

1. สร้าง server/package.json และ server/index.js
   - Express server port 3000
   - POST /webhook — รับ event จาก Line
   - GET /health — health check
   - Verify Line signature ทุก request

2. สร้าง server/gemini.js
   - ฟังก์ชัน readPriceFromImage(imageBuffer)
   - ใช้ prompt จาก SKILL.md ส่วน AGENT_PROMPT
   - temperature: 0.1
   - Error handling: API_KEY_INVALID, QUOTA_EXCEEDED, PARSE_ERROR

3. สร้าง server/lineService.js
   - downloadImageFromLine(messageId) — download รูปจาก Line
   - replyMessage(replyToken, text) — ตอบกลับใน Line
   - pushToOwner(message) — push แจ้งเจ้าของผ่าน Line Notify

4. สร้าง server/agent.js — Logic หลัก:
   - รับ image event จาก Line
   - เช็ค SUPPLIER_LINE_USER_ID (whitelist)
   - Download รูป → Upload Supabase Storage → ได้ URL
   - ส่งรูปให้ Gemini อ่าน
   - สำหรับแต่ละสินค้า:
     * ค้นหาใน DB (brand + name + shade)
     * คำนวณ % เปลี่ยนแปลง
     * บันทึก price_history
     * อัปเดต current_cost
   - Reply กลับแม่ค้าด้วย format จาก SKILL.md
   - ถ้าราคาเปลี่ยนเกิน 30% → push แจ้งเจ้าของด้วย

5. กฎสำคัญ:
   - ต้องตอบ Line ด้วย HTTP 200 ภายใน 5 วินาที
   - ทำ Agent logic แบบ async (อย่าให้ block response)
   - Log ทุก error ใน console

เมื่อเสร็จ บอกวิธีทดสอบด้วย ngrok และอัปเดต CHANGELOG.md
```

---

## Phase 3 — Admin Web

```
สร้าง web/admin/index.html — หน้าจัดการสำหรับเจ้าของ โดย:

1. Single Page App มี 4 tabs:
   [📦 สินค้า] [📊 ออเดอร์] [🖼️ ประวัติราคา] [⚙️ ตั้งค่า]

2. หน้าสินค้า:
   - ตารางสินค้าทั้งหมด (ดึงจาก Supabase)
   - ค้นหาได้, กรองตาม origin/brand
   - แก้ไข sell_price และ stock ได้โดยตรง
   - toggle is_available (เปิด/ปิดแสดงในหน้าร้าน)
   - ดูประวัติราคาของแต่ละสินค้า

3. หน้าออเดอร์:
   - รายการออเดอร์ล่าสุด (realtime ด้วย Supabase subscription)
   - เปลี่ยน status: pending → confirmed → cancelled
   - ดูรายละเอียดออเดอร์แต่ละรายการ

4. หน้าตั้งค่า:
   - ตั้ง default margin %
   - ตั้ง threshold แจ้งเตือนราคาเปลี่ยน (default 30%)
   - ชื่อร้าน

5. Design:
   - Mobile-first, ใช้ font Sarabun
   - Color theme: Primary #C2587A, Accent #7B5EA7, BG #FFF5F8
   - ปุ่ม min-height 48px

6. ใช้ Supabase JS client (anon key) เชื่อมข้อมูล

เมื่อเสร็จ อัปเดต CHANGELOG.md
```

---

## Phase 4 — Shop Web (หน้าลูกค้า)

```
สร้าง web/shop/index.html — หน้าร้านสำหรับลูกค้า โดย:

1. หน้า Login:
   - แสดงโลโก้ร้าน + ชื่อร้าน
   - ปุ่ม "เข้าสู่ระบบด้วย Line" (Line Login OAuth)
   - redirect ไป Line แล้วกลับมาที่ /shop/?code=xxx

2. Line Login Flow:
   - ดึง code จาก URL parameter
   - แลก code เอา access_token (ผ่าน backend endpoint GET /auth/line)
   - ดึง LINE profile (userId, displayName, pictureUrl)
   - เก็บใน localStorage

3. หน้าสินค้า (หลัง login):
   - ดึงสินค้าที่ is_available=true และ stock>0
   - แสดงเป็น card grid (ชื่อ + เฉดสี + ราคา + จำนวนในสต็อก)
   - กรองตาม: เกาหลี / ญี่ปุ่น / Counter Brand / ทั้งหมด
   - ปุ่ม "เพิ่มในตะกร้า" + เลือกจำนวน (1 ถึง stock ที่มี)

4. ตะกร้า:
   - icon ตะกร้าด้านบน แสดงจำนวนชิ้น
   - หน้าตะกร้า: รายการ + แก้จำนวน + ลบ + ยอดรวม

5. ยืนยันออเดอร์:
   - สรุปรายการทั้งหมด
   - ช่องกรอกหมายเหตุ (ถ้ามี)
   - ปุ่ม "ยืนยันสั่งซื้อ"
   - บันทึกออเดอร์ใน Supabase
   - Line Notify ส่งสรุปออเดอร์มาหาเจ้าของ
   - แสดงหน้า "สั่งเรียบร้อยแล้ว ✅"

6. Design:
   - Mobile-first, สะอาด ดูดี
   - Color: Primary #E91E8C, BG white
   - ปุ่มใหญ่กดง่ายบนมือถือ

เมื่อเสร็จ อัปเดต CHANGELOG.md
```

---

## Phase 5 — Deploy

```
ช่วยฉัน deploy ระบบขึ้น production โดย:

1. สร้างไฟล์ที่จำเป็นสำหรับ Render.com:
   - render.yaml หรือบอกวิธีตั้งค่า
   - Procfile หรือ start command

2. บอกขั้นตอน deploy backend บน Render.com:
   - Connect GitHub repository
   - ตั้งค่า Environment Variables ทุกตัวจาก .env.example
   - ได้ URL ของ server

3. บอกขั้นตอน deploy frontend บน Vercel:
   - Connect GitHub repository
   - ตั้งค่า build settings

4. บอกวิธีตั้งค่า Line Webhook:
   - ไปที่ Line Developers Console
   - ใส่ Webhook URL: https://your-render-url.com/webhook
   - กด Verify

5. UptimeRobot setup:
   - สร้าง monitor ping /health ทุก 10 นาที
   - ป้องกัน Render.com sleep

6. ทดสอบ end-to-end:
   - ส่งรูปใน Line OA → เช็คว่า Agent ตอบกลับได้
   - เปิดหน้า shop → Login Line → สั่งสินค้า → เช็คว่าได้รับแจ้งใน Line

อัปเดต CHANGELOG.md ทุก Phase เสร็จ
```

---

## 🛠️ คำสั่งแก้บัก

```
มีปัญหา: [อธิบายอาการ]

ช่วยตรวจสอบ:
1. อ่าน SKILL.md ส่วนที่เกี่ยวข้องก่อน
2. ดู CHANGELOG.md ว่าทำอะไรไปแล้ว
3. หาสาเหตุและแก้ไข
4. อย่าแก้ด้วยการลบโค้ดเก่า ให้แก้เฉพาะส่วนที่มีปัญหา
```

---

## 📋 คำสั่งเสริม (ทำทีหลัง)

### เพิ่ม ngrok สำหรับทดสอบ local
```
บอกวิธีติดตั้งและใช้ ngrok เพื่อทดสอบ Line Webhook บนเครื่องตัวเอง
ก่อน deploy จริง
```

### เพิ่ม realtime stock update
```
เพิ่มฟีเจอร์ Supabase Realtime ในหน้า shop
ให้สต็อกอัปเดตแบบ live โดยไม่ต้อง refresh
```

### เพิ่มประวัติออเดอร์สำหรับลูกค้า
```
เพิ่มหน้า "ออเดอร์ของฉัน" ในหน้า shop
ให้ลูกค้าดูประวัติการสั่งซื้อย้อนหลังได้
```
