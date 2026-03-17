-- ============================================================
-- Price Manager V3 — Row Level Security (RLS)
-- Phase 1: RLS Policies
-- รัน SQL นี้หลังจากรัน 01_tables.sql แล้ว
-- ============================================================

-- ---- products -------------------------------------------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- ทุกคนดูสินค้าได้ (หน้าร้าน)
CREATE POLICY "Public read products"
  ON products FOR SELECT
  USING (true);

-- เฉพาะ admin แก้ไขได้ (service_role key หรือ JWT role=admin)
CREATE POLICY "Admin insert products"
  ON products FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'role' = 'admin'
    OR auth.role() = 'service_role'
  );

CREATE POLICY "Admin update products"
  ON products FOR UPDATE
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR auth.role() = 'service_role'
  );

CREATE POLICY "Admin delete products"
  ON products FOR DELETE
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR auth.role() = 'service_role'
  );

-- ---- price_history --------------------------------------
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

-- ทุกคนดูประวัติราคาได้
CREATE POLICY "Public read price_history"
  ON price_history FOR SELECT
  USING (true);

-- เฉพาะ admin/service เพิ่มได้
CREATE POLICY "Admin insert price_history"
  ON price_history FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'role' = 'admin'
    OR auth.role() = 'service_role'
  );

-- ---- orders ---------------------------------------------
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- ลูกค้าดูเฉพาะออเดอร์ตัวเอง
CREATE POLICY "Customer read own orders"
  ON orders FOR SELECT
  USING (
    customer_line_id = auth.jwt() ->> 'sub'
    OR auth.jwt() ->> 'role' = 'admin'
    OR auth.role() = 'service_role'
  );

-- ลูกค้าสร้างออเดอร์ได้ (ต้องเป็น line_id ตัวเอง)
CREATE POLICY "Customer insert own orders"
  ON orders FOR INSERT
  WITH CHECK (
    customer_line_id = auth.jwt() ->> 'sub'
    OR auth.role() = 'service_role'
  );

-- เฉพาะ admin เปลี่ยน status ได้
CREATE POLICY "Admin update orders"
  ON orders FOR UPDATE
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR auth.role() = 'service_role'
  );

-- ---- order_items ----------------------------------------
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- ดูได้ถ้าดู order ได้
CREATE POLICY "Customer read own order_items"
  ON order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.customer_line_id = auth.jwt() ->> 'sub'
          OR auth.jwt() ->> 'role' = 'admin'
          OR auth.role() = 'service_role'
        )
    )
  );

CREATE POLICY "Customer insert order_items"
  ON order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (
          o.customer_line_id = auth.jwt() ->> 'sub'
          OR auth.role() = 'service_role'
        )
    )
  );

-- ---- Storage bucket policy -----------------------------------
-- ⚠️ ต้องสร้าง bucket ผ่าน Dashboard ก่อน แล้วค่อยรัน SQL ด้านล่างนี้
-- ขั้นตอน:
--   1. ไปที่ Storage > New Bucket
--   2. Name: price-images
--   3. Public bucket: OFF (ไม่ติ๊ก)
--   4. กด Save
--   5. แล้วค่อยรัน SQL ด้านล่างนี้ใน SQL Editor

-- อนุญาตให้ service_role upload
CREATE POLICY "Service upload price-images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'price-images'
    AND auth.role() = 'service_role'
  );

-- ทุกคนดูรูปได้ผ่าน URL (public read)
CREATE POLICY "Public read price-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'price-images');
