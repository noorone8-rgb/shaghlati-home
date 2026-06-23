# دليل نشر شغلاتي HOME على Railway

## ⚠️ أولاً: الأمان
رابط الـ git remote كان يحتوي توكن GitHub مكشوفاً. **ألغِ التوكن القديم** من:
GitHub → Settings → Developer settings → Personal access tokens → Revoke.
ثم أنشئ توكناً جديداً عند الحاجة وأعد ضبط الـ remote:
```
git remote set-url origin https://github.com/noorone8-rgb/shaghlati-home.git
```
(عند الـ push اطلب اسم المستخدم والتوكن الجديد، أو استخدم GitHub CLI / SSH.)

## 1) ارفع الكود إلى GitHub
```
git add .
git commit -m "تجهيز النشر: مسارات قابلة للتهيئة + إعداد Railway"
git push origin main
```

## 2) أنشئ مشروعاً على Railway
1. ادخل https://railway.app وسجّل بحساب GitHub.
2. New Project → Deploy from GitHub repo → اختر `shaghlati-home`.
3. Railway يكتشف Node تلقائياً ويبني المشروع (`npm install` ثم `npm start`).

## 3) أضِف قرصاً دائماً (Volume) — مهم جداً
بدون هذا تُمسح قاعدة البيانات والصور عند كل إعادة نشر.
1. داخل الخدمة → تبويب **Variables**، أضِف:
   - `JWT_SECRET` = (قيمة عشوائية طويلة)
   - `ADMIN_PHONE` = `07893799524`
   - `WHATSAPP` = `9647893799524`
   - `DELIVERY_FEE` = `5000`
   - `DB_PATH` = `/data/shaghlati.db`
   - `UPLOADS_DIR` = `/data/uploads`
2. تبويب **Settings → Volumes** → New Volume → Mount Path: `/data`.
3. أعد النشر (Redeploy).

> ملاحظة: لا تضبط `PORT` يدوياً على Railway — المنصة تحقنه تلقائياً، والكود يقرؤه من `process.env.PORT`.

## 4) الرابط العام
من تبويب **Settings → Networking → Generate Domain** يطلع رابط مثل:
`https://shaghlati-home-production.up.railway.app`

## 5) ربط دومين خاص (بعد الشراء)
1. اشترِ الدومين (Namecheap / GoDaddy / Cloudflare).
2. Railway → Settings → Networking → Custom Domain → أدخل الدومين.
3. أضِف سجل CNAME عند مزوّد الدومين يشير للقيمة التي يعطيك إياها Railway.
4. انتظر انتشار DNS (دقائق إلى ساعة). شهادة HTTPS تُصدر تلقائياً.

## حساب المدير الأول
بعد أول تشغيل يُنشأ تلقائياً:
- الهاتف: قيمة `ADMIN_PHONE`
- كلمة المرور: `admin2580` (غيّرها فوراً بعد الدخول)
