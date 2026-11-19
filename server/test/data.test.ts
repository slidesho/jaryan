import { describe, expect, it } from "vitest";
import { executeWorkflow } from "../src/engine/executor.js";
import { toGregorian, toJalali, isJalaliLeap } from "../src/engine/jalali.js";
import { parseCsv } from "../src/engine/data-nodes.js";
import type { Workflow, WorkflowNode, Connection } from "../src/engine/types.js";

const noSleep = async () => {};
const T: WorkflowNode = { id: "t", name: "شروع", type: "trigger", params: {} };
function chain(node: Partial<WorkflowNode> & { type: string }, extra: WorkflowNode[] = [], conns: Connection[] = []): Workflow {
  return {
    id: "w", name: "تست",
    nodes: [T, { id: "n", name: "گره", params: {}, ...node } as WorkflowNode, ...extra],
    connections: [{ from: "t", to: "n" }, ...conns],
  };
}
const run = (w: Workflow, input: Record<string, unknown>[], opts = {}) => executeWorkflow(w, input, { sleep: noSleep, ...opts });
const out = (r: Awaited<ReturnType<typeof run>>, name = "گره") => r.runs.find((x) => x.nodeName === name)!;

describe("تقویم شمسی", () => {
  it("تاریخ‌های شناخته‌شده درست تبدیل می‌شوند", () => {
    expect(toJalali(2026, 11, 18)).toEqual({ jy: 1405, jm: 8, jd: 27 });
    expect(toJalali(2026, 3, 21)).toEqual({ jy: 1405, jm: 1, jd: 1 });
    expect(toJalali(2025, 3, 20)).toEqual({ jy: 1403, jm: 12, jd: 30 });
    expect(toJalali(1979, 2, 11)).toEqual({ jy: 1357, jm: 11, jd: 22 });
    expect(toGregorian(1405, 8, 27)).toEqual({ gy: 2026, gm: 11, gd: 18 });
  });
  it("رفت‌وبرگشت برای ۲۰ سال روز به روز سازگار است", () => {
    const start = Date.UTC(2015, 0, 1);
    for (let i = 0; i < 365 * 20; i++) {
      const d = new Date(start + i * 86400000);
      const g = { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() };
      const j = toJalali(g.gy, g.gm, g.gd);
      expect(toGregorian(j.jy, j.jm, j.jd)).toEqual(g);
    }
  });
  it("سال کبیسه", () => {
    expect(isJalaliLeap(1403)).toBe(true);
    expect(isJalaliLeap(1404)).toBe(false);
  });
});

describe("گره تاریخ", () => {
  it("میلادی به شمسی و نام ماه و روز هفته", async () => {
    const r = await run(chain({ type: "date", params: { op: "toJalali", value: "2026-11-18" } }), [{}]);
    const d = out(r).output.main[0].date as Record<string, unknown>;
    expect(d.jalali).toBe("1405/08/27");
    expect(d.monthName).toBe("آبان");
    expect(d.weekday).toBe("چهارشنبه");
  });
  it("شمسی (با رقم فارسی) به میلادی", async () => {
    const r = await run(chain({ type: "date", params: { op: "fromJalali", value: "۱۴۰۵/۰۸/۲۷" } }), [{}]);
    expect((out(r).output.main[0].date as Record<string, unknown>).gregorian).toBe("2026-11-18");
  });
  it("روز ۳۰ اسفند در سال غیرکبیسه خطا می‌دهد", async () => {
    const r = await run(chain({ type: "date", params: { op: "fromJalali", value: "1404/12/30" } }), [{}]);
    expect(r.status).toBe("error");
  });
  it("افزودن روز و ورودی نامعتبر", async () => {
    const r = await run(chain({ type: "date", params: { op: "addDays", value: "2026-12-30", days: 3 } }), [{}]);
    expect((out(r).output.main[0].date as Record<string, unknown>).gregorian).toBe("2027-01-02");
    const bad = await run(chain({ type: "date", params: { op: "toJalali", value: "2026-02-31" } }), [{}]);
    expect(bad.status).toBe("error");
  });
});

