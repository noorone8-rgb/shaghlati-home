const jwt = require('jsonwebtoken');
const db = require('../config/db');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرّح' });
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT id,full_name,phone,role,is_active FROM users WHERE id=?').get(payload.uid);
    if (!user || !user.is_active) return res.status(401).json({ error: 'حساب غير فعّال' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'توكن غير صالح' });
  }
}

function roleGuard(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'غير مصرّح بهذا الإجراء' });
    }
    next();
  };
}

module.exports = { authMiddleware, roleGuard };
