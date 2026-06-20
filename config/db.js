const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, '..', 'shaghlati.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','vendor','admin')),
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  price_iqd INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 365,
  max_products INTEGER NOT NULL DEFAULT 3,
  max_categories INTEGER NOT NULL DEFAULT 1,
  is_verified INTEGER DEFAULT 0,
  priority_boost INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  vendor_code TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL,
  store_slug TEXT NOT NULL UNIQUE,
  store_desc TEXT,
  business_type TEXT,
  logo_url TEXT,
  cover_url TEXT,
  primary_color TEXT DEFAULT '#C99A3F',
  secondary_color TEXT DEFAULT '#2B2620',
  phone TEXT,
  whatsapp TEXT,
  social_facebook TEXT,
  social_instagram TEXT,
  social_tiktok TEXT,
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','expired','suspended')),
  is_verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendor_requests (
  id TEXT PRIMARY KEY,
  request_code TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  admin_notes TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activation_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES vendor_requests(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  is_used INTEGER DEFAULT 0,
  used_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendor_subscriptions (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  activation_id TEXT REFERENCES activation_codes(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','cancelled','suspended')),
  starts_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  max_products INTEGER NOT NULL,
  max_categories INTEGER NOT NULL,
  is_verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_categories (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(vendor_id, slug)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES store_categories(id) ON DELETE SET NULL,
  product_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL CHECK(price >= 0),
  old_price INTEGER DEFAULT 0,
  stock_qty INTEGER DEFAULT -1,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(vendor_id, product_code)
);

CREATE TABLE IF NOT EXISTS product_media (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('image','video')),
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  governorate TEXT NOT NULL,
  address TEXT NOT NULL,
  landmark TEXT,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL DEFAULT 5000,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','shipped','delivered','cancelled')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  product_code TEXT,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price INTEGER NOT NULL,
  total_price INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  action_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  vendor_id TEXT REFERENCES vendors(id),
  subscription_id TEXT REFERENCES vendor_subscriptions(id),
  amount_iqd INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'manual' CHECK(method IN ('manual','zaincash','fastpay','card')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','failed','refunded')),
  reference TEXT,
  confirmed_by TEXT REFERENCES users(id),
  confirmed_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

function seedDefaults() {
  const planCount = db.prepare('SELECT COUNT(*) as c FROM plans').get().c;
  if (planCount === 0) {
    const ins = db.prepare('INSERT INTO plans (id,slug,name_ar,price_iqd,duration_days,max_products,max_categories,is_verified,priority_boost,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const { v4 } = require('uuid');
    ins.run(v4(), 'free', 'المجانية', 0, 365, 3, 1, 0, 0, 0);
    ins.run(v4(), 'basic', 'الأساسية', 66000, 365, 15, 5, 0, 10, 1);
    ins.run(v4(), 'pro', 'الاحترافية', 95000, 365, 50, 15, 0, 20, 2);
    ins.run(v4(), 'premium', 'المميزة', 132000, 365, -1, -1, 1, 50, 3);
  }

  const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin'").get().c;
  if (adminCount === 0) {
    const { v4 } = require('uuid');
    const hash = bcrypt.hashSync('admin2580', 10);
    db.prepare('INSERT INTO users (id,full_name,phone,password_hash,role) VALUES (?,?,?,?,?)').run(
      v4(), 'مدير النظام', process.env.ADMIN_PHONE || '07893799524', hash, 'admin'
    );
  }
}

seedDefaults();

module.exports = db;
