-- Pare Carrito SAS - Esquema PostgreSQL
-- Se aplica automaticamente al iniciar el servidor (idempotente).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('manager','admin','employee','customer','contador','example','proveedor')),
  password_hash TEXT NOT NULL,
  password_fingerprint TEXT NOT NULL DEFAULT '',
  client_id TEXT,
  linked_client_ids JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estado completo del ERP (transporte operativo) con control de versiones
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS state_history (
  id BIGSERIAL PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- Historiales canonicos de productos fuera del app_state operativo.
CREATE TABLE IF NOT EXISTS product_history_state (
  id TEXT PRIMARY KEY,
  list_price_history JSONB NOT NULL DEFAULT '[]',
  sales_quantity_history JSONB NOT NULL DEFAULT '[]',
  purchase_history JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- Operaciones chicas aplicadas al estado, con idempotencia para reintentos offline.
CREATE TABLE IF NOT EXISTS state_operations (
  operation_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL DEFAULT 'patch',
  base_updated_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by TEXT,
  patch JSONB NOT NULL DEFAULT '{}'
);

-- Espejo relacional (se refresca en cada subida de estado; consultas y reportes pesados)
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  payment_type TEXT,
  price_tier TEXT,
  vehicle_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  unit_type TEXT,
  base_cost NUMERIC NOT NULL DEFAULT 0,
  sale_price NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  client_id TEXT,
  vehicle_id TEXT,
  status TEXT,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  iva NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  payment_received NUMERIC NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);

CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT,
  unit_type TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  expense_type TEXT,
  provider_id TEXT,
  provider_name TEXT,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  payment_status TEXT,
  recorded_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);

CREATE TABLE IF NOT EXISTS purchase_items (
  purchase_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  product_id TEXT,
  product_name TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (purchase_id, position)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  date DATE,
  client_id TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  method TEXT,
  received_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);

CREATE TABLE IF NOT EXISTS proofs (
  key TEXT PRIMARY KEY,
  content_type TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS state_writes (
  id BIGSERIAL PRIMARY KEY,
  wrote_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  orders_before INT NOT NULL DEFAULT 0,
  orders_after INT NOT NULL DEFAULT 0,
  clients_before INT NOT NULL DEFAULT 0,
  clients_after INT NOT NULL DEFAULT 0,
  products_before INT NOT NULL DEFAULT 0,
  products_after INT NOT NULL DEFAULT 0,
  diff_orders INT NOT NULL DEFAULT 0
);
