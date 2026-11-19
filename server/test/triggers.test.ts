import { describe, expect, it } from "vitest";
import { cronMatches, parseCron } from "../src/engine/cron.js";
import { TriggerManager } from "../src/api/triggers.js";
import type { StoredWorkflow } from "../src/api/types.js";

const wf = (nodes: StoredWorkflow["nodes"], active = true): StoredWorkflow => ({
  id: "w1", name: "تست", nodes, connections: [], active, createdAt: 0, updatedAt: 0,
});

describe("کرون", () => {
  it("بخش‌های ساده، فهرست، بازه و گام", () => {
    const d = new Date("2026-11-18T05:30:00Z"); // تهران ۰۹:۰۰ (UTC+3:30)
    expect(cronMatches(parseCron("0 9 * * *"), d, "Asia/Tehran")).toBe(true);
    expect(cronMatches(parseCron("0 8 * * *"), d, "Asia/Tehran")).toBe(false);
    expect(cronMatches(parseCron("*/15 * * * *"), d, "Asia/Tehran")).toBe(true);
    expect(cronMatches(parseCron("0,30 9-10 * * *"), d, "Asia/Tehran")).toBe(true);
    expect(cronMatches(parseCron("0 9 * * 3"), d, "Asia/Tehran")).toBe(true); // چهارشنبه
    expect(cronMatches(parseCron("0 9 * * 1-2"), d, "Asia/Tehran")).toBe(false);
    expect(cronMatches(parseCron("0 9 * * 7"), new Date("2026-11-22T05:30:00Z"), "Asia/Tehran")).toBe(true); // ۷ = یکشنبه
  });
  it("منطقه‌ی زمانی اثر دارد", () => {
    const d = new Date("2026-11-18T05:30:00Z");
    expect(cronMatches(parseCron("30 5 * * *"), d, "UTC")).toBe(true);
    expect(cronMatches(parseCron("30 5 * * *"), d, "Asia/Tehran")).toBe(false);
  });
  it("ورودی نامعتبر را رد می‌کند", () => {
    for (const bad of ["", "* * * *", "61 * * * *", "* 24 * * *", "a * * * *", "*/0 * * * *", "5-2 * * * *", "* * 0 * *"]) {
      expect(() => parseCron(bad), bad).toThrow();
    }
  });
});

describe("مدیر تریگرها", () => {
  it("زمان‌بندی در هر دقیقه فقط یک بار اجرا می‌شود و گره شروع درست است", async () => {
    const calls: { mode: string; node: string; input: unknown }[] = [];
    let now = new Date("2026-11-18T05:30:10Z");
    const m = new TriggerManager({
      listWorkflows: () => [wf([{ id: "s", name: "زمان", type: "schedule", params: { cron: "0 9 * * *" } }])],
      run: async (_w, input, mode, node) => { calls.push({ mode, node, input }); },
      now: () => now,
    });
    await m.tick(); now = new Date("2026-11-18T05:30:40Z"); await m.tick();
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ mode: "schedule", node: "s" });
    now = new Date("2026-11-18T05:31:10Z"); await m.tick(); // دقیقه‌ی بعد مطابقت ندارد
    expect(calls.length).toBe(1);
    now = new Date("2026-11-19T05:30:10Z"); await m.tick(); // فردا
    expect(calls.length).toBe(2);
  });
  it("گردش‌کار غیرفعال و کرون خراب اجرا نمی‌شود و خطا ثبت می‌شود", async () => {
    const calls: unknown[] = []; const errs: string[] = [];
    const m = new TriggerManager({
      listWorkflows: () => [
        wf([{ id: "s", name: "z", type: "schedule", params: { cron: "* * * * *" } }], false),
        { ...wf([{ id: "s2", name: "z2", type: "schedule", params: { cron: "bad" } }]), id: "w2" },
      ],
      run: async () => { calls.push(1); }, onError: (e) => errs.push(e),
    });
    await m.tick();
    expect(calls.length).toBe(0);
    expect(errs.length).toBe(1);
  });
  it("ربات: پیام‌های قدیمی رد می‌شوند و پیام‌های تازه اجرا می‌کنند و توکن در خطا نمی‌آید", async () => {
    const token = "123456:ABC-def_ghi";
    const queue: { update_id: number; message: object }[] = [
      { update_id: 10, message: { message_id: 1, date: 1, text: "قدیمی", chat: { id: 5 } } },
    ];
    const urls: string[] = [];
    const fakeFetch = (async (u: string) => {
      urls.push(u);
      const offset = Number(new URL(u).searchParams.get("offset") ?? -1);
      const result = queue.filter((x) => x.update_id >= offset);
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    }) as unknown as typeof fetch;
    const runs: unknown[][] = [];
    const m = new TriggerManager({
      listWorkflows: () => [wf([{ id: "b", name: "بله", type: "baleTrigger", params: { token } }])],
      run: async (_w, input) => { runs.push(input); }, fetch: fakeFetch,
    });
    await m.tick();
    expect(runs.length).toBe(0); // صف قدیمی رد شد
    queue.push({ update_id: 11, message: { message_id: 2, date: 2, text: "سلام", chat: { id: 5, type: "private" }, from: { id: 9, first_name: "علی" } } } as never);
    await m.tick();
    expect(runs.length).toBe(1);
    expect(runs[0][0]).toMatchObject({ text: "سلام", chatId: 5, fromName: "علی", updateId: 11 });
    expect(urls[0]).toContain("tapi.bale.ai");
    await m.tick();
    expect(runs.length).toBe(1); // تکرار نمی‌شود
  });
  it("خطای شبکه‌ی ربات توکن را فاش نمی‌کند", async () => {
    const token = "123456:SECRET-tok";
    const errs: string[] = [];
    const m = new TriggerManager({
      listWorkflows: () => [wf([{ id: "b", name: "ت", type: "telegramTrigger", params: { token } }])],
      run: async () => {}, fetch: (async (u: string) => { throw new Error(`fail ${u}`); }) as unknown as typeof fetch,
      onError: (e) => errs.push(e),
    });
    await m.tick();
    expect(errs.length).toBe(1);
    expect(errs[0]).not.toContain("SECRET-tok");
  });
});
