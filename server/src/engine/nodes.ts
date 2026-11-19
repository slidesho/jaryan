import { compare } from "./data-nodes.js";
import type { Item, NodeHandler } from "./types.js";

/** محرک دستی/وب‌هوک: ورودی را همان‌طور عبور می‌دهد */
const trigger: NodeHandler = async (_ctx, items) => ({ main: items });

/** تبدیل داده: فیلدهای ثابت یا محاسبه‌شده را به هر آیتم اضافه می‌کند */
const set: NodeHandler = async (ctx, items) => {
  const fields = (ctx.params.fields ?? {}) as Record<string, unknown>;
  return { main: items.map((it) => ({ ...it, ...fields })) };
};

/** شرط: هر آیتم را بر اساس مقایسه به خروجی true یا false می‌فرستد */
const condition: NodeHandler = async (ctx, items) => {
  const { left, op = "equals", right } = ctx.params as { left?: unknown; op?: string; right?: unknown };
  const t: Item[] = [];
  const f: Item[] = [];
  for (const it of items) {
    (compare(left, op, right) ? t : f).push(it);
  }
  return { true: t, false: f };
};

/** درخواست HTTP */
const http: NodeHandler = async (ctx, items) => {
  const { url, method = "GET", headers, body } = ctx.params as {
    url?: string; method?: string; headers?: Record<string, string>; body?: unknown;
  };
  if (!url || !/^https?:\/\//i.test(url)) throw new Error("نشانی درخواست نامعتبر است");
  const res = await ctx.fetch(url, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined && method !== "GET" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* متن ساده */ }
  if (!res.ok) throw new Error(`پاسخ HTTP ${res.status}`);
  const base = items.length ? items : [{}];
  return { main: base.map((it) => ({ ...it, status: res.status, data })) };
};

/** تأخیر */
const delay: NodeHandler = async (ctx, items) => {
  const ms = Number(ctx.params.ms ?? 0);
  if (!Number.isFinite(ms) || ms < 0 || ms > 60_000) throw new Error("مقدار تأخیر باید بین ۰ تا ۶۰۰۰۰ میلی‌ثانیه باشد");
  await ctx.sleep(ms);
  return { main: items };
};

export const builtinNodes: Record<string, NodeHandler> = {
  trigger,
  schedule: trigger,
  telegramTrigger: trigger,
  baleTrigger: trigger,
  set,
  condition,
  http,
  delay,
};
