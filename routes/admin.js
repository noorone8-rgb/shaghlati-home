const express = require('express');
const { v4: uuid } = require('uuid');
const crypto = require('crypto');
const db = require('../config/db');
const { authMiddleware, roleGuard } = require('../middleware/auth');
const router = express.Router();

router.use(authMiddleware, roleGuard('admin'));

function genActivationCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `ACT-${seg()}-${seg()}-${seg()}`;
}

// إحصائيات
router.get('/stats', (req, res) => {
  const totalVendors = db.prepare('SELECT COUNT(*) as c FROM vendors').get().c;
  const activeVendors = db.prepare("SELECT COUNT(*) as c FROM vendors WHERE status='active'").get().c;
  const pendingRequests = db.prepare("SELECT COUNT(*) as c FROM vendor_requests WHERE status='pending'").get().c;
  const expiringSoon = db.prepare("SELECT COUNT(*) as c FROM vendor_subscriptions WHERE status='active' AND expires_at <= datetime('now','+30 days')").get().c;
  const expiring7 = db.prepare("SELECT COUNT(*) as c FROM vendor_subscriptions WHERE status='active' AND expires_at <= datetime('now','+7 days')").get().c;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount_iqd),0) as s FROM payments WHERE status='confirmed'").get().s;
  res.json({ totalVendors, activeVendors, pendingRequests, expiringSoon, expiring7, totalRevenue });
});

// طلبات الاشتراك
router.get('/requests', (req, res) => {
  const status = req.query.status || 'pending';
  const requests = db.prepare(`
    SELECT vr.*, v.store_name, v.vendor_code, v.store_slug, v.phone, v.logo_url, p.name_ar as plan_name, p.price_iqd, u.full_name
    FROM vendor_requests vr
    JOIN vendors v ON v.id = vr.vendor_id
    JOIN plans p ON p.id = vr.plan_id
    JOIN users u ON u.id = v.user_id
    WHERE vr.status = ?
    ORDER BY vr.created_at DESC
  `).all(status);
  res.json({ requests });
});

// إنشاء رمز تفعيل (الموافقة على الطلب)
router.post('/activate', (req, res) => {
  try {
    const { request_id } = req.body;
    const request = db.prepare("SELECT * FROM vendor_requests WHERE id=? AND status='pending'").get(request_id);
    if (!request) return res.status(404).json({ error: 'طلب غير موجود أو تمت معالجته' });

    const code = genActivationCode();
    const codeId = uuid();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    db.prepare('INSERT INTO activation_codes (id,code,vendor_id,request_id,plan_id,expires_at) VALUES (?,?,?,?,?,?)').run(
      codeId, code, request.vendor_id, request.id, request.plan_id, expiresAt
    );

    db.prepare("UPDATE vendor_requests SET status='approved',reviewed_by=?,reviewed_at=datetime('now') WHERE id=?").run(req.user.id, request.id);

    const vendor = db.prepare('SELECT store_name,vendor_code FROM vendors WHERE id=?').get(request.vendor_id);
    const plan = db.prepare('SELECT name_ar FROM plans WHERE id=?').get(request.plan_id);

    res.json({
      activation_code: code,
      vendor_name: vendor.store_name,
      vendor_code: vendor.vendor_code,
      plan: plan.name_ar,
      expires_at: expiresAt
    });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في إنشاء رمز التفعيل' });
  }
});

// رفض طلب
router.post('/reject', (req, res) => {
  const { request_id, notes } = req.body;
  const request = db.prepare("SELECT * FROM vendor_requests WHERE id=? AND status='pending'").get(request_id);
  if (!request) return res.status(404).json({ error: 'طلب غير موجود' });
  db.prepare("UPDATE vendor_requests SET status='rejected',admin_notes=?,reviewed_by=?,reviewed_at=datetime('now') WHERE id=?").run(notes || '', req.user.id, request.id);
  res.json({ message: 'تم رفض الطلب' });
});

// قائمة التجار
router.get('/vendors', (req, res) => {
  const status = req.query.status;
  let query = `SELECT v.*, u.full_name, u.phone as user_phone,
    (SELECT COUNT(*) FROM products WHERE vendor_id=v.id) as product_count,
    (SELECT COUNT(*) FROM store_categories WHERE vendor_id=v.id) as category_count
    FROM vendors v JOIN users u ON u.id=v.user_id`;
  const params = [];
  if (status) { query += ' WHERE v.status=?'; params.push(status); }
  query += ' ORDER BY v.created_at DESC';
  const vendors = db.prepare(query).all(...params);
  res.json({ vendors });
});

