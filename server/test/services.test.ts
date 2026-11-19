import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { executeWorkflow } from "../src/engine/executor.js";
import { buildReplyMarkup } from "../src/engine/messaging-nodes.js";
import { createServiceNodes, realDeps, type DbClient, type ServiceDeps } from "../src/engine/service-nodes.js";
import type { WorkflowNode, Workflow } from "../src/engine/types.js";

const noSleep = async () => {};
const T: WorkflowNode = { id: "t", name: "شروع", type: "trigger", params: {} };
const wf = (type: string, params: Record<string, unknown>): Workflow => ({
  id: "w", name: "تست", nodes: [T, { id: "n", name: "گره", type, params }], connections: [{ from: "t", to: "n" }],
});

function deps(over: Partial<ServiceDeps> = {}): ServiceDeps {
  return { ...realDeps, ...over };
}
const run = (type: string, params: Record<string, unknown>, d: ServiceDeps, input: Record<string, unknown>[] = [{}], fetchFn?: typeof fetch) =>
  executeWorkflow(wf(type, params), input, { handlers: createServiceNodes(d), sleep: noSleep, ...(fetchFn ? { fetch: fetchFn } : {}) });
const node = (r: Awaited<ReturnType<typeof run>>) => r.runs[1];

describe("SMTP", () => {
  const sent: Record<string, unknown>[] = [];
  const d = deps({ createTransport: () => ({ sendMail: async (m) => { sent.push(m); return { messageId: "id1", accepted: ["a@b.com"], rejected: [] }; } }) });
  const ok = { host: "smtp.example.com", from: "me@example.com", to: "a@b.com", subject: "سلام {{ $input.n }}", body: "متن", password: "p4ssw0rd" };

  it("ایمیل را با عبارت‌ها می‌فرستد", async () => {
    const r = await run("smtp", ok, d, [{ n: "علی" }]);
    expect(r.status).toBe("success");
    expect(sent[0]).toMatchObject({ from: "me@example.com", to: ["a@b.com"], subject: "سلام علی", text: "متن" });
  });
  it("نشانی و سرتیتر نامعتبر را رد می‌کند", async () => {
    expect((await run("smtp", { ...ok, to: "bad" }, d)).status).toBe("error");
    expect((await run("smtp", { ...ok, subject: "a\r\nBcc: x@y.com" }, d)).status).toBe("error");
  });
  it("رمز در خطا فاش نمی‌شود", async () => {
    const bad = deps({ createTransport: () => ({ sendMail: async () => { throw new Error("auth failed for p4ssw0rd"); } }) });
    const r = await run("smtp", { ...ok, user: "u@example.com" }, bad);
    expect(r.status).toBe("error");
    expect(JSON.stringify(r)).not.toContain("p4ssw0rd");
  });
});

describe("PostgreSQL (pg-mem)", () => {
  const mem = newDb();
  mem.public.none("create table users (id int primary key, name text, age int)");
  mem.public.none("insert into users values (1,'علی',30),(2,'سارا',25),(3,'رضا',41)");
  const { Client } = mem.adapters.createPg();
  const d = deps({
    connectPostgres: async () => {
      const c = new Client();
      await c.connect();
      return { query: async (sql, values) => { const r = await c.query(sql, values); return { rows: r.rows, affected: r.rowCount ?? 0 }; }, end: () => c.end() };
    },
  });
  const base = { host: "h", database: "d", user: "u", password: "pw-secret" };

  it("پرس‌وجو با مقدار پارامتری", async () => {
    const r = await run("postgres", { ...base, query: "select name from users where age > $1 order by id", values: ["{{ $input.min }}"] }, d, [{ min: 28 }]);
    expect(node(r).output.main).toEqual([{ name: "علی" }, { name: "رضا" }]);
  });
  it("درج و تعداد ردیف تغییرکرده", async () => {
    const r = await run("postgres", { ...base, query: "insert into users values ($1,$2,$3)", values: [9, "نو", 20] }, d);
    expect(node(r).output.main).toEqual([{ affectedRows: 1 }]);
  });
  it("تزریق SQL با عبارت جایگذاری‌شده رد می‌شود", async () => {
    const r = await run("postgres", { ...base, query: "select * from users where name = '{{ $input.n }}'" }, d, [{ n: "x' or '1'='1" }]);
    expect(r.status).toBe("error");
    expect(node(r).error).toContain("{{");
  });
  it("هر آیتم جداگانه اجرا می‌شود", async () => {
    const r = await run("postgres", { ...base, query: "select name from users where id = $1", values: ["{{ $input.id }}"] }, d, [{ id: 1 }, { id: 2 }]);
    expect(node(r).output.main).toEqual([{ name: "علی" }, { name: "سارا" }]);
  });
  it("خطای اتصال رمز را فاش نمی‌کند", async () => {
    const bad = deps({ connectPostgres: async () => { throw new Error("password authentication failed pw-secret"); } });
    const r = await run("postgres", { ...base, query: "select 1" }, bad);
    expect(r.status).toBe("error");
    expect(JSON.stringify(r)).not.toContain("pw-secret");
  });
  it("نتیجه‌ی خیلی بزرگ را رد می‌کند", async () => {
    const big: DbClient = { query: async () => ({ rows: Array.from({ length: 1001 }, (_, i) => ({ i })) }), end: async () => {} };
    const r = await run("mysql", { ...base, query: "select 1" }, deps({ connectMysql: async () => big }));
    expect(r.status).toBe("error");
  });
});

