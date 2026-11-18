import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { executeWorkflow, validateWorkflow } from "../engine/executor.js";
import type { Item, Workflow } from "../engine/types.js";
import { NODE_TYPES, SECRET_KEYS } from "./catalog.js";
import { FileStore, type StoredExecution, type StoredWorkflow } from "./store.js";

export interface AppOptions {
  dataDir: string;
  publicDir?: string;
  fetch?: typeof fetch;
  /** میزبان‌های مجاز برای /api (جلوگیری از DNS rebinding)؛ null = بدون بررسی */
  allowedHosts?: string[] | null;
  maxBodyBytes?: number;
  fetchTimeoutMs?: number;
}

const MAX_NODES = 100;
const MAX_CONNECTIONS = 300;
export const SECRET_PLACEHOLDER = "__SECRET__";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon",
};

function maskSecrets(w: StoredWorkflow): StoredWorkflow {
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
function mergeSecrets(next: Workflow, prev?: StoredWorkflow): Workflow {
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

function parseWorkflow(body: unknown): Workflow {
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
    return { id: n.id, name: n.name.trim(), type: n.type, params };
  });
  const connections = b.connections.map((raw) => {
    const c = raw as Record<string, unknown>;
    if (typeof c.from !== "string" || typeof c.to !== "string") throw new HttpError(400, "اتصال نامعتبر است");
    const out = typeof c.output === "string" ? c.output : undefined;
    if (out !== undefined && !["main", "true", "false"].includes(out)) throw new HttpError(400, "خروجی اتصال نامعتبر است");
    return { from: c.from, to: c.to, ...(out ? { output: out } : {}) };
  });
  const wf: Workflow = { id: "", name, nodes, connections };
  try { validateWorkflow(wf); } catch (e) { throw new HttpError(400, (e as Error).message); }
  return wf;
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw new HttpError(413, "حجم درخواست بیش از حد مجاز است");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

export async function createApp(opts: AppOptions): Promise<{ server: Server; store: FileStore }> {
  const store = new FileStore(opts.dataDir);
  await store.load();
  const maxBody = opts.maxBodyBytes ?? 1_000_000;
  const baseFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.fetchTimeoutMs ?? 30_000;
  const guardedFetch = ((url: RequestInfo | URL, init?: RequestInit) =>
    baseFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })) as typeof fetch;
  const allowedHosts = opts.allowedHosts === undefined ? ["localhost", "127.0.0.1", "[::1]"] : opts.allowedHosts;

  async function runWorkflow(wf: StoredWorkflow, input: Item[], mode: "manual" | "webhook"): Promise<StoredExecution> {
    const startedAt = Date.now();
    let result;
    try {
      result = await executeWorkflow(wf, input, { fetch: guardedFetch });
    } catch (e) {
      result = { status: "error" as const, runs: [], error: (e as Error).message };
    }
    const exec: StoredExecution = { ...result, id: randomUUID(), workflowId: wf.id, mode, startedAt, finishedAt: Date.now() };
    await store.addExecution(exec);
    return exec;
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    const method = req.method ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    if (method !== "GET") {
      const ct = req.headers["content-type"] ?? "";
      if (!ct.startsWith("application/json")) throw new HttpError(415, "نوع محتوا باید application/json باشد");
    }
    const readJson = async () => {
      const raw = await readBody(req, maxBody);
      if (!raw) return {};
      try { return JSON.parse(raw); } catch { throw new HttpError(400, "JSON نامعتبر است"); }
    };

    if (parts[1] === "node-types" && method === "GET") return send(res, 200, NODE_TYPES);

    if (parts[1] === "workflows") {
      const id = parts[2];
      if (!id) {
        if (method === "GET") {
          return send(res, 200, store.listWorkflows().map((w) => ({
            id: w.id, name: w.name, active: w.active, nodeCount: w.nodes.length, updatedAt: w.updatedAt,
          })));
        }
        if (method === "POST") {
          const body = (await readJson()) as Record<string, unknown>;
          const wf = parseWorkflow(body);
          const now = Date.now();
          const stored: StoredWorkflow = {
            ...wf, id: randomUUID(), active: false, createdAt: now, updatedAt: now,
            positions: sanitizePositions(body.positions),
          };
          await store.putWorkflow(stored);
          return send(res, 201, maskSecrets(stored));
        }
        throw new HttpError(405, "روش مجاز نیست");
      }
      const existing = store.getWorkflow(id);
      if (!existing) throw new HttpError(404, "گردش‌کار پیدا نشد");
      const sub = parts[3];
      if (!sub) {
        if (method === "GET") return send(res, 200, maskSecrets(existing));
        if (method === "PUT") {
          const body = (await readJson()) as Record<string, unknown>;
          const wf = mergeSecrets(parseWorkflow(body), existing);
          const stored: StoredWorkflow = {
            ...existing, ...wf, id: existing.id,
            active: typeof body.active === "boolean" ? body.active : existing.active,
            positions: sanitizePositions(body.positions) ?? existing.positions,
            updatedAt: Date.now(),
          };
          await store.putWorkflow(stored);
          return send(res, 200, maskSecrets(stored));
        }
        if (method === "DELETE") { await store.deleteWorkflow(id); return send(res, 200, { ok: true }); }
        throw new HttpError(405, "روش مجاز نیست");
      }
      if (sub === "run" && method === "POST") {
        const body = (await readJson()) as { input?: unknown };
        let input: Item[] = [{}];
        if (body.input !== undefined) {
          if (!Array.isArray(body.input) || body.input.length > 100 || body.input.some((x) => !x || typeof x !== "object" || Array.isArray(x))) {
            throw new HttpError(400, "ورودی باید فهرستی از شیءها (حداکثر ۱۰۰) باشد");
          }
          input = body.input as Item[];
        }
        return send(res, 200, await runWorkflow(existing, input, "manual"));
      }
      if (sub === "executions" && method === "GET") return send(res, 200, store.listExecutions(id).map(summary));
      throw new HttpError(404, "مسیر پیدا نشد");
    }

    if (parts[1] === "executions" && parts[2] && method === "GET") {
      const e = store.getExecution(parts[2]);
      if (!e) throw new HttpError(404, "اجرا پیدا نشد");
      return send(res, 200, e);
    }
    throw new HttpError(404, "مسیر پیدا نشد");
  }

  async function handleWebhook(req: IncomingMessage, res: ServerResponse, url: URL) {
    const id = url.pathname.split("/").filter(Boolean)[1];
    const wf = id ? store.getWorkflow(id) : undefined;
    if (!wf) throw new HttpError(404, "وب‌هوک پیدا نشد");
    if (!wf.active) throw new HttpError(409, "گردش‌کار فعال نیست");
    const raw = await readBody(req, maxBody);
    let body: unknown = raw;
    if (raw && (req.headers["content-type"] ?? "").startsWith("application/json")) {
      try { body = JSON.parse(raw); } catch { throw new HttpError(400, "JSON نامعتبر است"); }
    }
    const query = Object.fromEntries(url.searchParams);
    const exec = await runWorkflow(wf, [{ body: body === "" ? null : body, query }], "webhook");
    return send(res, exec.status === "success" ? 200 : 500, { status: exec.status, executionId: exec.id, error: exec.error });
  }

  async function serveStatic(res: ServerResponse, pathname: string) {
    if (!opts.publicDir) throw new HttpError(404, "پیدا نشد");
    const root = path.resolve(opts.publicDir);
    let rel = decodeURIComponent(pathname);
    if (rel === "/") rel = "/index.html";
    let file = path.resolve(root, "." + rel);
    if (file !== root && !file.startsWith(root + path.sep)) throw new HttpError(403, "دسترسی ممنوع");
    try { if (!(await stat(file)).isFile()) throw new Error(); } catch { file = path.join(root, "index.html"); } // مسیرهای رابط (SPA)
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  }

  const server = createServer((req, res) => {
    (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      res.setHeader("x-content-type-options", "nosniff");
      if (url.pathname.startsWith("/api/")) {
        if (allowedHosts) {
          const host = (req.headers.host ?? "").replace(/:\d+$/, "");
          if (!allowedHosts.includes(host)) throw new HttpError(403, "میزبان مجاز نیست");
        }
        return handleApi(req, res, url);
      }
      if (url.pathname.startsWith("/webhook/")) return handleWebhook(req, res, url);
      if (req.method !== "GET") throw new HttpError(405, "روش مجاز نیست");
      return serveStatic(res, url.pathname);
    })().catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: e instanceof HttpError ? e.message : "خطای داخلی سرور" });
    });
  });
  return { server, store };
}

function summary(e: StoredExecution) {
  return { id: e.id, status: e.status, mode: e.mode, startedAt: e.startedAt, finishedAt: e.finishedAt, error: e.error };
}

function sanitizePositions(p: unknown): Record<string, { x: number; y: number }> | undefined {
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
