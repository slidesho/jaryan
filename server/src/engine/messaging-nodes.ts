import type { Item, NodeHandler } from "./types.js";

/**
 * گره‌های پیام‌رسان و پیامک.
 * اعتبارنامه (توکن/کلید) فعلاً از پارامتر گره می‌آید؛ در فاز اعتبارنامه‌ها
 * از مخزن رمزنگاری‌شده خوانده و پیش از اجرا تزریق می‌شود.
 * توکن هرگز در پیام خطا یا خروجی گره نمی‌آید.
 */

const BOT_BASES: Record<string, string> = {
  telegram: "https://api.telegram.org",
  bale: "https://tapi.bale.ai", // مستندات رسمی: docs.bale.ai
};

function requireString(v: unknown, label: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${label} الزامی است`);
  return v;
}

/** ارسال پیام با بات API سازگار با تلگرام (تلگرام و بله) */
function botSendMessage(kind: "telegram" | "bale"): NodeHandler {
  return async (ctx, items) => {
    const token = requireString(ctx.params.token, "توکن بات");
    if (!/^\d+:[\w-]+$/.test(token)) throw new Error("قالب توکن بات نامعتبر است");
    const chatId = ctx.params.chatId;
    if (chatId === undefined || chatId === null || chatId === "") throw new Error("شناسه‌ی گفتگو الزامی است");
    const text = requireString(ctx.params.text, "متن پیام");
    if (text.length > 4096) throw new Error("متن پیام نباید از ۴۰۹۶ نویسه بیشتر باشد");

    const res = await ctx.fetch(`${BOT_BASES[kind]}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean; result?: unknown; description?: string; error_code?: number;
    };
    if (!res.ok || data.ok !== true) {
      const why = data.description ? `: ${data.description}` : "";
      throw new Error(`ارسال به ${kind === "bale" ? "بله" : "تلگرام"} ناموفق بود (کد ${data.error_code ?? res.status})${why}`);
    }
    const base: Item[] = items.length ? items : [{}];
    return { main: base.map((it) => ({ ...it, sent: data.result })) };
  };
}

interface KavenegarReply {
  return?: { status?: number; message?: string };
  entries?: unknown;
}

async function kavenegarCall(
  ctx: Parameters<NodeHandler>[0],
  path: "sms/send" | "verify/lookup",
  params: Record<string, string>,
): Promise<KavenegarReply> {
  const apiKey = requireString(ctx.params.apiKey, "کلید API کاوه‌نگار");
  if (!/^[\w+/=-]+$/.test(apiKey)) throw new Error("قالب کلید API نامعتبر است");
  const res = await ctx.fetch(`https://api.kavenegar.com/v1/${apiKey}/${path}.json`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as KavenegarReply;
  const status = data.return?.status ?? res.status;
  if (status !== 200) {
    throw new Error(`کاوه‌نگار خطا داد (کد ${status})${data.return?.message ? `: ${data.return.message}` : ""}`);
  }
  return data;
}

function checkPhone(v: unknown): string {
  const s = requireString(v, "شماره‌ی گیرنده");
  if (!/^(\+98|0098|98|0)?9\d{9}$/.test(s)) throw new Error("شماره‌ی گیرنده نامعتبر است");
  return s;
}

const kavenegarSms: NodeHandler = async (ctx, items) => {
  const receptor = checkPhone(ctx.params.receptor);
  const message = requireString(ctx.params.message, "متن پیامک");
  const sender = typeof ctx.params.sender === "string" ? ctx.params.sender : "";
  const data = await kavenegarCall(ctx, "sms/send", { receptor, message, ...(sender ? { sender } : {}) });
  const base: Item[] = items.length ? items : [{}];
  return { main: base.map((it) => ({ ...it, sms: data.entries })) };
};

const kavenegarVerify: NodeHandler = async (ctx, items) => {
  const receptor = checkPhone(ctx.params.receptor);
  const template = requireString(ctx.params.template, "نام الگو");
  const token = requireString(String(ctx.params.token ?? ""), "مقدار توکن الگو");
  const data = await kavenegarCall(ctx, "verify/lookup", { receptor, template, token });
  const base: Item[] = items.length ? items : [{}];
  return { main: base.map((it) => ({ ...it, sms: data.entries })) };
};

export const messagingNodes: Record<string, NodeHandler> = {
  telegram: botSendMessage("telegram"),
  bale: botSendMessage("bale"),
  kavenegarSms,
  kavenegarVerify,
};
