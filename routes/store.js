const express = require('express');
const db = require('../config/db');
const router = express.Router();

// قائمة المتاجر النشطة
router.get('/', (req, res) => {
  const { type, q } = req.query;
  let query = `SELECT v.id,v.store_name,v.store_slug,v.store_desc,v.business_type,v.logo_url,v.cover_url,v.primary_color,v.rating_avg,v.rating_count,v.is_verified,
    (SELECT COUNT(*) FROM products WHERE vendor_id=v.id AND is_active=1) as product_count
    FROM vendors v WHERE v.status='active'`;
  const params = [];
  if (type) { query += ' AND v.business_type=?'; params.push(type); }
  if (q) { query += ' AND v.store_name LIKE ?'; params.push('%' + q + '%'); }
  query += ` ORDER BY v.is_verified DESC, v.rating_avg DESC, v.created_at DESC`;
  const stores = db.prepare(query).all(...params);
  res.json({ stores });
});

// صفحة متجر
router.get('/:slug', (req, res) => {
  const vendor = db.prepare("SELECT * FROM vendors WHERE store_slug=? AND status='active'").get(req.params.slug);
  if (!vendor) return res.status(404).json({ error: 'المتجر غير موجود' });

  const categories = db.prepare('SELECT * FROM store_categories WHERE vendor_id=? AND is_active=1 ORDER BY sort_order ASC').all(vendor.id);

  let productQuery = `SELECT p.*, sc.name as category_name,
    (SELECT GROUP_CONCAT(media_url,'|||') FROM product_media WHERE product_id=p.id AND media_type='image' ORDER BY sort_order) as images
    FROM products p LEFT JOIN store_categories sc ON sc.id=p.category_id
    WHERE p.vendor_id=? AND p.is_active=1`;
  const params = [vendor.id];

  if (req.query.category) {
    productQuery += ' AND p.category_id=?';
    params.push(req.query.category);
  }

  productQuery += ' ORDER BY p.sort_order ASC, p.created_at DESC';
  const products = db.prepare(productQuery).all(...params);

  products.forEach(p => {
    p.images = p.images ? p.images.split('|||') : [];
  });

  res.json({ vendor, categories, products });
});

// تفاصيل منتج
router.get('/:slug/product/:productId', (req, res) => {
  const vendor = db.prepare("SELECT * FROM vendors WHERE store_slug=? AND status='active'").get(req.params.slug);
  if (!vendor) return res.status(404).json({ error: 'المتجر غير موجود' });

  const product = db.prepare('SELECT p.*,sc.name as category_name FROM products p LEFT JOIN store_categories sc ON sc.id=p.category_id WHERE p.id=? AND p.vendor_id=? AND p.is_active=1').get(req.params.productId, vendor.id);
  if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });

  const media = db.prepare('SELECT * FROM product_media WHERE product_id=? ORDER BY sort_order ASC').all(product.id);
  product.media = media;

  db.prepare('UPDATE products SET view_count=view_count+1 WHERE id=?').run(product.id);

  res.json({ vendor, product });
});

// إنشاء طلب (من العميل)
router.post('/:slug/order', (req, res) => {
  try {
    const vendor = db.prepare("SELECT * FROM vendors WHERE store_slug=? AND status='active'").get(req.params.slug);
    if (!vendor) return res.status(404).json({ error: 'المتجر غير موجود' });

    const { customer_name, customer_phone, governorate, address, landmark, items, notes } = req.body;
    if (!customer_name || !customer_phone || !governorate || !address) return res.status(400).json({ error: 'البيانات غير مكتملة' });
    if (!items || !items.length) return res.status(400).json({ error: 'الطلب فارغ' });

    let subtotal = 0;
    const resolvedItems = [];
    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id=? AND vendor_id=? AND is_active=1').get(item.product_id, vendor.id);
      if (!product) continue;
      const qty = Math.max(1, Math.min(parseInt(item.quantity) || 1, 99));
      const total = product.price * qty;
      subtotal += total;
      resolvedItems.push({ product, qty, total });
    }

    if (!resolvedItems.length) return res.status(400).json({ error: 'لا توجد منتجات صالحة' });

    const deliveryFee = parseInt(process.env.DELIVERY_FEE) || 5000;
    const grandTotal = subtotal + deliveryFee;

    const orderId = require('uuid').v4();
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderCount = db.prepare("SELECT COUNT(*) as c FROM orders WHERE created_at >= date('now')").get().c;
    const orderCode = 'ORD-' + d + '-' + String(orderCount + 1).padStart(3, '0');

    db.prepare('INSERT INTO orders (id,order_code,vendor_id,customer_name,customer_phone,governorate,address,landmark,subtotal,delivery_fee,total,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      orderId, orderCode, vendor.id, customer_name.substring(0, 100), customer_phone.substring(0, 20),
      governorate, address.substring(0, 300), (landmark || '').substring(0, 200),
      subtotal, deliveryFee, grandTotal, (notes || '').substring(0, 500)
    );

    const insItem = db.prepare('INSERT INTO order_items (id,order_id,product_id,product_name,product_code,quantity,unit_price,total_price) VALUES (?,?,?,?,?,?,?,?)');
    resolvedItems.forEach(ri => {
      insItem.run(require('uuid').v4(), orderId, ri.product.id, ri.product.name, ri.product.product_code, ri.qty, ri.product.price, ri.total);
      db.prepare('UPDATE products SET order_count=order_count+? WHERE id=?').run(ri.qty, ri.product.id);
    });

    // WhatsApp message
    const waNum = vendor.whatsapp || process.env.WHATSAPP;
    let msg = 'طلب جديد — ' + orderCode + '\n\n';
    msg += 'الاسم: ' + customer_name + '\nالهاتف: ' + customer_phone + '\nالمحافظة: ' + governorate + '\nالعنوان: ' + address + '\n\n';
    resolvedItems.forEach((ri, i) => {
      msg += (i + 1) + '. ' + ri.product.name + ' × ' + ri.qty + ' = ' + ri.total.toLocaleString() + ' د.ع\n';
    });
    msg += '\nالمجموع: ' + subtotal.toLocaleString() + ' د.ع\nالتوصيل: ' + deliveryFee.toLocaleString() + ' د.ع\n────────────\nالإجمالي: ' + grandTotal.toLocaleString() + ' د.ع\n\nالدفع عند الاستلام';

    const waUrl = 'https://wa.me/' + waNum + '?text=' + encodeURIComponent(msg);

    res.status(201).json({ order_code: orderCode, total: grandTotal, whatsapp_url: waUrl });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في إنشاء الطلب' });
  }
});

module.exports = router;
