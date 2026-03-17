-- ============================================================
-- Price Manager V3 — Supabase Schema
-- Phase 1: Tables + Indexes
-- รัน SQL นี้ใน Supabase Dashboard > SQL Editor
-- ============================================================

-- ---- 1. products ----------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  brand            TEXT        NOT NULL,
  shade            TEXT,
  shade_code       TEXT,
  product_type     TEXT,
  origin           TEXT        CHECK (origin IN ('เกาหลี','ญี่ปุ่น','Counter','อื่นๆ')),
  size             TEXT,
  unit             TEXT        NOT NULL DEFAULT 'ชิ้น',
  current_cost     NUMERIC(10,2),
  sell_price       NUMERIC(10,2),
  sell_price_locked BOOLEAN    NOT NULL DEFAULT false,
  margin_percent   NUMERIC(5,2),
  stock            INTEGER     NOT NULL DEFAULT 0,
  is_available     BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_brand  ON products (brand);
CREATE INDEX IF NOT EXISTS idx_products_origin ON products (origin);
CREATE INDEX IF NOT EXISTS idx_products_available ON products (is_available) WHERE is_available = true;

-- auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- 2. price_history -----------------------------------
CREATE TABLE IF NOT EXISTS price_history (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  cost_price       NUMERIC(10,2) NOT NULL,
  source           TEXT        NOT NULL DEFAULT 'line_agent'
                               CHECK (source IN ('line_agent','manual')),
  image_url        TEXT,
  agent_confidence NUMERIC(3,2) CHECK (agent_confidence BETWEEN 0 AND 1),
  raw_text         TEXT,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON price_history (product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_created_at ON price_history (created_at DESC);

-- ---- 3. orders ------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_line_id     TEXT        NOT NULL,
  customer_name        TEXT        NOT NULL,
  customer_display_name TEXT,
  status               TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','confirmed','cancelled')),
  total_amount         NUMERIC(10,2),
  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_line_id ON orders (customer_line_id);
CREATE INDEX IF NOT EXISTS idx_orders_status           ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at       ON orders (created_at DESC);

-- ---- 4. order_items -------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID        REFERENCES products(id),
  product_name TEXT        NOT NULL,
  product_shade TEXT,
  quantity     INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price   NUMERIC(10,2) NOT NULL,
  subtotal     NUMERIC(10,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