describe("گوگل شیت", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const sa = JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: privateKey });
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
  const calls: { url: string; init?: RequestInit }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "tok123", expires_in: 3600 }));
    if (init?.method === "GET") return new Response(JSON.stringify({ values: [["نام", "سن"], ["علی", "30"], ["سارا", "25"]] }));
    if (init?.method === "POST") return new Response(JSON.stringify({ updates: { updatedRows: 1 } }));
    return new Response(JSON.stringify({ updatedRange: "Sheet1!A1:B1", updatedCells: 2 }));
  }) as unknown as typeof fetch;
  const d = deps();
  const p = { serviceAccount: sa, spreadsheetId: id, range: "Sheet1!A1:B10" };

  it("خواندن با سرتیتر و احراز هویت JWT", async () => {
    const r = await run("sheetsRead", p, d, [{}], fake);
    expect(node(r).output.main).toEqual([{ نام: "علی", سن: "30" }, { نام: "سارا", سن: "25" }]);
    const tokenCall = calls.find((c) => c.url.includes("oauth2"))!;
    expect(String(tokenCall.init?.body)).toContain("jwt-bearer");
    expect((calls.at(-1)!.init?.headers as Record<string, string>).authorization).toBe("Bearer tok123");
  });
  it("افزودن و به‌روزرسانی", async () => {
    const a = await run("sheetsAppend", { ...p, values: [["x", "{{ $input.v }}"]] }, d, [{ v: 7 }], fake);
    expect(a.status).toBe("success");
    const bodyA = JSON.parse(String(calls.filter((c) => c.init?.method === "POST" && c.url.includes("append")).at(-1)!.init?.body));
    expect(bodyA.values).toEqual([["x", 7]]);
    const u = await run("sheetsUpdate", { ...p, values: "[[1,2]]" }, d, [{}], fake);
    expect(node(u).output.main[0]).toMatchObject({ sheets: { updatedCells: 2 } });
  });
  it("کلید و شناسه‌ی نامعتبر خطا می‌دهند و کلید خصوصی فاش نمی‌شود", async () => {
    expect((await run("sheetsRead", { ...p, serviceAccount: "نه-json" }, d, [{}], fake)).status).toBe("error");
    expect((await run("sheetsRead", { ...p, spreadsheetId: "../x" }, d, [{}], fake)).status).toBe("error");
    const r = await run("sheetsRead", { ...p, serviceAccount: JSON.stringify({ client_email: "z@z.com", private_key: "PRIVATE-KEY-DATA" }) }, d, [{}], fake);
    expect(r.status).toBe("error");
    expect(JSON.stringify(r)).not.toContain("PRIVATE-KEY-DATA");
  });
});

describe("هوش مصنوعی", () => {
  const reply = (content: string, status = 200) => (async (url: string, init?: RequestInit) => {
    reply.last = { url, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> };
    return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : { error: { message: "bad key sk-SECRET" } }), { status });
  }) as unknown as typeof fetch;
  reply.last = {} as { url?: string; body?: { messages: { role: string; content: string }[] }; headers?: Record<string, string> };
  const p = { apiKey: "sk-SECRET", model: "m1", baseUrl: "https://llm.example.com/v1/", text: "یک متن بلند" };

  it("خلاصه‌سازی و ارسال درخواست درست", async () => {
    const r = await run("llm", { ...p, mode: "summarize" }, deps(), [{}], reply("خلاصه"));
    expect(node(r).output.main[0].ai).toBe("خلاصه");
    expect(reply.last.url).toBe("https://llm.example.com/v1/chat/completions");
    expect(reply.last.headers?.authorization).toBe("Bearer sk-SECRET");
  });
  it("دسته‌بندی فقط دسته‌ی معتبر را می‌پذیرد", async () => {
    const good = await run("llm", { ...p, mode: "classify", categories: "شکایت, پرسش, تعریف" }, deps(), [{}], reply("پرسش"));
    expect(node(good).output.main[0]).toMatchObject({ ai: "پرسش", aiMatched: true });
    const odd = await run("llm", { ...p, mode: "classify", categories: "شکایت, پرسش" }, deps(), [{}], reply("چیز دیگر"));
    expect(node(odd).output.main[0]).toMatchObject({ ai: "نامشخص", aiMatched: false });
  });
  it("خطای سرویس کلید را فاش نمی‌کند", async () => {
    const r = await run("llm", { ...p, mode: "reply" }, deps(), [{}], reply("", 401));
    expect(r.status).toBe("error");
    expect(JSON.stringify(r)).not.toContain("sk-SECRET");
  });
});

describe("دکمه‌های ربات", () => {
  it("دکمه‌ی درون‌خطی با داده و نشانی", () => {
    expect(buildReplyMarkup([[{ text: "بله", data: "yes" }, { text: "سایت", url: "https://a.com" }]], "inline")).toEqual({
      inline_keyboard: [[{ text: "بله", callback_data: "yes" }, { text: "سایت", url: "https://a.com" }]],
    });
  });
  it("کیبورد پاسخ از رشته‌ی JSON", () => {
    expect(buildReplyMarkup('[["الف","ب"]]', "reply")).toMatchObject({ keyboard: [[{ text: "الف" }, { text: "ب" }]] });
  });
  it("ورودی نامعتبر", () => {
    expect(() => buildReplyMarkup([[{ text: "x", url: "javascript:alert(1)" }]], "inline")).toThrow();
    expect(() => buildReplyMarkup([[{ text: "x", data: "y".repeat(65) }]], "inline")).toThrow();
    expect(() => buildReplyMarkup("{خراب", "inline")).toThrow();
    expect(buildReplyMarkup("", "inline")).toBeUndefined();
  });
});
