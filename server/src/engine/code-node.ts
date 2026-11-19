import { spawn, spawnSync } from "node:child_process";
import type { Item, NodeHandler } from "./types.js";

/**
 * گره‌ی کد: کد جاوااسکریپت کاربر در یک فرایند جدا و محدود اجرا می‌شود.
 *  - مدل مجوز Node (--permission): بدون دسترسی به فایل، فرایند فرزند، ورکر و افزونه‌ی بومی
 *  - محدودیت زمان (کشتن فرایند)، حافظه، حجم ورودی و خروجی؛ متغیرهای محیطی خالی
 *  - کد در یک context جدا و بدون require/process/fetch اجرا می‌شود و فقط رشته‌ی JSON از مرز رد می‌شود
 *    (هیچ شیء میزبانی به کد داده نمی‌شود، پس زنجیره‌ی constructor به process نمی‌رسد)
 *  - شبکه: مدل مجوز Node شبکه را نمی‌بندد؛ اگر `unshare` لینوکس در دسترس باشد فرایند در فضای شبکه‌ی
 *    خالی اجرا می‌شود، وگرنه شبکه فقط با لایه‌ی نرم‌افزاری بسته است (بدون ضمانت) — برای میزبانی عمومی از کانتینر استفاده کنید.
 */

export const CODE_LIMITS = { timeoutMs: 5_000, maxInputBytes: 1_000_000, maxOutputBytes: 1_000_000, maxCodeChars: 20_000, memoryMb: 64 };

const RUNNER = String.raw`
const vm = require('node:vm');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => {
  let out;
  try {
    const { code, items, timeoutMs } = JSON.parse(buf);
    const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    const src = '"use strict";(function(){const items = JSON.parse(__IN__);' +
      'const r = (function(items){' + code + '\n})(items);' +
      'if (r && typeof r.then === "function") throw new Error("کد async/await پشتیبانی نمی‌شود");' +
      'return JSON.stringify(r === undefined ? null : r);})()';
    ctx.__IN__ = JSON.stringify(items);
    const res = vm.runInContext(src, ctx, { timeout: timeoutMs, displayErrors: false, microtaskMode: 'afterEvaluate' });
    out = { ok: true, result: res };
  } catch (e) {
    out = { ok: false, error: String((e && e.message) || e).slice(0, 500) };
  }
  process.stdout.write(JSON.stringify(out));
});
`;

let netIsolation: boolean | undefined;
function canIsolateNetwork(): boolean {
  if (netIsolation === undefined) {
    try { netIsolation = spawnSync("unshare", ["-rn", "true"], { timeout: 3000 }).status === 0; } catch { netIsolation = false; }
  }
  return netIsolation;
}

export function nodeSupportsPermission(): boolean {
  return Number(process.versions.node.split(".")[0]) >= 22;
}

export async function runSandboxed(code: string, items: Item[], limits = CODE_LIMITS): Promise<unknown> {
  if (!nodeSupportsPermission()) throw new Error("گره‌ی کد به Node نسخه‌ی ۲۲ یا بالاتر نیاز دارد");
  if (code.length > limits.maxCodeChars) throw new Error(`کد بیش از ${limits.maxCodeChars} نویسه است`);
  const input = JSON.stringify({ code, items, timeoutMs: limits.timeoutMs - 500 });
  if (Buffer.byteLength(input) > limits.maxInputBytes) throw new Error("ورودی گره‌ی کد بیش از حد بزرگ است");

  const nodeArgs = ["--permission", `--max-old-space-size=${limits.memoryMb}`, "--disallow-code-generation-from-strings", "-e", RUNNER];
  const [cmd, args] = canIsolateNetwork() ? ["unshare", ["-rn", process.execPath, ...nodeArgs]] as const : [process.execPath, nodeArgs] as const;
  const child = spawn(cmd, args as string[], { env: {}, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  return await new Promise((resolve, reject) => {
    let out = "", over = false, done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(() => reject(new Error(`اجرای کد از ${limits.timeoutMs / 1000} ثانیه بیشتر شد`))); }, limits.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      if (out.length > limits.maxOutputBytes) { over = true; child.kill("SIGKILL"); }
    });
    child.stderr.on("data", () => {}); // خروجی خطای فرایند نمایش داده نمی‌شود
    child.on("error", () => finish(() => reject(new Error("اجرای فرایند کد ممکن نشد"))));
    child.on("close", (codeNum, signal) => finish(() => {
      if (over) return reject(new Error("خروجی کد بیش از حد بزرگ است"));
      if (signal === "SIGKILL" || signal === "SIGABRT" || (codeNum !== 0 && !out)) return reject(new Error("اجرای کد متوقف شد (حافظه یا زمان بیش از حد)"));
      try {
        const r = JSON.parse(out) as { ok: boolean; result?: string; error?: string };
        if (!r.ok) return reject(new Error(`خطا در کد: ${r.error}`));
        resolve(JSON.parse(r.result ?? "null"));
      } catch { reject(new Error("خروجی کد نامعتبر است")); }
    }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function normalize(result: unknown): Item[] {
  const list = Array.isArray(result) ? result : [result];
  if (list.length > 1000) throw new Error("کد حداکثر ۱۰۰۰ آیتم می‌تواند برگرداند");
  return list.map((x) => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Item) : { value: x }));
}

/** همه‌ی آیتم‌ها یک‌جا به کد داده می‌شود: متغیر items؛ خروجی: یک شیء یا فهرستی از شیءها */
export const code: NodeHandler = async (ctx, items) => {
  const src = ctx.params.code;
  if (typeof src !== "string" || src.trim() === "") throw new Error("کد الزامی است");
  return { main: normalize(await runSandboxed(src, items)) };
};
