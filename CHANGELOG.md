# CHANGELOG.md — Price Manager

> Claude Code: อ่านไฟล์นี้ก่อนทุกครั้ง เพื่อรู้ว่าทำอะไรไปแล้ว
> เมื่อทำแต่ละ Phase เสร็จ ให้อัปเดตไฟล์นี้ด้วย

---

## สถานะปัจจุบัน

**Phase ที่กำลังทำ:** Phase 5 — Deploy
**Phase ที่เสร็จแล้ว:** Phase 1 ✅, Phase 2 ✅, Phase 3 ✅, Phase 4 ✅

---

## Log การทำงาน

### [x] Phase 1: Supabase Foundation (2026-03-17)
- [x] สร้าง table: products — `supabase/01_tables.sql`
- [x] สร้าง table: price_history — `supabase/01_tables.sql`
- [x] สร้าง table: orders — `supabase/01_tables.sql`
- [x] สร้าง table: order_items — `supabase/01_tables.sql`
- [x] สร้าง Storage bucket: price-images — `supabase/02_rls.sql` (SQL + คำสั่ง manual)
- [x] ตั้งค่า RLS policies — `supabase/02_rls.sql`
- [x] สร้าง server/supabase.js — ฟังก์ชันครบ (getProducts, getProductByMatch, upsertProduct, addPriceHistory, uploadImage, createOrder, ฯลฯ)
- [x] สร้าง .env.example — ครบทุก key
- [x] สร้าง supabase/03_seed.sql — ข้อมูลตัวอย่าง 4 รายการ
- [ ] **รอผู้ใช้:** รัน SQL ใน Supabase Dashboard และทดสอบ insert/select

### [x] Phase 2: Backend Server (2026-03-17)
- [x] สร้าง server/package.json — dependencies ครบ
- [x] สร้าง server/index.js — Express + /webhook + /health + /auth/line
- [x] Webhook endpoint + verify Line signature
- [x] สร้าง server/gemini.js — readPriceFromImage() + error handling
- [x] สร้าง server/lineService.js — download/reply/pushToOwner
- [x] สร้าง server/agent.js — logic ครบ (อ่านรูป→บันทึก→reply→แจ้งเจ้าของ)
- [ ] **รอผู้ใช้:** ทดสอบ local ด้วย ngrok

### [x] Phase 3: Admin Web (2026-03-17)
- [x] สร้าง server/adminRoutes.js — GET/PATCH products, orders, price-history
- [x] เพิ่ม CORS + /api/admin routes ใน server/index.js
- [x] สร้าง web/admin/index.html — 4 tabs: สินค้า/ออเดอร์/ประวัติราคา/ตั้งค่า
- [x] หน้าสินค้า: ค้นหา/กรอง, แก้ราคาขาย/สต็อก, toggle เปิด-ปิดขาย, modal ประวัติ
- [x] หน้าออเดอร์: รายการออเดอร์, เปลี่ยน status (ยืนยัน/ยกเลิก)
- [x] หน้าประวัติราคา: เลือกสินค้า ดูราคาย้อนหลัง + % เปลี่ยนแปลง
- [x] หน้าตั้งค่า: ชื่อร้าน, margin, threshold, server URL
- [ ] **รอผู้ใช้:** เปิดทดสอบบน mobile

### [x] Phase 4: Shop Web (2026-03-17)
- [x] สร้าง server/shopRoutes.js — GET products, POST orders + Line Notify
- [x] เพิ่ม /api/shop routes ใน server/index.js
- [x] สร้าง web/shop/index.html — Line Login + หน้าสินค้า + ตะกร้า + ยืนยันออเดอร์
- [x] Line Login OAuth flow (redirect → callback → get profile)
- [x] กรองสินค้าตาม origin, เลือกจำนวน, ใส่ตะกร้า
- [x] ยืนยันออเดอร์ → บันทึก DB → Line Notify แจ้งเจ้าของ
- [ ] **รอผู้ใช้:** ใส่ Line Login Channel ID จริงแล้วทดสอบ login

### [ ] Phase 5: Deploy
- [x] สร้าง .gitignore (ป้องกัน .env และ node_modules หลุด)
- [x] สร้าง render.yaml (config deploy บน Render.com)
- [x] แก้ index.js ให้รองรับ production env
- [ ] **รอผู้ใช้:** push code ขึ้น GitHub
- [ ] **รอผู้ใช้:** deploy บน Render.com + ใส่ env variables
- [ ] **รอผู้ใช้:** ตั้งค่า Line Webhook URL
- [ ] **รอผู้ใช้:** ทดสอบ end-to-end

---

## หมายเหตุเพิ่มเติม
(Claude Code เพิ่มข้อมูลตรงนี้เมื่อเจอปัญหาหรือการตัดสินใจสำคัญ)
