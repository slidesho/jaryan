import { createSign } from "node:crypto";
import type { Item, NodeHandler } from "./types.js";

/**
 * گره‌های سرویس: ایمیل (SMTP)، گوگل شیت، پایگاه‌داده (PostgreSQL و MySQL) و هوش مصنوعی.
 * وابستگی‌های بیرونی تزریق‌پذیرند تا آزمون‌ها بدون شبکه اجرا شوند.
 * رمزها و کلیدها هرگز در پیام خطا یا خروجی نمی‌آیند.
 */

export interface MailTransport { sendMail(msg: Record<string, unknown>): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>; close?(): void }
export interface DbClient { query(sql: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[]; affected?: number }>; end(): Promise<void> }

export interface ServiceDeps {
  createTransport(o: { host: string; port: number; secure: boolean; auth?: { user: string; pass: string } }): MailTransport;
  connectPostgres(o: { host: string; port: number; database: string; user: string; password: string; ssl: boolean }): Promise<DbClient>;
  connectMysql(o: { host: string; port: number; database: string; user: string; password: string; ssl: boolean }): Promise<DbClient>;
}

const MAX_ROWS = 1000;
const str = (v: unknown, label: string): string => {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${label} الزامی است`);
  return v;
};
const base = (items: Item[]): Item[] => (items.length ? items : [{}]);
const scrub = (msg: string, ...secrets: unknown[]) =>
  secrets.reduce<string>((m, s) => (typeof s === "string" && s.length >= 4 ? m.split(s).join("***") : m), msg);

// ───────── ایمیل ─────────
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
function emails(v: unknown, label: string): string[] {
  const list = String(v ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (list.length === 0) throw new Error(`${label} الزامی است`);
  if (list.length > 20) throw new Error(`${label}: حداکثر ۲۰ نشانی`);
  for (const e of list) if (!EMAIL_RE.test(e)) throw new Error(`${label} نامعتبر است: «${e}»`);
  return list;
}

function smtpNode(deps: ServiceDeps): NodeHandler {
  return async (ctx, items) => {
    const p = ctx.params;
    const host = str(p.host, "سرور SMTP");
    const port = Number(p.port ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("پورت نامعتبر است");
    const to = emails(p.to, "گیرنده");
    const from = emails(p.from, "فرستنده");
    if (from.length !== 1) throw new Error("فرستنده باید یک نشانی باشد");
    const subject = str(p.subject, "موضوع");
    if (/[\r\n]/.test(subject) || subject.length > 300) throw new Error("موضوع نامعتبر است");
    const text = str(p.body, "متن ایمیل");
    if (text.length > 200_000) throw new Error("متن ایمیل بیش از حد بزرگ است");
    const secure = p.secure === true || p.secure === "true" || port === 465;
    const user = typeof p.user === "string" && p.user ? p.user : "";
    const pass = typeof p.password === "string" ? p.password : "";
    const tr = deps.createTransport({ host, port, secure, ...(user ? { auth: { user, pass } } : {}) });
    try {
      const info = await tr.sendMail({ from: from[0], to, subject, [p.html === true || p.html === "true" ? "html" : "text"]: text });
      if (info.rejected && info.rejected.length) throw new Error("برخی گیرنده‌ها پذیرفته نشدند");
      return { main: base(items).map((it) => ({ ...it, email: { messageId: info.messageId, accepted: info.accepted } })) };
    } catch (e) {
      throw new Error(`ارسال ایمیل ناموفق بود: ${scrub((e as Error).message, pass, user)}`);
    } finally { tr.close?.(); }
  };
}

// ───────── گوگل شیت (حساب سرویس) ─────────
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const tokenCache = new Map<string, { token: string; exp: number }>();

export async function googleToken(ctx: Parameters<NodeHandler>[0], raw: unknown): Promise<string> {
  let key: { client_email?: string; private_key?: string };
  try { key = JSON.parse(str(raw, "کلید حساب سرویس")); } catch { throw new Error("کلید حساب سرویس JSON معتبر نیست"); }
  if (!key.client_email || !key.private_key) throw new Error("کلید حساب سرویس ناقص است");
  const cached = tokenCache.get(key.client_email);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({
    iss: key.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  let sig: string;
  try { sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key.private_key, "base64url"); }
  catch { throw new Error("کلید خصوصی حساب سرویس نامعتبر است"); }
  const res = await ctx.fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`دریافت دسترسی گوگل ناموفق بود${data.error ? ` (${data.error})` : ""}`);
  tokenCache.set(key.client_email, { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

async function sheetsCall(ctx: Parameters<NodeHandler>[0], path: string, init: { method: string; body?: unknown; query?: Record<string, string> }) {
  const token = await googleToken(ctx, ctx.params.serviceAccount);
  const id = str(ctx.params.spreadsheetId, "شناسه‌ی صفحه‌گسترده");
  if (!/^[\w-]{10,}$/.test(id)) throw new Error("شناسه‌ی صفحه‌گسترده نامعتبر است");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${path}${init.query ? `?${new URLSearchParams(init.query)}` : ""}`;
  const res = await ctx.fetch(url, {
    method: init.method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & Record<string, unknown>;
  if (!res.ok) throw new Error(`گوگل شیت خطا داد (کد ${data.error?.code ?? res.status})${data.error?.message ? `: ${data.error.message}` : ""}`);
  return data;
}
const range = (ctx: Parameters<NodeHandler>[0]) => {
  const r = str(ctx.params.range, "محدوده");
  if (!/^[^!]{1,100}(![A-Za-z]{1,3}\d{0,7}(:[A-Za-z]{1,3}\d{0,7})?)?$|^[A-Za-z]{1,3}\d{0,7}(:[A-Za-z]{1,3}\d{0,7})?$/.test(r)) throw new Error("محدوده نامعتبر است (نمونه: Sheet1!A1:D100)");
  return encodeURIComponent(r);
};
const cells = (v: unknown): unknown[][] => {
  let x = v;
  if (typeof x === "string") { try { x = JSON.parse(x); } catch { throw new Error("مقدارها باید JSON معتبر باشند"); } }
  if (!Array.isArray(x) || x.length === 0 || x.length > 1000) throw new Error("مقدارها باید فهرست ردیف‌ها (۱ تا ۱۰۰۰) باشند");
  return x.map((r) => (Array.isArray(r) ? r : [r]).map((c: unknown) => (c !== null && typeof c === "object" ? JSON.stringify(c) : c)));
};

const sheetsRead: NodeHandler = async (ctx, items) => {
  const data = await sheetsCall(ctx, range(ctx), { method: "GET" });
  const rows = (data.values as unknown[][] | undefined) ?? [];
  if (rows.length > MAX_ROWS) throw new Error(`حداکثر ${MAX_ROWS} ردیف مجاز است`);
  const useHeader = ctx.params.header !== false && ctx.params.header !== "false";
  const head = useHeader ? (rows.shift() ?? []).map(String) : undefined;
  void items;
  return { main: rows.map((r) => (head ? Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])) : Object.fromEntries(r.map((c, i) => [`ستون${i + 1}`, c])))) };
};
const sheetsAppend: NodeHandler = async (ctx, items) => {
  const data = await sheetsCall(ctx, `${range(ctx)}:append`, { method: "POST", body: { values: cells(ctx.params.values) }, query: { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" } });
  return { main: base(items).map((it) => ({ ...it, sheets: (data.updates as unknown) ?? {} })) };
};
const sheetsUpdate: NodeHandler = async (ctx, items) => {
  const data = await sheetsCall(ctx, range(ctx), { method: "PUT", body: { values: cells(ctx.params.values) }, query: { valueInputOption: "USER_ENTERED" } });
  return { main: base(items).map((it) => ({ ...it, sheets: { updatedRange: data.updatedRange, updatedCells: data.updatedCells } })) };
};

// ───────── پایگاه‌داده ─────────
function dbNode(kind: "postgres" | "mysql", deps: ServiceDeps): NodeHandler {
  return async (ctx, items) => {
    const p = ctx.params;
    const query = str(p.query, "دستور SQL");
    if (query.includes("{{")) throw new Error("در SQL از عبارت {{ }} استفاده نکنید؛ مقدارها را با " + (kind === "postgres" ? "$1، $2" : "؟") + " و فیلد «مقدارها» بدهید");
    if (query.length > 20_000) throw new Error("دستور SQL بیش از حد بزرگ است");
    let values: unknown = p.values ?? [];
    if (typeof values === "string") { try { values = values.trim() ? JSON.parse(values) : []; } catch { throw new Error("مقدارها باید فهرست JSON معتبر باشند"); } }
    if (!Array.isArray(values) || values.length > 100) throw new Error("مقدارها باید فهرستی حداکثر ۱۰۰تایی باشند");
    const port = Number(p.port ?? (kind === "postgres" ? 5432 : 3306));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("پورت نامعتبر است");
    const password = typeof p.password === "string" ? p.password : "";
    const cfg = {
      host: str(p.host, "میزبان پایگاه‌داده"), port, database: str(p.database, "نام پایگاه‌داده"),
      user: str(p.user, "نام کاربری"), password, ssl: p.ssl === true || p.ssl === "true",
    };
    let db: DbClient;
    try { db = await (kind === "postgres" ? deps.connectPostgres(cfg) : deps.connectMysql(cfg)); }
    catch (e) { throw new Error(`اتصال به پایگاه‌داده ناموفق بود: ${scrub((e as Error).message, password, cfg.user)}`); }
    try {
      const r = await db.query(query, values as unknown[]);
      if (r.rows.length > MAX_ROWS) throw new Error(`نتیجه بیش از ${MAX_ROWS} ردیف است؛ از LIMIT استفاده کنید`);
      void items;
      return { main: r.rows.length ? r.rows : [{ affectedRows: r.affected ?? 0 }] };
    } catch (e) {
      throw new Error(`اجرای SQL ناموفق بود: ${scrub((e as Error).message, password)}`);
    } finally { await db.end().catch(() => {}); }
  };
}

// ───────── هوش مصنوعی (سازگار با OpenAI) ─────────
const PROMPTS: Record<string, string> = {
  summarize: "متن زیر را به فارسی روان در حداکثر چند جمله‌ی کوتاه خلاصه کن. فقط خلاصه را بنویس.",
  reply: "به پیام زیر به فارسی، مؤدبانه و کوتاه پاسخ بده. فقط متن پاسخ را بنویس.",
};

const llm: NodeHandler = async (ctx, items) => {
  const p = ctx.params;
  const apiKey = str(p.apiKey, "کلید API");
  const baseUrl = str(p.baseUrl ?? "https://api.openai.com/v1", "نشانی سرویس").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(baseUrl)) throw new Error("نشانی سرویس باید با http یا https شروع شود");
  const model = str(p.model, "نام مدل");
  const mode = String(p.mode ?? "summarize");
  const text = str(String(p.text ?? ""), "متن ورودی");
  if (text.length > 20_000) throw new Error("متن ورودی بیش از ۲۰٬۰۰۰ نویسه است");
  let system: string;
  let cats: string[] = [];
  if (mode === "classify") {
    cats = String(p.categories ?? "").split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
    if (cats.length < 2 || cats.length > 20) throw new Error("برای دسته‌بندی ۲ تا ۲۰ دسته (جداشده با ویرگول) لازم است");
    system = `متن کاربر را در دقیقاً یکی از این دسته‌ها قرار بده: ${cats.join("، ")}. فقط نام دسته را بنویس و هیچ چیز دیگری ننویس.`;
  } else if (mode === "custom") system = str(p.prompt, "دستور (پرامپت)");
  else if (PROMPTS[mode]) system = PROMPTS[mode];
  else throw new Error(`حالت ناشناخته است: ${mode}`);
  const res = await ctx.fetch(`${baseUrl}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: 800, messages: [{ role: "system", content: system }, { role: "user", content: text }] }),
  });
  const data = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`سرویس هوش مصنوعی خطا داد (کد ${res.status})${data.error?.message ? `: ${scrub(data.error.message, apiKey)}` : ""}`);
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("سرویس هوش مصنوعی پاسخی نداد");
  let result: Record<string, unknown> = { ai: answer };
  if (mode === "classify") {
    const label = cats.find((c) => c === answer) ?? cats.find((c) => answer.includes(c));
    result = { ai: label ?? "نامشخص", aiRaw: answer, aiMatched: Boolean(label) };
  }
  return { main: base(items).map((it) => ({ ...it, ...result })) };
};

export function createServiceNodes(deps: ServiceDeps): Record<string, NodeHandler> {
  return {
    smtp: smtpNode(deps), sheetsRead, sheetsAppend, sheetsUpdate,
    postgres: dbNode("postgres", deps), mysql: dbNode("mysql", deps), llm,
  };
}

// ───────── پیاده‌سازی واقعی ─────────
export const realDeps: ServiceDeps = {
  createTransport(o) {
    // بارگذاری تنبل تا نبود بسته در ساخت دمو مشکل نسازد
    let t: MailTransport | undefined;
    const get = async () => (t ??= (await import("nodemailer")).default.createTransport({ ...o, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 }) as unknown as MailTransport);
    return { sendMail: async (m) => (await get()).sendMail(m), close: () => t?.close?.() };
  },
  async connectPostgres(o) {
    const pg = (await import("pg")).default;
    const c = new pg.Client({ host: o.host, port: o.port, database: o.database, user: o.user, password: o.password, ssl: o.ssl ? { rejectUnauthorized: true } : false, connectionTimeoutMillis: 10_000, statement_timeout: 15_000, query_timeout: 20_000 });
    await c.connect();
    return { query: async (sql, values) => { const r = await c.query(sql, values); return { rows: r.rows as Record<string, unknown>[], affected: r.rowCount ?? 0 }; }, end: () => c.end() };
  },
  async connectMysql(o) {
    const mysql = await import("mysql2/promise");
    const c = await mysql.createConnection({ host: o.host, port: o.port, database: o.database, user: o.user, password: o.password, ssl: o.ssl ? { rejectUnauthorized: true } : undefined, connectTimeout: 10_000 });
    return {
      query: async (sql, values) => {
        const [r] = await c.query({ sql, values: values as never, timeout: 15_000 });
        if (Array.isArray(r)) return { rows: r as Record<string, unknown>[] };
        return { rows: [], affected: (r as { affectedRows?: number }).affectedRows ?? 0 };
      },
      end: () => c.end(),
    };
  },
};
export const serviceNodes = createServiceNodes(realDeps);
