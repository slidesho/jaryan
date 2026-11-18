// کاتالوگ گره‌ها: نام فارسی و فیلدهای پارامتر برای رابط

export type FieldType = "text" | "number" | "json" | "select" | "secret";

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
  group: "محرک" | "پایه" | "پیام‌رسان" | "پیامک";
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
          { value: "contains", label: "شامل" }, { value: "isEmpty", label: "خالی است" },
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
    ],
  },
  {
    type: "bale", label: "بله: ارسال پیام", group: "پیام‌رسان",
    description: "ارسال پیام با بات بله.",
    fields: [
      { key: "token", label: "توکن بات", type: "secret" },
      { key: "chatId", label: "شناسه‌ی گفتگو", type: "text" },
      { key: "text", label: "متن پیام", type: "text" },
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
];

export const SECRET_KEYS: Record<string, Set<string>> = Object.fromEntries(
  NODE_TYPES.map((t) => [t.type, new Set(t.fields.filter((f) => f.type === "secret").map((f) => f.key))]),
);
