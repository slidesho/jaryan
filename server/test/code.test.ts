import { describe, expect, it } from "vitest";
import { executeWorkflow } from "../src/engine/executor.js";
import { runSandboxed } from "../src/engine/code-node.js";

const run = (code: string, items: Record<string, unknown>[] = [{ a: 1 }, { a: 2 }]) =>
  executeWorkflow(
    { id: "w", name: "t", nodes: [{ id: "t", name: "شروع", type: "trigger", params: {} }, { id: "c", name: "کد", type: "code", params: { code } }], connections: [{ from: "t", to: "c" }] },
    items,
  );

describe("گره‌ی کد", () => {
  it("آیتم‌ها را پردازش می‌کند", async () => {
    const r = await run("return items.map(i => ({ ...i, twice: i.a * 2 }));");
    expect(r.status).toBe("success");
    expect(r.runs[1].output.main).toEqual([{ a: 1, twice: 2 }, { a: 2, twice: 4 }]);
  });
  it("مقدار ساده یا شیء تکی را به آیتم تبدیل می‌کند و {{ }} در کد دست‌نخورده می‌ماند", async () => {
    const r = await run("const o = {x:{y:1}}; return { sum: items.length, o };");
    expect(r.runs[1].output.main).toEqual([{ sum: 2, o: { x: { y: 1 } } }]);
    const r2 = await run("return 5;");
    expect(r2.runs[1].output.main).toEqual([{ value: 5 }]);
  });
  it("خطای کد پیام فارسی می‌دهد", async () => {
    const r = await run("throw new Error('خراب شد');");
    expect(r.status).toBe("error");
    expect(r.runs[1].error).toContain("خراب شد");
    expect((await run("return (;")).status).toBe("error");
  });
  it("حلقه‌ی بی‌پایان متوقف می‌شود", async () => {
    const t = Date.now();
    const r = await run("while(true){}");
    expect(r.status).toBe("error");
    expect(Date.now() - t).toBeLessThan(7000);
  }, 10_000);
  it("مصرف بی‌رویه‌ی حافظه متوقف می‌شود", async () => {
    const r = await run("const a=[]; while(true){ a.push(new Array(1e6).fill(1)); }");
    expect(r.status).toBe("error");
  }, 15_000);
  it("خروجی خیلی بزرگ رد می‌شود", async () => {
    const r = await run("return [{ s: 'x'.repeat(1.5e6) }];");
    expect(r.status).toBe("error");
  }, 15_000);
  it("async/await و دسترسی به فایل و فرایند از طریق require/import ممکن نیست", async () => {
    for (const c of [
      "return require('fs').readFileSync('/etc/passwd','utf8');",
      "return process.env;",
      "return typeof process + typeof require + typeof fetch + typeof globalThis.process;",
    ]) {
      const r = await run(c);
      if (r.status === "success") {
        const v = JSON.stringify(r.runs[1].output.main);
        expect(v, c).not.toContain("root:");
        expect(v, c).toMatch(/undefined/);
      } else expect(r.status).toBe("error");
    }
    expect((await run("return (async()=>1)();")).status).toBe("error");
    expect((await run("return import('node:fs');")).status).toBe("error");
  }, 15_000);
  it("فرار با زنجیره‌ی constructor به process نمی‌رسد", async () => {
    const attempts = [
      "return this.constructor.constructor('return process')().env;",
      "return (function(){}).constructor('return process')().mainModule.require('fs').readFileSync('/etc/passwd','utf8');",
      "return items.constructor.constructor('return process')().pid;",
      "return ({}).constructor.constructor('return globalThis')().process.pid;",
      "const f = Object.getPrototypeOf(async function(){}).constructor; return f('return process')();",
      "return [].concat.constructor('return process')().pid;",
      "const e = new Error(); e.constructor.constructor('return process')(); return 1;",
    ];
    for (const c of attempts) {
      const r = await run(c);
      const out = JSON.stringify(r.runs[1].output.main ?? []);
      expect(out, c).not.toMatch(/root:|"pid"|\d{3,}/);
      expect(r.status, c).toBe("error"); // codeGeneration از رشته بسته است
    }
  }, 30_000);
  it("خواندن فایل حتی با دور زدن فرضی بسته است (مدل مجوز)", async () => {
    // فرایند فرزند خودش بدون هیچ حفاظ vm هم نباید فایل بخواند
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, ["--permission", "-e", "try{require('fs').readFileSync('/etc/passwd');console.log('READ')}catch(e){console.log(e.code)}"], { encoding: "utf8" });
    expect(r.stdout.trim()).toBe("ERR_ACCESS_DENIED");
    const s = spawnSync(process.execPath, ["--permission", "-e", "try{require('child_process').execSync('id');console.log('SPAWN')}catch(e){console.log(e.code)}"], { encoding: "utf8" });
    expect(s.stdout.trim()).toBe("ERR_ACCESS_DENIED");
  });
  it("ورودی خیلی بزرگ و کد خیلی طولانی رد می‌شود", async () => {
    await expect(runSandboxed("return 1", [{ s: "x".repeat(1_100_000) }])).rejects.toThrow();
    await expect(runSandboxed("//" + "x".repeat(21_000), [{}])).rejects.toThrow();
  });
});
