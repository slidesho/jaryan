# جریان (نام موقت)

پلتفرم فارسی اتوماسیون گردش‌کار، مشابه n8n، برای بازار ایران.

- سند تعریف: `docs/تعریف-پروژه.md`
- لاگ‌بوک رسمی: `docs/لاگ-بوک.md`
- تحقیق: `docs/تحقیق-دور-۲.md`

## ساختار
- `server/` موتور اجرا، API و گره‌ها (TypeScript)
- `web/` رابط فارسی (React + React Flow)
- `scripts/package-test.sh` ساخت بسته‌ی آزمایشی (فقط Node.js لازم دارد)

## اجرا برای توسعه
```bash
cd server && npm install && npm test        # تست‌ها
cd ../web && npm install && npm run build   # رابط ← server/public
cd ../server && npm start                   # http://127.0.0.1:3000
```

وضعیت: نسخه‌ی آزمایشی. ورود (رمز عبور) ندارد؛ روی اینترنت عمومی نگذارید.
