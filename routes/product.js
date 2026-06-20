const express = require('express');
const { v4: uuid } = require('uuid');
const multer = require('multer');
const path = require('path');
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authMiddleware);

function getVendorAndSub(userId) {
  const vendor = db.prepare('SELECT * FROM vendors WHERE user_id=?').get(userId);
  if (!vendor) return null;
  const sub = db.prepare("SELECT * FROM vendor_subscriptions WHERE vendor_id=? AND status='active' ORDER BY expires_at DESC LIMIT 1").get(vendor.id);
  return { vendor, sub };
}

// ── الأقسام ──
router.get('/categories', (req, res) => {
  const vs = getVendorAndSub(req.user.id);
  if (!vs) return res.status(404).json({ error: 'لا يوجد متجر' });
  const cats = db.prepare('SELECT * FROM store_categories WHERE vendor_id=? ORDER BY sort_order ASC').all(vs.vendor.id);
  res.json({ categories: cats, max: vs.sub ? vs.sub.max_categories : 0 });
});

router.post('/categories', (req, res) => {
  const vs = getVendorAndSub(req.user.id);
  if (!vs || !vs.sub) return res.status(403).json({ error: 'الاشتراك غير فعّال' });
  const count = db.prepare('SELECT COUNT(*) as c FROM store_categories WHERE vendor_id=?').get(vs.vendor.id).c;
  if (vs.sub.max_categories !== -1 && count >= vs.sub.max_categories) return res.status(403).json({ error: 'وصلت الحد الأقصى للأقسام في باقتك' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم القسم مطلوب' });
  const slug = name.toLowerCase().replace(/[^ء-يa-z0-9\s]/g, '').replace(/\s+/g, '-').substring(0, 80);
  const id = uuid();
  try {
    db.prepare('INSERT INTO store_categories (id,vendor_id,name,slug,sort_order) VALUES (?,?,?,?,?)').run(id, vs.vendor.id, name.substring(0, 80), slug, count);
    res.status(201).json({ category: db.prepare('SELECT * FROM store_categories WHERE id=?').get(id) });
  } catch (e) {
    res.status(409).json({ error: 'قسم بنفس الاسم موجود' });
  }
});

router.put('/categories/:id', (req, res) => {
  const vs = getVendorAndSub(req.user.id);
  if (!vs) return res.status(404).json({ error: 'لا يوجد متجر' });
  const cat = db.prepare('SELECT * FROM store_categories WHERE id=? AND vendor_id=?').get(req.params.id, vs.vendor.id);
  if (!cat) return res.status(404).json({ error: 'قسم غير موجود' });
  const { name, is_active } = req.body;
  db.prepare('UPDATE store_categories SET name=?,is_active=? WHERE id=?').run(name || cat.name, is_active !== undefined ? (is_active ? 1 : 0) : cat.is_active, cat.id);
  res.json({ category: db.prepare('SELECT * FROM store_categories WHERE id=?').get(cat.id) });
});

router.delete('/categories/:id', (req, res) => {
  const vs = getVendorAndSub(req.user.id);
  if (!vs) return res.status(404).json({ error: 'لا يوجد متجر' });
  db.prepare('DELETE FROM store_categories WHERE id=? AND vendor_id=?').run(req.params.id, vs.vendor.id);
  res.json({ message: 'تم حذف القسم' });
});

// ── المنتجات ──
router.get('/products', (req, res) => {
  const vs = getVendorAndSub(req.user.id);
  if (!vs) return res.status(404).json({ error: 'لا يوجد متجر' });
  const products = db.prepare(`
    SELECT p.*, sc.name as category_name,
    (SELECT GROUP_CONCAT(media_url,'|||') FROM product_media WHERE product_id=p.id AND media_type='image' ORDER BY sort_order) as images,
    (SELECT GROUP_CONCAT(media_url,'|||') FROM product_media WHERE product_id=p.id AND media_type='video' ORDER BY sort_order) as videos
    FROM products p LEFT JOIN store_categories sc ON sc.id=p.category_id
    WHERE p.vendor_id=? ORDER BY p.sort_order ASC, p.created_at DESC
  `).all(vs.vendor.id);

  products.forEach(p => {
    p.images = p.images ? p.images.split('|||') : [];
    p.videos = p.videos ? p.videos.split('|||') : [];
  });

  res.json({ products, max: vs.sub ? vs.sub.max_products : 0 });
});

router.post('/products', upload.array('media', 10), (req, res) => {
  const vs = getVendorAndSub(req.user.id);
  if (!vs || !vs.sub) return res.status(403).json({ error: 'الاشتراك غير فعّال' });
  const count = db.prepare('SELECT COUNT(*) as c FROM products WHERE vendor_id=?').get(vs.vendor.id).c;
  if (vs.sub.max_products !== -1 && count >= vs.sub.max_products) return res.status(403).json({ error: 'وصلت الحد الأقصى للمنتجات في باقتك (' + vs.sub.max_products + ')' });

  const { name, product_code, description, price, old_price, category_id, stock_qty } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'الاسم والسعر مطلوبان' });

  const code = (product_code || '').substring(0, 30) || ('P-' + Date.now().toString(36).toUpperCase());
  const existing = db.prepare('SELECT id FROM products WHERE vendor_id=? AND product_code=?').get(vs.vendor.id, code);
  if (existing) return res.status(409).json({ error: 'رمز المنتج مستخدم' });

  const id = uuid();
  db.prepare('INSERT INTO products (id,vendor_id,category_id,product_code,name,description,price,old_price,stock_qty,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    id, vs.vendor.id, category_id || null, code, name.substring(0, 200), (description || '').substring(0, 2000),
    Math.max(0, parseInt(price) || 0), Math.max(0, parseInt(old_price) || 0),
    stock_qty !== undefined ? parseInt(stock_qty) : -1, count
  );

  if (req.files && req.files.length) {
    const ins = db.prepare('INSERT INTO product_media (id,product_id,media_url,media_type,sort_order) VALUES (?,?,?,?,?)');
    req.files.forEach((f, i) => {
      const type = f.mimetype.startsWith('video/') ? 'video' : 'image';
      ins.run(uuid(), id, '/uploads/' + f.filename, type, i);
    });
  }

  const product = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  res.status(201).json({ product });
});

