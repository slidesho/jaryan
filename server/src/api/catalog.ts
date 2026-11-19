// کاتالوگ گره‌ها: نام فارسی و فیلدهای پارامتر برای رابط

export type FieldType = "text" | "number" | "json" | "select" | "secret" | "textarea";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  default?: unknown;
}

export interface NodeTypeDef {
  type: string;
  label: string;
  group: "محرک" | "پایه" | "منطق" | "داده" | "پیام‌رسان" | "پیامک" | "ایمیل" | "پایگاه‌داده" | "هوش مصنوعی" | "کد";
  description: string;
  fields: FieldDef[];
}

export const NODE_TYPES: NodeTypeDef[] = [
  {
    type: "trigger", label: "محرک (شروع)", group: "محرک",
    description: "شروع گردش‌کار؛ با اجرای دستی یا وب‌هوک. ورودی را عبور می‌دهد.",
    fields: [],
  },
  {
    type: "set", label: "تبدیل داده", group: "پایه",
    description: "فیلدهای تازه به هر آیتم اضافه می‌کند. مثال مقدار: سلام {{ $input.نام }}",
    fields: [{ key: "fields", label: "فیلدها (JSON)", type: "json", default: {}, placeholder: '{"پیام": "سلام {{ $input.نام }}"}' }],
  },
  {
    type: "condition", label: "شرط", group: "پایه",
    description: "آیتم‌ها را به خروجی «درست» یا «نادرست» می‌فرستد.",
    fields: [
      { key: "left", label: "مقدار اول", type: "text", placeholder: "{{ $input.مبلغ }}" },
      {
        key: "op", label: "عملگر", type: "select", default: "equals",
        options: [
          { value: "equals", label: "مساوی است" }, { value: "notEquals", label: "مساوی نیست" },
          { value: "gt", label: "بزرگ‌تر از" }, { value: "lt", label: "کوچک‌تر از" },
          { value: "gte", label: "بزرگ‌تر یا مساوی" }, { value: "lte", label: "کوچک‌تر یا مساوی" },
          { value: "contains", label: "شامل" }, { value: "isEmpty", label: "خالی است" }, { value: "isNotEmpty", label: "خالی نیست" },
        ],
      },
      { key: "right", label: "مقدار دوم", type: "text" },
    ],
  },
  {
    type: "http", label: "درخواست HTTP", group: "پایه",
    description: "فراخوانی یک نشانی اینترنتی (فقط http و https).",
    fields: [
      { key: "url", label: "نشانی", type: "text", placeholder: "https://example.com/api" },
      {
        key: "method", label: "روش", type: "select", default: "GET",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m })),
      },
      { key: "body", label: "بدنه (JSON)", type: "json" },
    ],
  },
  {
    type: "delay", label: "تأخیر", group: "پایه",
    description: "مکث بین دو گره (حداکثر ۶۰ ثانیه).",
    fields: [{ key: "ms", label: "میلی‌ثانیه", type: "number", default: 1000 }],
  },
  {
    type: "telegram", label: "تلگرام: ارسال پیام", group: "پیام‌رسان",
    description: "ارسال پیام با بات تلگرام.",
    fields: [
      { key: "token", label: "توکن بات", type: "secret" },
      { key: "chatId", label: "شناسه‌ی گفتگو", type: "text" },
      { key: "text", label: "متن پیام", type: "text", placeholder: "سلام {{ $input.نام }}" },
      { key: "buttonType", label: "نوع دکمه", type: "select", default: "inline", options: [{ value: "inline", label: "درون‌پیامی" }, { value: "reply", label: "کیبورد پاسخ" }] },
      { key: "buttons", label: "دکمه‌ها (اختیاری، JSON)", type: "json", placeholder: '[[{"text":"بله","data":"yes"},{"text":"سایت","url":"https://example.com"}]]' },
    ],
  },
  {
    type: "bale", label: "بله: ارسال پیام", group: "پیام‌رسان",
    description: "ارسال پیام با بات بله.",
    fields: [
      { key: "token", label: "توکن بات", type: "secret" },
      { key: "chatId", label: "شناسه‌ی گفتگو", type: "text" },
      { key: "text", label: "متن پیام", type: "text" },
      { key: "buttonType", label: "نوع دکمه", type: "select", default: "inline", options: [{ value: "inline", label: "درون‌پیامی" }, { value: "reply", label: "کیبورد پاسخ" }] },
      { key: "buttons", label: "دکمه‌ها (اختیاری، JSON)", type: "json", placeholder: '[[{"text":"بله","data":"yes"},{"text":"سایت","url":"https://example.com"}]]' },
    ],
  },
  {
    type: "kavenegarSms", label: "کاوه‌نگار: ارسال پیامک", group: "پیامک",
    description: "ارسال پیامک ساده.",
    fields: [
      { key: "apiKey", label: "کلید API", type: "secret" },
      { key: "receptor", label: "شماره‌ی گیرنده", type: "text", placeholder: "09121234567" },
      { key: "sender", label: "خط ارسال (اختیاری)", type: "text" },
      { key: "message", label: "متن پیامک", type: "text" },
    ],
  },
  {
    type: "kavenegarVerify", label: "کاوه‌نگار: کد تأیید (الگو)", group: "پیامک",
    description: "ارسال پیامک الگویی (verify/lookup).",
    fields: [
      { key: "apiKey", label: "کلید API", type: "secret" },
      { key: "receptor", label: "شماره‌ی گیرنده", type: "text" },
      { key: "template", label: "نام الگو", type: "text" },
      { key: "token", label: "مقدار توکن", type: "text" },
    ],
  },
  {
    type: "schedule", label: "زمان‌بندی (کرون)", group: "محرک",
    description: "گردش‌کار را در زمان‌های تعیین‌شده خودکار اجرا می‌کند (باید گردش‌کار «فعال» باشد). قالب: دقیقه ساعت روز-ماه ماه روز-هفته؛ مثلاً هر روز ساعت ۹ صبح: 0 9 * * *",
    fields: [
      { key: "cron", label: "کرون", type: "text", default: "0 9 * * *", placeholder: "0 9 * * *" },
      { key: "timezone", label: "منطقه‌ی زمانی", type: "text", default: "Asia/Tehran" },
    ],
  },
  {
    type: "telegramTrigger", label: "تلگرام: پیام تازه", group: "محرک",
    description: "با رسیدن پیام تازه به بات تلگرام اجرا می‌شود (گردش‌کار باید «فعال» باشد). پیام‌های قبل از فعال‌سازی نادیده گرفته می‌شوند.",
    fields: [{ key: "token", label: "توکن بات", type: "secret" }],
  },
  {
    type: "baleTrigger", label: "بله: پیام تازه", group: "محرک",
    description: "با رسیدن پیام تازه به بات بله اجرا می‌شود (گردش‌کار باید «فعال» باشد).",
    fields: [{ key: "token", label: "توکن بات", type: "secret" }],
  },
  {
    type: "filter", label: "فیلتر", group: "منطق",
    description: "فقط آیتم‌هایی که شرط را دارند عبور می‌کنند؛ بقیه به خروجی «rest» می‌روند.",
    fields: [
      { key: "left", label: "مقدار اول", type: "text", placeholder: "{{ $input.مبلغ }}" },
      { key: "op", label: "عملگر", type: "select", default: "equals", options: [
        { value: "equals", label: "مساوی است" }, { value: "notEquals", label: "مساوی نیست" }, { value: "gt", label: "بزرگ‌تر از" },
        { value: "lt", label: "کوچک‌تر از" }, { value: "gte", label: "بزرگ‌تر یا مساوی" }, { value: "lte", label: "کوچک‌تر یا مساوی" },
        { value: "contains", label: "شامل" }, { value: "isEmpty", label: "خالی است" }, { value: "isNotEmpty", label: "خالی نیست" } ] },
      { key: "right", label: "مقدار دوم", type: "text" },
    ],
  },
  {
    type: "switch", label: "سوییچ (چندشاخه)", group: "منطق",
    description: "هر آیتم را بر اساس مقدارش به یکی از شاخه‌ها می‌فرستد؛ اگر هیچ‌کدام نخورد به «دیگر».",
    fields: [
      { key: "value", label: "مقدار بررسی", type: "text", placeholder: "{{ $input.وضعیت }}" },
      { key: "cases", label: "حالت‌ها (JSON)", type: "json", default: [{ value: "الف" }, { value: "ب" }], placeholder: '[{"value":"الف"},{"value":"ب"}]' },
    ],
  },
  {
    type: "sort", label: "مرتب‌سازی", group: "منطق",
    description: "آیتم‌ها را بر اساس یک فیلد مرتب می‌کند.",
    fields: [
      { key: "field", label: "نام فیلد", type: "text", placeholder: "مبلغ" },
      { key: "order", label: "ترتیب", type: "select", default: "asc", options: [{ value: "asc", label: "صعودی" }, { value: "desc", label: "نزولی" }] },
      { key: "numeric", label: "مقایسه‌ی عددی", type: "select", default: "false", options: [{ value: "false", label: "خیر (متنی)" }, { value: "true", label: "بله (عددی)" }] },
    ],
  },
  {
    type: "merge", label: "ادغام شاخه‌ها", group: "منطق",
    description: "آیتم‌های چند شاخه را یکی می‌کند: پشت‌سرهم، تک‌آیتم یا حذف تکراری.",
    fields: [
      { key: "mode", label: "حالت", type: "select", default: "append", options: [
        { value: "append", label: "پشت‌سرهم" }, { value: "single", label: "ادغام در یک آیتم" }, { value: "unique", label: "حذف تکراری" } ] },
      { key: "field", label: "فیلد یکتا (برای حذف تکراری)", type: "text" },
    ],
  },
  {
    type: "splitOut", label: "حلقه روی فهرست", group: "منطق",
    description: "یک فیلدِ فهرست را به چند آیتم می‌شکند تا گره‌های بعدی برای هر عضو جدا اجرا شوند.",
    fields: [
      { key: "field", label: "نام فیلد فهرست", type: "text", placeholder: "items" },
      { key: "keepParent", label: "نگه‌داشتن فیلدهای اصلی", type: "select", default: "false", options: [{ value: "false", label: "خیر" }, { value: "true", label: "بله" }] },
    ],
  },
  {
    type: "aggregate", label: "جمع‌کردن آیتم‌ها", group: "منطق",
    description: "همه‌ی آیتم‌ها را در یک فهرست جمع می‌کند (برعکس «حلقه روی فهرست»).",
    fields: [
      { key: "field", label: "فقط این فیلد (اختیاری)", type: "text" },
      { key: "outputField", label: "نام فیلد خروجی", type: "text", default: "items" },
    ],
  },
  {
    type: "date", label: "تاریخ و تقویم شمسی", group: "داده",
    description: "تاریخ فعلی، تبدیل میلادی↔شمسی و افزودن روز. تاریخ میلادی با قالب 2026-11-18 و شمسی با 1405/08/27.",
    fields: [
      { key: "op", label: "عملیات", type: "select", default: "now", options: [
        { value: "now", label: "اکنون (تهران)" }, { value: "toJalali", label: "میلادی به شمسی" },
        { value: "fromJalali", label: "شمسی به میلادی" }, { value: "addDays", label: "افزودن روز (میلادی)" } ] },
      { key: "value", label: "تاریخ ورودی", type: "text", placeholder: "{{ $input.تاریخ }}" },
      { key: "days", label: "تعداد روز (برای افزودن)", type: "number" },
      { key: "outputField", label: "نام فیلد خروجی", type: "text", default: "date" },
    ],
  },
  {
    type: "csvParse", label: "CSV: خواندن", group: "داده",
    description: "متن CSV را به آیتم تبدیل می‌کند (هر ردیف یک آیتم).",
    fields: [
      { key: "text", label: "متن CSV", type: "textarea", placeholder: "{{ $input.csv }}" },
      { key: "delimiter", label: "جداکننده", type: "text", default: "," },
      { key: "hasHeader", label: "ردیف اول سرتیتر است", type: "select", default: "true", options: [{ value: "true", label: "بله" }, { value: "false", label: "خیر" }] },
    ],
  },
  {
    type: "csvStringify", label: "CSV: نوشتن", group: "داده",
    description: "آیتم‌ها را به متن CSV (سازگار با اکسل فارسی) تبدیل می‌کند.",
    fields: [
      { key: "delimiter", label: "جداکننده", type: "text", default: "," },
      { key: "outputField", label: "نام فیلد خروجی", type: "text", default: "csv" },
      { key: "bom", label: "BOM برای اکسل", type: "select", default: "true", options: [{ value: "true", label: "بله" }, { value: "false", label: "خیر" }] },
    ],
  },
  {
    type: "smtp", label: "ایمیل (SMTP)", group: "ایمیل",
    description: "ارسال ایمیل از طریق سرور SMTP خودتان.",
    fields: [
      { key: "host", label: "سرور SMTP", type: "text", placeholder: "smtp.example.com" },
      { key: "port", label: "پورت", type: "number", default: 587 },
      { key: "secure", label: "اتصال امن (SSL، معمولاً پورت ۴۶۵)", type: "select", default: "false", options: [{ value: "false", label: "خیر (STARTTLS)" }, { value: "true", label: "بله" }] },
      { key: "user", label: "نام کاربری", type: "text" },
      { key: "password", label: "رمز", type: "secret" },
      { key: "from", label: "فرستنده", type: "text", placeholder: "me@example.com" },
      { key: "to", label: "گیرنده (با ویرگول چندتا)", type: "text" },
      { key: "subject", label: "موضوع", type: "text" },
      { key: "body", label: "متن", type: "textarea" },
      { key: "html", label: "متن HTML است", type: "select", default: "false", options: [{ value: "false", label: "خیر" }, { value: "true", label: "بله" }] },
    ],
  },
  ...(["sheetsRead", "sheetsAppend", "sheetsUpdate"] as const).map((type): NodeTypeDef => ({
    type,
    label: { sheetsRead: "گوگل شیت: خواندن", sheetsAppend: "گوگل شیت: افزودن ردیف", sheetsUpdate: "گوگل شیت: به‌روزرسانی" }[type],
    group: "داده",
    description: "با حساب سرویس گوگل؛ صفحه‌گسترده را با ایمیل حساب سرویس به اشتراک بگذارید.",
    fields: [
      { key: "serviceAccount", label: "کلید حساب سرویس (JSON)", type: "secret" },
      { key: "spreadsheetId", label: "شناسه‌ی صفحه‌گسترده", type: "text" },
      { key: "range", label: "محدوده", type: "text", placeholder: "Sheet1!A1:D100" },
      ...(type === "sheetsRead"
        ? [{ key: "header", label: "ردیف اول سرتیتر است", type: "select", default: "true", options: [{ value: "true", label: "بله" }, { value: "false", label: "خیر" }] } as FieldDef]
        : [{ key: "values", label: "مقدارها (JSON: فهرست ردیف‌ها)", type: "json", placeholder: '[["{{ $input.نام }}", 1]]' } as FieldDef]),
    ],
  })),
  ...(["postgres", "mysql"] as const).map((type): NodeTypeDef => ({
    type, label: type === "postgres" ? "PostgreSQL" : "MySQL", group: "پایگاه‌داده",
    description: `اجرای دستور SQL. مقدارها را فقط با ${type === "postgres" ? "$1 و $2" : "؟"} و فیلد «مقدارها» بدهید (جلوگیری از تزریق SQL). حداکثر ۱۰۰۰ ردیف.`,
    fields: [
      { key: "host", label: "میزبان", type: "text" },
      { key: "port", label: "پورت", type: "number", default: type === "postgres" ? 5432 : 3306 },
      { key: "database", label: "نام پایگاه‌داده", type: "text" },
      { key: "user", label: "نام کاربری", type: "text" },
      { key: "password", label: "رمز", type: "secret" },
      { key: "ssl", label: "SSL", type: "select", default: "false", options: [{ value: "false", label: "خیر" }, { value: "true", label: "بله" }] },
      { key: "query", label: "دستور SQL", type: "textarea", placeholder: type === "postgres" ? "select * from users where age > $1" : "select * from users where age > ?" },
      { key: "values", label: "مقدارها (JSON)", type: "json", placeholder: '["{{ $input.سن }}"]' },
    ],
  })),
  {
    type: "llm", label: "هوش مصنوعی", group: "هوش مصنوعی",
    description: "خلاصه‌سازی، دسته‌بندی، پاسخ خودکار یا دستور دلخواه با هر سرویس سازگار با OpenAI (نشانی و مدل را خودتان می‌دهید).",
    fields: [
      { key: "baseUrl", label: "نشانی سرویس", type: "text", default: "https://api.openai.com/v1" },
      { key: "apiKey", label: "کلید API", type: "secret" },
      { key: "model", label: "مدل", type: "text", placeholder: "gpt-4o-mini" },
      { key: "mode", label: "کار", type: "select", default: "summarize", options: [
        { value: "summarize", label: "خلاصه‌سازی" }, { value: "classify", label: "دسته‌بندی" },
        { value: "reply", label: "پاسخ خودکار" }, { value: "custom", label: "دستور دلخواه" } ] },
      { key: "text", label: "متن ورودی", type: "textarea", placeholder: "{{ $input.text }}" },
      { key: "categories", label: "دسته‌ها (برای دسته‌بندی، با ویرگول)", type: "text", placeholder: "شکایت, پرسش, تعریف" },
      { key: "prompt", label: "دستور (برای حالت دلخواه)", type: "textarea" },
    ],
  },
  {
    type: "code", label: "کد (جاوااسکریپت)", group: "کد",
    description: "کد شما در فرایند جدا و محدود اجرا می‌شود (۵ ثانیه، ۶۴ مگابایت، بدون فایل و شبکه‌ی آزاد). متغیر items همه‌ی آیتم‌هاست؛ با return فهرستی از شیءها برگردانید. async پشتیبانی نمی‌شود.",
    fields: [
      { key: "code", label: "کد", type: "textarea", default: "return items.map(i => ({ ...i }));" },
    ],
  },
];
/** فیلدهای رازدار هر نوع گره (در پاسخ API پوشانده می‌شوند) */
export const SECRET_KEYS: Record<string, Set<string>> = Object.fromEntries(
  NODE_TYPES.map((t) => [t.type, new Set(t.fields.filter((f) => f.type === "secret").map((f) => f.key))]),
);
