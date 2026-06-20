const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../config/db');
const router = express.Router();

function generateToken(user) {
  return jwt.sign({ uid: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/register', (req, res) => {
  try {
    const { full_name, phone, password, role } = req.body;
    if (!full_name || !phone || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    if (password.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    if (!/^[0-9]{10,15}$/.test(phone.replace(/[\s\-+]/g, ''))) return res.status(400).json({ error: 'رقم الهاتف غير صحيح' });

    const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
    if (existing) return res.status(409).json({ error: 'رقم الهاتف مسجّل مسبقاً' });

    const id = uuid();
    const hash = bcrypt.hashSync(password, 10);
    const userRole = role === 'vendor' ? 'vendor' : 'customer';

    db.prepare('INSERT INTO users (id,full_name,phone,password_hash,role) VALUES (?,?,?,?,?)').run(id, full_name.substring(0, 100), phone, hash, userRole);

    const user = { id, full_name, phone, role: userRole };
    const token = generateToken(user);

    res.status(201).json({ token, user: { id, full_name, phone, role: userRole } });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/login', (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'أدخل الهاتف وكلمة المرور' });

    const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
    if (!user) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    if (!user.is_active) return res.status(403).json({ error: 'الحساب موقوف' });

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

    const token = generateToken(user);
    res.json({ token, user: { id: user.id, full_name: user.full_name, phone: user.phone, role: user.role } });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/me', require('../middleware/auth').authMiddleware, (req, res) => {
  const vendor = db.prepare('SELECT * FROM vendors WHERE user_id=?').get(req.user.id);
  let subscription = null;
  if (vendor) {
    subscription = db.prepare("SELECT vs.*, p.name_ar as plan_name, p.slug as plan_slug FROM vendor_subscriptions vs JOIN plans p ON p.id=vs.plan_id WHERE vs.vendor_id=? AND vs.status='active' ORDER BY vs.expires_at DESC LIMIT 1").get(vendor.id);
  }
  res.json({ user: req.user, vendor: vendor || null, subscription: subscription || null });
});

module.exports = router;
