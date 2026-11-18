import { describe, expect, it } from "vitest";
import { executeWorkflow, validateWorkflow } from "../src/engine/executor.js";
import { evaluatePath, resolveString } from "../src/engine/expression.js";
import type { Workflow } from "../src/engine/types.js";

const noSleep = async () => {};

function wf(partial: Partial<Workflow>): Workflow {
  return { id: "w", name: "تست", nodes: [], connections: [], ...partial };
}

describe("عبارت‌ها", () => {
  const scope = { input: { نام: "علی", سن: 30, ت: { ب: 1 } }, nodeOutputs: { "گره یک": [{ x: 5 }] } };

  it("مقدار ورودی را می‌خواند", () => {
    expect(evaluatePath("$input.نام", scope)).toBe("علی");
    expect(evaluatePath("$input.ت.ب", scope)).toBe(1);
  });
  it("به خروجی گره قبلی با نام فارسی دسترسی دارد", () => {
    expect(evaluatePath('$node["گره یک"].x', scope)).toBe(5);
  });
  it("مقدار کامل نوع اصلی را نگه می‌دارد و متن مخلوط رشته می‌شود", () => {
    expect(resolveString("{{ $input.سن }}", scope)).toBe(30);
    expect(resolveString("سلام {{ $input.نام }}!", scope)).toBe("سلام علی!");
  });
  it("مسیرهای خطرناک را رد می‌کند و کد اجرا نمی‌کند", () => {
    expect(evaluatePath("$input.__proto__", scope)).toBeUndefined();
    expect(evaluatePath("$input.constructor.constructor", scope)).toBeUndefined();
    expect(resolveString("{{ process.exit() }}", scope)).toBeUndefined();
    expect(resolveString("a {{ process.exit() }} b", scope)).toBe("a  b");
  });
});

describe("اعتبارسنجی گردش‌کار", () => {
  it("چرخه را می‌گیرد", () => {
    const w = wf({
      nodes: [
        { id: "a", name: "a", type: "set", params: {} },
        { id: "b", name: "b", type: "set", params: {} },
      ],
      connections: [{ from: "a", to: "b" }, { from: "b", to: "a" }],
    });
    expect(() => validateWorkflow(w)).toThrow("چرخه");
  });
  it("نام تکراری را می‌گیرد", () => {
    const w = wf({
      nodes: [
        { id: "a", name: "x", type: "set", params: {} },
        { id: "b", name: "x", type: "set", params: {} },
      ],
    });
    expect(() => validateWorkflow(w)).toThrow("تکراری");
  });
});

describe("اجرا", () => {
  it("محرک ← تبدیل داده با عبارت", async () => {
    const w = wf({
      nodes: [
        { id: "t", name: "شروع", type: "trigger", params: {} },
        { id: "s", name: "پیام", type: "set", params: { fields: { متن: "سلام {{ $input.نام }}" } } },
      ],
      connections: [{ from: "t", to: "s" }],
    });
    const r = await executeWorkflow(w, [{ نام: "سارا" }], { sleep: noSleep });
    expect(r.status).toBe("success");
    expect(r.runs[1].output.main[0]).toEqual({ نام: "سارا", متن: "سلام سارا" });
  });

  it("شرط فقط شاخه‌ی درست را اجرا می‌کند", async () => {
    const w = wf({
      nodes: [
        { id: "t", name: "شروع", type: "trigger", params: {} },
        { id: "c", name: "شرط", type: "condition", params: { left: "{{ $input.مبلغ }}", op: "gt", right: 100 } },
        { id: "y", name: "گران", type: "set", params: { fields: { برچسب: "گران" } } },
        { id: "n", name: "ارزان", type: "set", params: { fields: { برچسب: "ارزان" } } },
      ],
      connections: [
        { from: "t", to: "c" },
        { from: "c", output: "true", to: "y" },
        { from: "c", output: "false", to: "n" },
      ],
    });
    const r = await executeWorkflow(w, [{ مبلغ: 250 }], { sleep: noSleep });
    expect(r.runs.map((x) => x.nodeName)).toEqual(["شروع", "شرط", "گران"]);
    expect(r.runs[2].output.main[0].برچسب).toBe("گران");
  });

  it("درخواست HTTP با fetch تزریق‌شده کار می‌کند و پاسخ ناموفق خطا می‌دهد", async () => {
    const ok = (async () => new Response(JSON.stringify({ a: 1 }), { status: 200 })) as typeof fetch;
    const bad = (async () => new Response("no", { status: 500 })) as typeof fetch;
    const w = wf({
      nodes: [
        { id: "t", name: "شروع", type: "trigger", params: {} },
        { id: "h", name: "درخواست", type: "http", params: { url: "https://example.com/x" } },
      ],
      connections: [{ from: "t", to: "h" }],
    });
    const r1 = await executeWorkflow(w, [{}], { fetch: ok, sleep: noSleep });
    expect(r1.status).toBe("success");
    expect(r1.runs[1].output.main[0].data).toEqual({ a: 1 });
    const r2 = await executeWorkflow(w, [{}], { fetch: bad, sleep: noSleep });
    expect(r2.status).toBe("error");
    expect(r2.error).toContain("500");
  });

  it("نشانی غیر http را رد می‌کند", async () => {
    const w = wf({
      nodes: [
        { id: "t", name: "شروع", type: "trigger", params: {} },
        { id: "h", name: "درخواست", type: "http", params: { url: "file:///etc/passwd" } },
      ],
      connections: [{ from: "t", to: "h" }],
    });
    const r = await executeWorkflow(w, [{}], { sleep: noSleep });
    expect(r.status).toBe("error");
  });

  it("نوع گره ناشناخته خطای فارسی می‌دهد", async () => {
    const w = wf({
      nodes: [
        { id: "t", name: "شروع", type: "trigger", params: {} },
        { id: "x", name: "ایکس", type: "نامعلوم", params: {} },
      ],
      connections: [{ from: "t", to: "x" }],
    });
    const r = await executeWorkflow(w, [{}], { sleep: noSleep });
    expect(r.error).toContain("ناشناخته");
  });

  it("سقف تعداد اجرای گره را رعایت می‌کند", async () => {
    const w = wf({
      nodes: [
        { id: "t", name: "شروع", type: "trigger", params: {} },
        { id: "s", name: "گام", type: "set", params: {} },
      ],
      connections: [{ from: "t", to: "s" }],
    });
    const r = await executeWorkflow(w, [{}], { sleep: noSleep, maxNodeRuns: 1 });
    expect(r.status).toBe("error");
  });
});
