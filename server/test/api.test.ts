import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, SECRET_PLACEHOLDER } from "../src/api/app.js";

let dir: string;
let base: string;
let close: () => Promise<void>;

async function start(fetchImpl?: typeof fetch) {
  dir = await mkdtemp(path.join(os.tmpdir(), "jaryan-"));
  const { server } = await createApp({ dataDir: dir, fetch: fetchImpl, maxBodyBytes: 2000 });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((r) => server.close(() => r()));
}
beforeEach(() => start());
afterEach(async () => { await close(); await rm(dir, { recursive: true, force: true }); });

const J = { "content-type": "application/json" };
const sample = (extra: Record<string, unknown> = {}) => ({
  name: "نمونه",
  nodes: [
    { id: "t", name: "شروع", type: "trigger", params: {} },
    { id: "s", name: "پیام", type: "set", params: { fields: { متن: "سلام {{ $input.body.نام }}" } } },
  ],
  connections: [{ from: "t", to: "s" }],
  ...extra,
});
const post = (p: string, body: unknown, headers: Record<string, string> = J) =>
  fetch(base + p, { method: "POST", headers, body: JSON.stringify(body) });

describe("گردش‌کارها", () => {
  it("ساخت، خواندن، ویرایش، فهرست و حذف", async () => {
    const r = await post("/api/workflows", sample());
    expect(r.status).toBe(201);
    const w = await r.json();
    expect(w.id).toBeTruthy();
    expect((await (await fetch(`${base}/api/workflows`)).json())[0]).toMatchObject({ name: "نمونه", nodeCount: 2 });
    const put = await fetch(`${base}/api/workflows/${w.id}`, { method: "PUT", headers: J, body: JSON.stringify(sample({ name: "جدید" })) });
    expect((await put.json()).name).toBe("جدید");
    expect((await fetch(`${base}/api/workflows/${w.id}`, { method: "DELETE", headers: J })).status).toBe(200);
    expect((await fetch(`${base}/api/workflows/${w.id}`)).status).toBe(404);
  });

  it("ورودی نامعتبر را با پیام فارسی رد می‌کند", async () => {
    const bad = [
      sample({ name: "" }),
      sample({ nodes: [{ id: "a", name: "x", type: "نامعلوم", params: {} }] }),
      sample({ connections: [{ from: "t", to: "zzz" }] }),
      sample({ nodes: [{ id: "../x", name: "x", type: "set", params: {} }] }),
    ];
    for (const b of bad) {
      const r = await post("/api/workflows", b);
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBeTruthy();
    }
  });

  it("مقدار محرمانه در پاسخ پنهان می‌شود و با ذخیره‌ی دوباره حفظ می‌شود", async () => {
    const wf = sample({
      nodes: [
        { id: "t", name: "شروع", type: "trigger", params: {} },
        { id: "b", name: "بله", type: "bale", params: { token: "123:SECRETTOKEN", chatId: "1", text: "x" } },
      ],
      connections: [{ from: "t", to: "b" }],
    });
    const w = await (await post("/api/workflows", wf)).json();
    expect(JSON.stringify(w)).not.toContain("SECRETTOKEN");
    expect(w.nodes[1].params.token).toBe(SECRET_PLACEHOLDER);
    await fetch(`${base}/api/workflows/${w.id}`, { method: "PUT", headers: J, body: JSON.stringify(w) });
    const raw = await import("node:fs/promises").then((f) => f.readFile(path.join(dir, "data.json"), "utf8"));
    expect(raw).toContain("123:SECRETTOKEN"); // مقدار واقعی حفظ شده است
  });
});

describe("اجرا", () => {
  it("اجرای دستی با ورودی و ثبت تاریخچه", async () => {
    const w = await (await post("/api/workflows", sample())).json();
    const r = await (await post(`/api/workflows/${w.id}/run`, { input: [{ body: { نام: "علی" } }] })).json();
    expect(r.status).toBe("success");
    expect(r.runs[1].output.main[0].متن).toBe("سلام علی");
    const list = await (await fetch(`${base}/api/workflows/${w.id}/executions`)).json();
    expect(list).toHaveLength(1);
    const one = await (await fetch(`${base}/api/executions/${list[0].id}`)).json();
    expect(one.runs).toHaveLength(2);
  });

  it("ورودی نامعتبر اجرا را رد می‌کند", async () => {
    const w = await (await post("/api/workflows", sample())).json();
    expect((await post(`/api/workflows/${w.id}/run`, { input: "x" })).status).toBe(400);
  });

  it("وب‌هوک: غیرفعال ۴۰۹، فعال اجرا می‌کند", async () => {
    const w = await (await post("/api/workflows", sample())).json();
    expect((await post(`/webhook/${w.id}`, { نام: "رضا" })).status).toBe(409);
    await fetch(`${base}/api/workflows/${w.id}`, { method: "PUT", headers: J, body: JSON.stringify({ ...sample(), active: true }) });
    const r = await post(`/webhook/${w.id}`, { نام: "رضا" });
    expect(r.status).toBe(200);
    const { executionId } = await r.json();
    const e = await (await fetch(`${base}/api/executions/${executionId}`)).json();
    expect(e.mode).toBe("webhook");
    expect(e.runs[1].output.main[0].متن).toBe("سلام رضا");
    expect((await post(`/webhook/nope`, {})).status).toBe(404);
  });

  it("خطای گره، وضعیت ۵۰۰ و خطا در تاریخچه", async () => {
    const wf = sample({
      nodes: [
        { id: "t", name: "شروع", type: "trigger", params: {} },
        { id: "h", name: "درخواست", type: "http", params: { url: "ftp://x" } },
      ],
      connections: [{ from: "t", to: "h" }],
    });
    const w = await (await post("/api/workflows", wf)).json();
    const r = await (await post(`/api/workflows/${w.id}/run`, {})).json();
    expect(r.status).toBe("error");
    expect(r.error).toContain("درخواست");
  });
});

describe("امنیت", () => {
  it("برای تغییر، نوع محتوای JSON لازم است", async () => {
    const r = await fetch(`${base}/api/workflows`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(sample()) });
    expect(r.status).toBe(415);
  });
  it("میزبان نامجاز رد می‌شود", async () => {
    const r = await new Promise<number>((resolve) => {
      import("node:http").then(({ request }) => {
        const u = new URL(base);
        const q = request({ host: u.hostname, port: u.port, path: "/api/workflows", headers: { host: "evil.example.com" } }, (res) => resolve(res.statusCode ?? 0));
        q.end();
      });
    });
    expect(r).toBe(403);
  });
  it("بدنه‌ی بزرگ‌تر از سقف رد می‌شود", async () => {
    const r = await post("/api/workflows", sample({ name: "ا".repeat(3000) }));
    expect(r.status).toBe(413);
  });
  it("مسیر خارج از پوشه‌ی public خوانده نمی‌شود", async () => {
    const r = await fetch(`${base}/..%2f..%2fetc/passwd`);
    expect([403, 404]).toContain(r.status);
  });
});