// تفاصيل تاجر
router.get('/vendors/:id', (req, res) => {
  const vendor = db.prepare('SELECT v.*,u.full_name,u.phone as user_phone FROM vendors v JOIN users u ON u.id=v.user_id WHERE v.id=?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'تاجر غير موجود' });
  const subs = db.prepare('SELECT vs.*,p.name_ar as plan_name FROM vendor_subscriptions vs JOIN plans p ON p.id=vs.plan_id WHERE vs.vendor_id=? ORDER BY vs.created_at DESC').all(vendor.id);
  const requests = db.prepare('SELECT vr.*,p.name_ar as plan_name FROM vendor_requests vr JOIN plans p ON p.id=vr.plan_id WHERE vr.vendor_id=? ORDER BY vr.created_at DESC').all(vendor.id);
  res.json({ vendor, subscriptions: subs, requests });
});

// تعليق تاجر
router.post('/suspend/:id', (req, res) => {
  db.prepare("UPDATE vendors SET status='suspended',updated_at=datetime('now') WHERE id=?").run(req.params.id);
  db.prepare("UPDATE vendor_subscriptions SET status='suspended',updated_at=datetime('now') WHERE vendor_id=? AND status='active'").run(req.params.id);
  res.json({ message: 'تم تعليق المتجر' });
});

// إعادة تفعيل
router.post('/unsuspend/:id', (req, res) => {
  db.prepare("UPDATE vendors SET status='active',updated_at=datetime('now') WHERE id=?").run(req.params.id);
  db.prepare("UPDATE vendor_subscriptions SET status='active',updated_at=datetime('now') WHERE vendor_id=? AND status='suspended'").run(req.params.id);
  res.json({ message: 'تم إعادة تفعيل المتجر' });
});

// اشتراكات تنتهي قريباً
router.get('/expiring', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const subs = db.prepare(`
    SELECT vs.*,v.store_name,v.vendor_code,v.phone,p.name_ar as plan_name,p.price_iqd
    FROM vendor_subscriptions vs
    JOIN vendors v ON v.id=vs.vendor_id
    JOIN plans p ON p.id=vs.plan_id
    WHERE vs.status='active' AND vs.expires_at <= datetime('now','+' || ? || ' days')
    ORDER BY vs.expires_at ASC
  `).all(days);
  res.json({ subscriptions: subs });
});

// كل رموز التفعيل
router.get('/codes', (req, res) => {
  const codes = db.prepare(`
    SELECT ac.*,v.store_name,v.vendor_code,p.name_ar as plan_name
    FROM activation_codes ac
    JOIN vendors v ON v.id=ac.vendor_id
    JOIN plans p ON p.id=ac.plan_id
    ORDER BY ac.created_at DESC
  `).all();
  res.json({ codes });
});

// تجديد اشتراك يدوي
router.post('/renew/:vendor_id', (req, res) => {
  try {
    const { plan_id } = req.body;
    const vendor = db.prepare('SELECT * FROM vendors WHERE id=?').get(req.params.vendor_id);
    if (!vendor) return res.status(404).json({ error: 'تاجر غير موجود' });
    const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(plan_id);
    if (!plan) return res.status(400).json({ error: 'باقة غير صالحة' });

    db.prepare("UPDATE vendor_subscriptions SET status='expired',updated_at=datetime('now') WHERE vendor_id=? AND status='active'").run(vendor.id);

    const subId = uuid();
    const expiresAt = new Date(Date.now() + plan.duration_days * 86400000).toISOString();
    db.prepare('INSERT INTO vendor_subscriptions (id,vendor_id,plan_id,status,starts_at,expires_at,max_products,max_categories,is_verified) VALUES (?,?,?,?,datetime("now"),?,?,?,?)').run(
      subId, vendor.id, plan.id, 'active', expiresAt, plan.max_products, plan.max_categories, plan.is_verified
    );

    db.prepare("UPDATE vendors SET status='active',is_verified=?,updated_at=datetime('now') WHERE id=?").run(plan.is_verified, vendor.id);

    res.json({ message: 'تم تجديد الاشتراك', subscription_id: subId, expires_at: expiresAt });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في التجديد' });
  }
});

// إدارة الباقات
router.get('/plans', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans ORDER BY sort_order ASC').all();
  res.json({ plans });
});

router.put('/plans/:id', (req, res) => {
  const { name_ar, price_iqd, duration_days, max_products, max_categories, is_verified, is_active } = req.body;
  db.prepare('UPDATE plans SET name_ar=?,price_iqd=?,duration_days=?,max_products=?,max_categories=?,is_verified=?,is_active=? WHERE id=?').run(
    name_ar, price_iqd, duration_days, max_products, max_categories, is_verified ? 1 : 0, is_active ? 1 : 0, req.params.id
  );
  res.json({ message: 'تم تحديث الباقة' });
});

module.exports = router;