router.put('/products/:id', upload.array('media', 10), (req, res) => {
  const vs = getVendorAndSub(req.user.id);
  if (!vs) return res.status(404).json({ error: 'لا يوجد متجر' });
  const product = db.prepare('SELECT * FROM products WHERE id=? AND vendor_id=?').get(req.params.id, vs.vendor.id);
  if (!product) return res.status(404).json({ error: 'منتج غير موجود' });

  const { name, description, price, old_price, category_id, stock_qty, is_active } = req.body;
  db.prepare(`UPDATE products SET name=?,description=?,price=?,old_price=?,category_id=?,stock_qty=?,is_active=?,updated_at=datetime('now') WHERE id=?`).run(
    (name || product.name).substring(0, 200), (description !== undefined ? description : product.description || '').substring(0, 2000),
    price !== undefined ? Math.max(0, parseInt(price)) : product.price,
    old_price !== undefined ? Math.max(0, parseInt(old_price)) : product.old_price,
    category_id !== undefined ? category_id : product.category_id,
    stock_qty !== undefined ? parseInt(stock_qty) : product.stock_qty,
    is_active !== undefined ? (is_active ? 1 : 0) : product.is_active,
    product.id
  );

  if (req.files && req.files.length) {
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM product_media WHERE product_id=?').get(product.id).m;
    const ins = db.prepare('INSERT INTO product_media (id,product_id,media_url,media_type,sort_order) VALUES (?,?,?,?,?)');
    req.files.forEach((f, i) => {
      const type = f.mimetype.startsWith('video/') ? 'video' : 'image';
      ins.run(uuid(), product.id, '/uploads/' + f.filename, type, maxSort + i + 1);
    });
  }

  res.json({ product: db.prepare('SELECT * FROM products WHERE id=?').get(product.id) });
});

router.delete('/products/:id', (req, res) => {
  const vs = getVendorAndSub(req.user.id);
  if (!vs) return res.status(404).json({ error: 'لا يوجد متجر' });
  db.prepare('DELETE FROM products WHERE id=? AND vendor_id=?').run(req.params.id, vs.vendor.id);
  res.json({ message: 'تم حذف المنتج' });
});

router.delete('/products/:pid/media/:mid', (req, res) => {
  const vs = getVendorAndSub(req.user.id);
  if (!vs) return res.status(404).json({ error: 'لا يوجد متجر' });
  const product = db.prepare('SELECT id FROM products WHERE id=? AND vendor_id=?').get(req.params.pid, vs.vendor.id);
  if (!product) return res.status(404).json({ error: 'منتج غير موجود' });
  db.prepare('DELETE FROM product_media WHERE id=? AND product_id=?').run(req.params.mid, product.id);
  res.json({ message: 'تم حذف الوسائط' });
});

module.exports = router;
