require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const db = require('./config/db');
const { UPLOADS_DIR } = require('./config/paths');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Serve uploaded files from the (possibly persistent) uploads directory.
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/vendor', require('./routes/vendor'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/vendor/manage', require('./routes/product'));
app.use('/api/store', require('./routes/store'));

// Store page (serves SPA-style)
app.get('/store/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'store.html'));
});

// Vendor dashboard
app.get('/vendor/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'vendor-dashboard.html')));
app.get('/vendor/:path', (req, res) => res.sendFile(path.join(__dirname, 'views', 'vendor-dashboard.html')));

// Admin dashboard
app.get('/admin/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin-dashboard.html')));
app.get('/admin/:path', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin-dashboard.html')));

// Auth pages
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));

// Fallback
app.get('/:catchAll', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Daily cron: check subscription expiry
cron.schedule('0 0 * * *', () => {
  console.log('[CRON] Checking subscription expiry...');
  try {
    // Expire active subscriptions past their date
    const expired = db.prepare(`
      UPDATE vendor_subscriptions SET status='expired', updated_at=datetime('now')
      WHERE status='active' AND expires_at < datetime('now')
    `).run();

    if (expired.changes > 0) {
      // Update vendor status
      db.prepare(`
        UPDATE vendors SET status='expired', updated_at=datetime('now')
        WHERE status='active' AND id IN (
          SELECT DISTINCT vendor_id FROM vendor_subscriptions WHERE status='expired'
        ) AND id NOT IN (
          SELECT vendor_id FROM vendor_subscriptions WHERE status='active'
        )
      `).run();
    }

    // Notifications
    const alerts = [
      { days: 14, title: 'اشتراكك ينتهي بعد 14 يوم', type: 'expiry_14' },
      { days: 7, title: 'متبقي 7 أيام على انتهاء اشتراكك', type: 'expiry_7' },
      { days: 3, title: 'متبقي 3 أيام فقط!', type: 'expiry_3' },
      { days: 0, title: 'انتهت مدة اشتراكك', type: 'expiry_0' }
    ];

    const { v4: uuid } = require('uuid');
    for (const alert of alerts) {
      const vendors = db.prepare(`
        SELECT vs.vendor_id, v.user_id FROM vendor_subscriptions vs
        JOIN vendors v ON v.id = vs.vendor_id
        WHERE vs.status = 'active' AND DATE(vs.expires_at) = DATE('now', '+${alert.days} days')
      `).all();

      for (const v of vendors) {
        const exists = db.prepare("SELECT id FROM notifications WHERE user_id=? AND type=? AND created_at >= date('now')").get(v.user_id, alert.type);
        if (!exists) {
          db.prepare('INSERT INTO notifications (id,user_id,title,type) VALUES (?,?,?,?)').run(uuid(), v.user_id, alert.title, alert.type);
        }
      }
    }

    console.log('[CRON] Done. Expired:', expired.changes);
  } catch (e) {
    console.error('[CRON] Error:', e.message);
  }
});

app.listen(PORT, () => {
  console.log(`\n  شغلاتي HOME Server`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Admin login: ${process.env.ADMIN_PHONE} / admin2580\n`);
});
