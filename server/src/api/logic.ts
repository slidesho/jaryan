import { validateWorkflow } from "../engine/executor.js";
import type { Workflow } from "../engine/types.js";
import { NODE_TYPES, SECRET_KEYS } from "./catalog.js";
import type { StoredWorkflow } from "./types.js";

// منطق مشترک API: هم در سرور Node و هم در نسخه‌ی درون‌مرورگری استفاده می‌شود (بدون ماژول‌های Node)

export const MAX_NODES = 100;
export const MAX_CONNECTIONS = 300;
export const SECRET_PLACEHOLDER = "__SECRET__";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function maskSecrets(w: StoredWorkflow): StoredWorkflow {
  return {
    ...w,
    nodes: w.nodes.map((n) => {
      const keys = SECRET_KEYS[n.type];
      if (!keys || keys.size === 0) return n;
      const params = { ...n.params };
      for (const k of keys) if (typeof params[k] === "string" && params[k] !== "") params[k] = SECRET_PLACEHOLDER;
      return { ...n, params };
    }),
  };
}

/** اگر مقدار محرمانه همان جانگهدار بود، مقدار ذخیره‌شده‌ی قبلی حفظ می‌شود */
export function mergeSecrets(next: Workflow, prev?: StoredWorkflow): Workflow {
  return {
    ...next,
    nodes: next.nodes.map((n) => {
      const keys = SECRET_KEYS[n.type];
      if (!keys || keys.size === 0) return n;
      const old = prev?.nodes.find((o) => o.id === n.id)?.params ?? {};
      const params = { ...n.params };
      for (const k of keys) if (params[k] === SECRET_PLACEHOLDER) params[k] = old[k] ?? "";
      return { ...n, params };
    }),
  };
}

export function parseWorkflow(body: unknown): Workflow {
  if (!body || typeof body !== "object") throw new HttpError(400, "بدنه‌ی درخواست نامعتبر است");
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 120) throw new HttpError(400, "نام گردش‌کار باید بین ۱ تا ۱۲۰ نویسه باشد");
  if (!Array.isArray(b.nodes) || !Array.isArray(b.connections)) throw new HttpError(400, "گره‌ها و اتصال‌ها الزامی است");
  if (b.nodes.length > MAX_NODES) throw new HttpError(400, `حداکثر ${MAX_NODES} گره مجاز است`);
  if (b.connections.length > MAX_CONNECTIONS) throw new HttpError(400, `حداکثر ${MAX_CONNECTIONS} اتصال مجاز است`);
  const known = new Set(NODE_TYPES.map((t) => t.type));
  const nodes = b.nodes.map((raw) => {
    const n = raw as Record<string, unknown>;
    if (typeof n.id !== "string" || !/^[\w-]{1,64}$/.test(n.id)) throw new HttpError(400, "شناسه‌ی گره نامعتبر است");
    if (typeof n.name !== "string" || !n.name.trim() || n.name.length > 100) throw new HttpError(400, "نام گره نامعتبر است");
    if (typeof n.type !== "string" || !known.has(n.type)) throw new HttpError(400, `نوع گره ناشناخته است: ${String(n.type)}`);
    const params = n.params && typeof n.params === "object" && !Array.isArray(n.params) ? (n.params as Record<string, unknown>) : {};
    const node: Workflow["nodes"][number] = { id: n.id, name: n.name.trim(), type: n.type, params };
    const r = n.retry as { times?: unknown; delayMs?: unknown } | undefined;
    if (r && typeof r === "object") {
      const times = Number(r.times), delayMs = Number(r.delayMs ?? 0);
      if (!Number.isInteger(times) || times < 0 || times > 5) throw new HttpError(400, "تعداد تلاش دوباره باید بین ۰ تا ۵ باشد");
      if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 10_000) throw new HttpError(400, "فاصله‌ی تلاش دوباره باید بین ۰ تا ۱۰۰۰۰ میلی‌ثانیه باشد");
      if (times > 0) node.retry = { times, delayMs };
    }
    if (n.continueOnFail === true) node.continueOnFail = true;
    return node;
  });
  const connections = b.connections.map((raw) => {
    const c = raw as Record<string, unknown>;
    if (typeof c.from !== "string" || typeof c.to !== "string") throw new HttpError(400, "اتصال نامعتبر است");
    const out = typeof c.output === "string" ? c.output : undefined;
    if (out !== undefined && !/^[\w-]{1,32}$/.test(out)) throw new HttpError(400, "خروجی اتصال نامعتبر است");
    return { from: c.from, to: c.to, ...(out ? { output: out } : {}) };
  });
  const wf: Workflow = { id: "", name, nodes, connections };
  try { validateWorkflow(wf); } catch (e) { throw new HttpError(400, (e as Error).message); }
  return wf;
}

export function sanitizePositions(p: unknown): Record<string, { x: number; y: number }> | undefined {
  if (!p || typeof p !== "object") return undefined;
  const out: Record<string, { x: number; y: number }> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    const o = v as { x?: unknown; y?: unknown };
    if (/^[\w-]{1,64}$/.test(k) && typeof o?.x === "number" && typeof o?.y === "number" && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      out[k] = { x: o.x, y: o.y };
    }
  }
  return out;
}
