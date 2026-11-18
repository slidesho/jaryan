// API درون‌مرورگری برای نسخه‌ی آنلاین: همان منطق سرور، با ذخیره‌ی localStorage (یا حافظه اگر در دسترس نبود)
import { NODE_TYPES } from "../../server/src/api/catalog";
import { HttpError, maskSecrets, mergeSecrets, parseWorkflow, sanitizePositions } from "../../server/src/api/logic";
import type { StoredExecution, StoredWorkflow } from "../../server/src/api/types";
import { executeWorkflow } from "../../server/src/engine/executor";
import type { Item } from "../../server/src/engine/types";

const KEY = "jaryan-demo-v1";
interface Data { workflows: StoredWorkflow[]; executions: StoredExecution[] }

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Data;
  } catch { /* بدون ذخیره‌سازی ادامه می‌دهیم */ }
  return { workflows: [], executions: [] };
}
let data = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* فقط در حافظه */ }
}

const uuid = () => crypto.randomUUID();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function route(method: string, path: string, body: unknown): Promise<Response> {
  const parts = path.split("/").filter(Boolean);
  if (parts[1] === "node-types" && method === "GET") return json(200, NODE_TYPES);

  if (parts[1] === "workflows") {
    const id = parts[2];
    if (!id) {
      if (method === "GET") {
        return json(200, data.workflows.map((w) => ({ id: w.id, name: w.name, active: w.active, nodeCount: w.nodes.length, updatedAt: w.updatedAt })));
      }
      if (method === "POST") {
        const b = (body ?? {}) as Record<string, unknown>;
        const wf = parseWorkflow(b);
        const now = Date.now();
        const stored: StoredWorkflow = { ...wf, id: uuid(), active: false, createdAt: now, updatedAt: now, positions: sanitizePositions(b.positions) };
        data.workflows.push(stored); save();
        return json(201, maskSecrets(stored));
      }
      throw new HttpError(405, "روش مجاز نیست");
    }
    const existing = data.workflows.find((w) => w.id === id);
    if (!existing) throw new HttpError(404, "گردش‌کار پیدا نشد");
    const sub = parts[3];
    if (!sub) {
      if (method === "GET") return json(200, maskSecrets(existing));
      if (method === "PUT") {
        const b = (body ?? {}) as Record<string, unknown>;
        const wf = mergeSecrets(parseWorkflow(b), existing);
        const stored: StoredWorkflow = {
          ...existing, ...wf, id: existing.id,
          active: typeof b.active === "boolean" ? b.active : existing.active,
          positions: sanitizePositions(b.positions) ?? existing.positions,
          updatedAt: Date.now(),
        };
        data.workflows = data.workflows.map((w) => (w.id === id ? stored : w)); save();
        return json(200, maskSecrets(stored));
      }
      if (method === "DELETE") {
        data.workflows = data.workflows.filter((w) => w.id !== id);
        data.executions = data.executions.filter((e) => e.workflowId !== id); save();
        return json(200, { ok: true });
      }
      throw new HttpError(405, "روش مجاز نیست");
    }
    if (sub === "run" && method === "POST") {
      const b = (body ?? {}) as { input?: unknown };
      let input: Item[] = [{}];
      if (b.input !== undefined) {
        if (!Array.isArray(b.input) || b.input.length > 100 || b.input.some((x) => !x || typeof x !== "object" || Array.isArray(x))) {
          throw new HttpError(400, "ورودی باید فهرستی از شیءها (حداکثر ۱۰۰) باشد");
        }
        input = b.input as Item[];
      }
      const startedAt = Date.now();
      const realFetch = originalFetch;
      let result;
      try {
        result = await executeWorkflow(existing, input, {
          fetch: ((u: RequestInfo | URL, i?: RequestInit) => realFetch(u, { ...i, signal: AbortSignal.timeout(30_000) })) as typeof fetch,
        });
      } catch (e) {
        result = { status: "error" as const, runs: [], error: (e as Error).message };
      }
      // خطای شبکه در مرورگر پیام مبهم دارد؛ توضیح می‌دهیم
      for (const r of result.runs) {
        if (r.error === "Failed to fetch" || r.error === "Load failed" || r.error === "NetworkError when attempting to fetch resource.") {
          r.error = "اتصال به اینترنت در نسخه‌ی آنلاین مسدود است. این گره را با بسته‌ی zip روی کامپیوتر خودتان امتحان کنید.";
        }
      }
      if (result.status === "error" && result.runs.some((r) => r.status === "error")) {
        const bad = result.runs.find((r) => r.status === "error")!;
        result.error = `${bad.nodeName}: ${bad.error}`;
      }
      const exec: StoredExecution = { ...result, id: uuid(), workflowId: id, mode: "manual", startedAt, finishedAt: Date.now() };
      data.executions.push(exec);
      if (data.executions.length > 100) data.executions.splice(0, data.executions.length - 100);
      save();
      return json(200, exec);
    }
    if (sub === "executions" && method === "GET") {
      return json(200, [...data.executions].reverse().filter((e) => e.workflowId === id)
        .map((e) => ({ id: e.id, status: e.status, mode: e.mode, startedAt: e.startedAt, finishedAt: e.finishedAt, error: e.error })));
    }
    throw new HttpError(404, "مسیر پیدا نشد");
  }
  if (parts[1] === "executions" && parts[2] && method === "GET") {
    const e = data.executions.find((x) => x.id === parts[2]);
    if (!e) throw new HttpError(404, "اجرا پیدا نشد");
    return json(200, e);
  }
  throw new HttpError(404, "مسیر پیدا نشد");
}

const originalFetch = window.fetch.bind(window);

export function installDemoApi() {
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith("/api/") && !url.pathname.includes("/api/")) return originalFetch(input, init);
    const path = url.pathname.slice(url.pathname.indexOf("/api/"));
    try {
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return await route(method, path, body);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      return json(500, { error: "خطای داخلی" });
    }
  }) as typeof fetch;
}
