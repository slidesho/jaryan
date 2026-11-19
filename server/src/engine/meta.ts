// ویژگی‌های اجرایی هر نوع گره

/** گره‌هایی که برای هر آیتم جدا اجرا می‌شوند (عبارت‌ها روی همان آیتم حل می‌شوند) */
export const PER_ITEM_TYPES = new Set([
  "set", "condition", "filter", "switch", "http", "date", "splitOut", "csvParse",
  "telegram", "bale", "kavenegarSms", "kavenegarVerify", "smtp",
  "sheetsRead", "sheetsAppend", "sheetsUpdate", "postgres", "mysql", "llm",
]);

/** نوع‌هایی که می‌توانند گردش‌کار را شروع کنند */
export const TRIGGER_TYPES = new Set(["trigger", "schedule", "telegramTrigger", "baleTrigger"]);

export const MAX_RETRY_TIMES = 5;
export const MAX_RETRY_DELAY_MS = 10_000;

/** پارامترهایی که عبارت‌ها در آن‌ها جایگذاری نمی‌شود (جلوگیری از تزریق SQL؛ به‌جایش از $1 و values استفاده شود) */
export const RAW_PARAMS: Record<string, string[]> = { postgres: ["query"], mysql: ["query"], code: ["code"] };