describe("منطق و داده", () => {
  it("فیلتر روی چند آیتم جدا حکم می‌دهد", async () => {
    const r = await run(chain({ type: "filter", params: { left: "{{ $input.v }}", op: "gt", right: 5 } }), [{ v: 3 }, { v: 9 }, { v: 7 }]);
    expect(out(r).output.main.map((x) => x.v)).toEqual([9, 7]);
  });
  it("شرط روی چند آیتم هر کدام را جدا می‌سنجد", async () => {
    const w = chain({ type: "condition", params: { left: "{{ $input.v }}", op: "gt", right: 5 } });
    const r = await run(w, [{ v: 3 }, { v: 9 }]);
    expect(out(r).output.true.map((x) => x.v)).toEqual([9]);
    expect(out(r).output.false.map((x) => x.v)).toEqual([3]);
  });
  it("سوییچ چندشاخه با شاخه‌ی دیگر", async () => {
    const w = chain({ type: "switch", params: { value: "{{ $input.k }}", cases: [{ value: "a" }, { value: "b" }] } });
    const r = await run(w, [{ k: "a" }, { k: "b" }, { k: "z" }, { k: "a" }]);
    const o = out(r).output;
    expect(o.c0.length).toBe(2);
    expect(o.c1.length).toBe(1);
    expect(o.other.length).toBe(1);
  });
  it("مرتب‌سازی عددی نزولی و پایدار", async () => {
    const r = await run(chain({ type: "sort", params: { field: "n", order: "desc", numeric: true } }), [{ n: 2 }, { n: 10 }, { n: 5 }]);
    expect(out(r).output.main.map((x) => x.n)).toEqual([10, 5, 2]);
  });
  it("شکستن فهرست و جمع‌کردن دوباره", async () => {
    const r = await run(chain({ type: "splitOut", params: { field: "list" } }, [{ id: "g", name: "جمع", type: "aggregate", params: { field: "x" } }], [{ from: "n", to: "g" }]), [{ list: [{ x: 1 }, { x: 2 }, { x: 3 }] }]);
    expect(out(r).output.main.length).toBe(3);
    expect(out(r, "جمع").output.main[0]).toEqual({ items: [1, 2, 3], count: 3 });
  });
  it("splitOut روی غیرفهرست خطا می‌دهد", async () => {
    const r = await run(chain({ type: "splitOut", params: { field: "list" } }), [{ list: 5 }]);
    expect(r.status).toBe("error");
  });
  it("ادغام یکتا", async () => {
    const r = await run(chain({ type: "merge", params: { mode: "unique", field: "id" } }), [{ id: 1 }, { id: 2 }, { id: 1 }]);
    expect(out(r).output.main.length).toBe(2);
  });
});

describe("CSV", () => {
  it("گیومه، ویرگول، خط جدید و BOM", () => {
    expect(parseCsv('﻿a,b\n"x,1","y ""q"""\r\n"l1\nl2",3\n')).toEqual([["a", "b"], ["x,1", 'y "q"'], ["l1\nl2", "3"]]);
  });
  it("گره خواندن CSV و نوشتن آن با محافظ فرمول", async () => {
    const r = await run(chain({ type: "csvParse", params: { text: "نام,سن\nعلی,30\nسارا,25" } }, [{ id: "s", name: "خروجی", type: "csvStringify", params: { bom: false } }], [{ from: "n", to: "s" }]), [{}]);
    expect(out(r).output.main).toEqual([{ نام: "علی", سن: "30" }, { نام: "سارا", سن: "25" }]);
    expect(out(r, "خروجی").output.main[0].csv).toBe("نام,سن\r\nعلی,30\r\nسارا,25");
    const f = await run(chain({ type: "csvStringify", params: { bom: false } }), [{ a: "=SUM(A1)" }]);
    expect(out(f).output.main[0].csv).toContain("'=SUM(A1)");
  });
  it("گیومه‌ی بسته‌نشده خطا می‌دهد", async () => {
    const r = await run(chain({ type: "csvParse", params: { text: 'a,b\n"x,1' } }), [{}]);
    expect(r.status).toBe("error");
  });
});

describe("تلاش دوباره و ادامه با خطا", () => {
  it("دوبار شکست و بار سوم موفق", async () => {
    let n = 0;
    const handlers = { flaky: async (_c: unknown, items: unknown[]) => { if (++n < 3) throw new Error("قطع"); return { main: items as never }; } };
    const w = chain({ type: "flaky", retry: { times: 3, delayMs: 10 } });
    const r = await run(w, [{ a: 1 }], { handlers });
    expect(r.status).toBe("success");
    expect(n).toBe(3);
  });
  it("با اتمام تلاش‌ها خطا می‌دهد", async () => {
    let n = 0;
    const handlers = { bad: async () => { n++; throw new Error("همیشه خراب"); } };
    const r = await run(chain({ type: "bad", retry: { times: 2, delayMs: 1 } }), [{}], { handlers });
    expect(r.status).toBe("error");
    expect(n).toBe(3);
  });
  it("continueOnFail خطا را در آیتم می‌گذارد و ادامه می‌دهد", async () => {
    const handlers = { bad: async () => { throw new Error("خراب"); } };
    const r = await run(chain({ type: "bad", continueOnFail: true }), [{ a: 1 }], { handlers });
    expect(r.status).toBe("success");
    expect(out(r).output.main[0]).toMatchObject({ a: 1, error: expect.stringContaining("خراب") });
  });
});
