-- ============================================================
-- Price Manager V3 — Seed Data (ทดสอบ)
-- รันหลังจากสร้าง tables และ RLS แล้ว
-- ============================================================

INSERT INTO products (name, brand, shade, shade_code, product_type, origin, size, unit, current_cost, sell_price, margin_percent, stock, is_available)
VALUES
  ('Velvet Lip', 'ROM&ND', 'Red Bean', '#17', 'ลิปสติก', 'เกาหลี', NULL, 'ชิ้น', 280, 380, 35.7, 5, true),
  ('Blur Fudge Tint', 'rom&nd', 'Fig Jam', '#06', 'ลิปทิ้นต์', 'เกาหลี', NULL, 'ชิ้น', 290, 390, 34.5, 3, true),
  ('Skin Tint', 'Clio', NULL, NULL, 'รองพื้น', 'เกาหลี', '30ml', 'ชิ้น', 450, 620, 37.8, 2, true),
  ('Moisture Cream', 'COSRX', NULL, NULL, 'ครีมบำรุง', 'เกาหลี', '100ml', 'ชิ้น', 320, 450, 40.6, 4, true);
