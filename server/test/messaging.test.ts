import { describe, expect, it } from "vitest";
import { executeWorkflow } from "../src/engine/executor.js";
import type { Workflow } from "../src/engine/types.js";

const TOKEN = "123456:ABC-DEF1234ghIkl";

function one(type: string, params: Record<string, unknown>): Workflow {
  return {
    id: "w", name: "t",
    nodes: [
      { id: "t", name: "شروع", type: "trigger", params: {} },
      { id: "m", name: "پیام", type: type, params },
    ],
    connections: [{ from: "t", to: "m" }],
  };
}

function recorder(reply: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("بله و تلگرام", () => {
  it("بله: نشانی و بدنه‌ی درست می‌فرستد", async () => {
    const { f, calls } = recorder({ ok: true, result: { message_id: 7 } });
    const r = await executeWorkflow(one("bale", { token: TOKEN, chatId: "123", text: "سلام {{ $input.نام }}" }), [{ نام: "علی" }], { fetch: f });
    expect(r.status).toBe("success");
    expect(calls[0].url).toBe(`https://tapi.bale.ai/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ chat_id: "123", text: "سلام علی" });
    expect(r.runs[1].output.main[0].sent).toEqual({ message_id: 7 });
  });
  it("تلگرام: از نشانی تلگرام استفاده می‌کند", async () => {
    const { f, calls } = recorder({ ok: true, result: {} });
    await executeWorkflow(one("telegram", { token: TOKEN, chatId: 1, text: "x" }), [{}], { fetch: f });
    expect(calls[0].url.startsWith("https://api.telegram.org/bot")).toBe(true);
  });
  it("خطای سرویس را فارسی نشان می‌دهد و توکن را فاش نمی‌کند", async () => {
    const { f } = recorder({ ok: false, error_code: 400, description: "chat not found" }, 400);
    const r = await executeWorkflow(one("bale", { token: TOKEN, chatId: "9", text: "x" }), [{}], { fetch: f });
    expect(r.status).toBe("error");
    expect(r.error).toContain("400");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("توکن بدشکل و متن بلند را رد می‌کند", async () => {
    const { f, calls } = recorder({ ok: true });
    const a = await executeWorkflow(one("bale", { token: "x/../y", chatId: "1", text: "x" }), [{}], { fetch: f });
    const b = await executeWorkflow(one("bale", { token: TOKEN, chatId: "1", text: "ا".repeat(4097) }), [{}], { fetch: f });
    expect(a.status).toBe("error");
    expect(b.status).toBe("error");
    expect(calls.length).toBe(0);
  });
});

describe("کاوه‌نگار", () => {
  it("پیامک ساده را می‌فرستد", async () => {
    const { f, calls } = recorder({ return: { status: 200, message: "تایید شد" }, entries: [{ messageid: 1 }] });
    const r = await executeWorkflow(one("kavenegarSms", { apiKey: "KEY123", receptor: "09121234567", message: "سلام" }), [{}], { fetch: f });
    expect(r.status).toBe("success");
    expect(calls[0].url).toBe("https://api.kavenegar.com/v1/KEY123/sms/send.json");
    expect(String(calls[0].init?.body)).toContain("receptor=09121234567");
  });
  it("کد ورود با الگو (verify/lookup)", async () => {
    const { f, calls } = recorder({ return: { status: 200 }, entries: [] });
    const r = await executeWorkflow(one("kavenegarVerify", { apiKey: "KEY123", receptor: "09121234567", template: "login", token: 4821 }), [{}], { fetch: f });
    expect(r.status).toBe("success");
    expect(calls[0].url).toContain("/verify/lookup.json");
  });
  it("کد خطای کاوه‌نگار و شماره‌ی نامعتبر را رد می‌کند", async () => {
    const { f, calls } = recorder({ return: { status: 407, message: "خطا" } });
    const bad = await executeWorkflow(one("kavenegarSms", { apiKey: "KEY123", receptor: "09121234567", message: "x" }), [{}], { fetch: f });
    expect(bad.error).toContain("407");
    expect(JSON.stringify(bad)).not.toContain("KEY123");
    const n = calls.length;
    const phone = await executeWorkflow(one("kavenegarSms", { apiKey: "KEY123", receptor: "123", message: "x" }), [{}], { fetch: f });
    expect(phone.status).toBe("error");
    expect(calls.length).toBe(n);
  });
});
