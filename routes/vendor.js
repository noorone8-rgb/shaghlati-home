const express = require('express');
const { v4: uuid } = require('uuid');
const multer = require('multer');
const path = require('path');
const db = require('../config/db');
const { UPLOADS_DIR } = require('../config/paths');
const { authMiddleware, roleGuard } = require('../middleware/auth');
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
  else cb(new Error('نوع ملف غير مدعوم'));
}});

router.use(authMiddleware);

function slugify(text) {
  return text.toLowerCase().replace(/[^ء-يa-z0-9\s\-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
}

function genVendorCode() {
  const last = db.prepare("SELECT vendor_code FROM vendors ORDER BY created_at DESC LIMIT 1").get();
  let num = 1;
  if (last) { const m = last.vendor_code.match(/VEN-(\d+)/); if (m) num = parseInt(m[1]) + 1; }
  return 'VEN-' + String(num).padStart(5, '0');
}

function genRequestCode() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = db.prepare("SELECT COUNT(*) as c FROM vendor_requests WHERE created_at >= date('now')").get().c;
  return 'REQ-' + d + '-' + String(count + 1).padStart(3, '0');
}

// إنشاء متجر
router.post('/create-store', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM vendors WHERE user_id=?').get(req.user.id);
    if (existing) return res.status(409).json({ error: 'لديك متجر مسبقاً' });

    const { store_name, store_desc, business_type, primary_color, secondary_color, phone, whatsapp, social_facebook, social_instagram, social_tiktok } = req.body;
    if (!store_name || store_name.length < 2) return res.status(400).json({ error: 'اسم المتجر مطلوب' });

    let slug = slugify(store_name);
    const slugExists = db.prepare('SELECT id FROM vendors WHERE store_slug=?').get(slug);
    if (slugExists) slug = slug + '-' + Math.random().toString(36).slice(2, 6);

    const logoUrl = req.files?.logo?.[0] ? '/uploads/' + req.files.logo[0].filename : null;
    const coverUrl = req.files?.cover?.[0] ? '/uploads/' + req.files.cover[0].filename : null;

    const id = uuid();
    const vendorCode = genVendorCode();

    db.prepare(`INSERT INTO vendors (id,user_id,vendor_code,store_name,store_slug,store_desc,business_type,logo_url,cover_url,primary_color,secondary_color,phone,whatsapp,social_facebook,social_instagram,social_tiktok)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, req.user.id, vendorCode, store_name.substring(0, 100), slug,
      (store_desc || '').substring(0, 500), (business_type || '').substring(0, 50),
      logoUrl, coverUrl,
      primary_color || '#C99A3F', secondary_color || '#2B2620',
      phone || '', whatsapp || '',
      social_facebook || '', social_instagram || '', social_tiktok || ''
    );

    if (req.user.role !== 'vendor') {
      db.prepare("UPDATE users SET role='vendor' WHERE id=?").run(req.user.id);
    }

    const vendor = db.prepare('SELECT * FROM vendors WHERE id=?').get(id);
    res.status(201).json({ vendor });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في إنشاء المتجر' });
  }
});

// تعديل بيانات المتجر
router.put('/store', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  try {
    const vendor = db.prepare('SELECT * FROM vendors WHERE user_id=?').get(req.user.id);
    if (!vendor) return res.status(404).json({ error: 'لا يوجد متجر' });

    const { store_name, store_desc, business_type, primary_color, secondary_color, phone, whatsapp, social_facebook, social_instagram, social_tiktok } = req.body;

    const logoUrl = req.files?.logo?.[0] ? '/uploads/' + req.files.logo[0].filename : vendor.logo_url;
    const coverUrl = req.files?.cover?.[0] ? '/uploads/' + req.files.cover[0].filename : vendor.cover_url;

    db.prepare(`UPDATE vendors SET store_name=?,store_desc=?,business_type=?,logo_url=?,cover_url=?,primary_color=?,secondary_color=?,phone=?,whatsapp=?,social_facebook=?,social_instagram=?,social_tiktok=?,updated_at=datetime('now') WHERE id=?`).run(
      (store_name || vendor.store_name).substring(0, 100),
      (store_desc || vendor.store_desc || '').substring(0, 500),
      (business_type || vendor.business_type || '').substring(0, 50),
      logoUrl, coverUrl,
      primary_color || vendor.primary_color,
      secondary_color || vendor.secondary_color,
      phone || vendor.phone, whatsapp || vendor.whatsapp,
      social_facebook || vendor.social_facebook || '',
      social_instagram || vendor.social_instagram || '',
      social_tiktok || vendor.social_tiktok || '',
      vendor.id
    );

    const updated = db.prepare('SELECT * FROM vendors WHERE id=?').get(vendor.id);
    res.json({ vendor: updated });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في التعديل' });
  }
});

// إرسال طلب اشتراك
router.post('/request-subscription', (req, res) => {
  try {
    const vendor = db.prepare('SELECT * FROM vendors WHERE user_id=?').get(req.user.id);
    if (!vendor) return res.status(404).json({ error: 'أنشئ متجرك أولاً' });

    const { plan_id } = req.body;
    const plan = db.prepare('SELECT * FROM plans WHERE id=? AND is_active=1').get(plan_id);
    if (!plan) return res.status(400).json({ error: 'باقة غير صالحة' });

    const pendingReq = db.prepare("SELECT id FROM vendor_requests WHERE vendor_id=? AND status='pending'").get(vendor.id);
    if (pendingReq) return res.status(409).json({ error: 'لديك طلب بانتظار المراجعة' });

    // الباقة المجانية — تفعيل فوري
    if (plan.slug === 'free') {
      const subId = uuid();
      const expiresAt = new Date(Date.now() + plan.duration_days * 86400000).toISOString();
      db.prepare('INSERT INTO vendor_subscriptions (id,vendor_id,plan_id,status,starts_at,expires_at,max_products,max_categories,is_verified) VALUES (?,?,?,?,datetime("now"),?,?,?,?)').run(
        subId, vendor.id, plan.id, 'active', expiresAt, plan.max_products, plan.max_categories, plan.is_verified
      );
      db.prepare("UPDATE vendors SET status='active',updated_at=datetime('now') WHERE id=?").run(vendor.id);
      return res.json({ message: 'تم تفعيل الباقة المجانية', subscription_id: subId });
    }

    const reqId = uuid();
    const requestCode = genRequestCode();
    db.prepare('INSERT INTO vendor_requests (id,request_code,vendor_id,plan_id) VALUES (?,?,?,?)').run(reqId, requestCode, vendor.id, plan.id);

    const waNum = process.env.WHATSAPP;
    const msg = `السلام عليكم\n\nأرغب بالاشتراك كتاجر داخل المنصة.\n\nاسم المتجر: ${vendor.store_name}\nالباقة: ${plan.name_ar} (${plan.price_iqd.toLocaleString()} د.ع)\nرقم الطلب: ${requestCode}\nرمز التاجر: ${vendor.vendor_code}`;
    const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;

    res.json({ request_code: requestCode, whatsapp_url: waUrl, plan: plan.name_ar });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في إرسال الطلب' });
  }
});

// تفعيل بالرمز
router.post('/redeem-code', (req, res) => {
  try {
    const vendor = db.prepare('SELECT * FROM vendors WHERE user_id=?').get(req.user.id);
    if (!vendor) return res.status(404).json({ error: 'لا يوجد متجر' });

    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'أدخل رمز التفعيل' });

    const actCode = db.prepare('SELECT * FROM activation_codes WHERE code=?').get(code.toUpperCase().trim());
    if (!actCode) return res.status(404).json({ error: 'رمز غير صحيح' });
    if (actCode.is_used) return res.status(400).json({ error: 'الرمز مستخدم مسبقاً' });
    if (new Date(actCode.expires_at) < new Date()) return res.status(400).json({ error: 'انتهت صلاحية الرمز' });
    if (actCode.vendor_id !== vendor.id) return res.status(403).json({ error: 'الرمز غير مرتبط بمتجرك' });

    const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(actCode.plan_id);
    const expiresAt = new Date(Date.now() + plan.duration_days * 86400000).toISOString();

    const subId = uuid();
    db.prepare('INSERT INTO vendor_subscriptions (id,vendor_id,plan_id,activation_id,status,starts_at,expires_at,max_products,max_categories,is_verified) VALUES (?,?,?,?,?,datetime("now"),?,?,?,?)').run(
      subId, vendor.id, plan.id, actCode.id, 'active', expiresAt, plan.max_products, plan.max_categories, plan.is_verified
    );

    db.prepare("UPDATE activation_codes SET is_used=1,used_at=datetime('now') WHERE id=?").run(actCode.id);
    db.prepare("UPDATE vendors SET status='active',is_verified=?,updated_at=datetime('now') WHERE id=?").run(plan.is_verified, vendor.id);
    db.prepare("UPDATE vendor_requests SET status='approved' WHERE id=?").run(actCode.request_id);

    res.json({ message: 'تم تفعيل متجرك بنجاح!', subscription_id: subId, plan: plan.name_ar, expires_at: expiresAt });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في التفعيل' });
  }
});

// بيانات لوحة القيادة
router.get('/dashboard', (req, res) => {
  try {
    const vendor = db.prepare('SELECT * FROM vendors WHERE user_id=?').get(req.user.id);
    if (!vendor) return res.json({ vendor: null });

    const sub = db.prepare("SELECT vs.*,p.name_ar as plan_name,p.slug as plan_slug,p.price_iqd FROM vendor_subscriptions vs JOIN plans p ON p.id=vs.plan_id WHERE vs.vendor_id=? AND vs.status='active' ORDER BY vs.expires_at DESC LIMIT 1").get(vendor.id);
    const productCount = db.prepare('SELECT COUNT(*) as c FROM products WHERE vendor_id=?').get(vendor.id).c;
    const categoryCount = db.prepare('SELECT COUNT(*) as c FROM store_categories WHERE vendor_id=?').get(vendor.id).c;
    const orderCount = db.prepare('SELECT COUNT(*) as c FROM orders WHERE vendor_id=?').get(vendor.id).c;
    const pendingReq = db.prepare("SELECT *,p.name_ar as plan_name FROM vendor_requests vr JOIN plans p ON p.id=vr.plan_id WHERE vr.vendor_id=? AND vr.status='pending' LIMIT 1").get(vendor.id);
    const notifications = db.prepare("SELECT * FROM notifications WHERE user_id=? AND is_read=0 ORDER BY created_at DESC LIMIT 10").all(req.user.id);

    res.json({ vendor, subscription: sub || null, productCount, categoryCount, orderCount, pendingRequest: pendingReq || null, notifications });
  } catch (e) {
    res.status(500).json({ error: 'خطأ' });
  }
});

// الباقات المتاحة
router.get('/plans', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans WHERE is_active=1 ORDER BY sort_order ASC').all();
  res.json({ plans });
});

module.exports = router;
