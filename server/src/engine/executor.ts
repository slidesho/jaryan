import { resolveParams } from "./expression.js";
import { MAX_RETRY_DELAY_MS, MAX_RETRY_TIMES, PER_ITEM_TYPES, RAW_PARAMS, TRIGGER_TYPES } from "./meta.js";
import { serviceNodes } from "./service-nodes.js";
import { code } from "./code-node.js";
import { dataNodes } from "./data-nodes.js";
import { messagingNodes } from "./messaging-nodes.js";
import { builtinNodes } from "./nodes.js";
import type {
  ExecutionResult, Item, NodeHandler, NodeOutputs, NodeRun, Workflow, WorkflowNode,
} from "./types.js";

export interface ExecuteOptions {
  handlers?: Record<string, NodeHandler>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** نام یا شناسه‌ی گره شروع؛ پیش‌فرض: گره‌ی بدون ورودی از نوع trigger */
  startNodeId?: string;
  /** سقف تعداد گره‌های اجراشده (پارامتر ادمین) */
  maxNodeRuns?: number;
}

/** خطای ساختار گردش‌کار (چرخه، گره‌ی ناموجود، نام تکراری) پیش از اجرا گرفته می‌شود */
export function validateWorkflow(wf: Workflow): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const n of wf.nodes) {
    if (ids.has(n.id)) throw new Error(`شناسه‌ی گره تکراری است: ${n.id}`);
    if (names.has(n.name)) throw new Error(`نام گره تکراری است: ${n.name}`);
    ids.add(n.id);
    names.add(n.name);
  }
  for (const c of wf.connections) {
    if (!ids.has(c.from) || !ids.has(c.to)) throw new Error("اتصال به گره‌ی ناموجود اشاره می‌کند");
  }
  // تشخیص چرخه با الگوریتم کان
  const indeg = new Map<string, number>(wf.nodes.map((n) => [n.id, 0]));
  for (const c of wf.connections) indeg.set(c.to, (indeg.get(c.to) ?? 0) + 1);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift()!;
    seen++;
    for (const c of wf.connections.filter((x) => x.from === id)) {
      const d = (indeg.get(c.to) ?? 0) - 1;
      indeg.set(c.to, d);
      if (d === 0) queue.push(c.to);
    }
  }
  if (seen !== wf.nodes.length) throw new Error("گردش‌کار چرخه دارد");
}

export async function executeWorkflow(
  wf: Workflow,
  input: Item[] = [{}],
  opts: ExecuteOptions = {},
): Promise<ExecutionResult> {
  validateWorkflow(wf);
  const handlers = { ...builtinNodes, ...dataNodes, ...messagingNodes, ...serviceNodes, code, ...opts.handlers };
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRuns = opts.maxNodeRuns ?? 500;

  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, number>();
  for (const c of wf.connections) incoming.set(c.to, (incoming.get(c.to) ?? 0) + 1);

  const start =
    (opts.startNodeId && byId.get(opts.startNodeId)) ||
    wf.nodes.find((n) => TRIGGER_TYPES.has(n.type) && !incoming.has(n.id));
  if (!start) throw new Error("گره‌ی شروع (محرک) پیدا نشد");

  // آیتم‌های رسیده به هر گره؛ شاخه‌های ادغام‌شده آیتم‌هایشان را پشت هم اضافه می‌کنند
  const pending = new Map<string, Item[]>();
  const nodeOutputs: Record<string, Item[]> = {};
  const runs: NodeRun[] = [];

  const order = topoOrder(wf);
  pending.set(start.id, input);

  for (const id of order) {
    const node = byId.get(id)!;
    // گره‌ای که هیچ آیتمی دریافت نکرده (شاخه‌ی غیرفعال) اجرا نمی‌شود
    if (!pending.has(id)) continue;
    if (runs.length >= maxRuns) {
      return { status: "error", runs, error: "سقف تعداد اجرای گره‌ها رد شد" };
    }
    const items = pending.get(id) ?? [];
    const run = await runNode(node, items, nodeOutputs, handlers, doFetch, sleep);
    runs.push(run);
    if (run.status === "error") {
      return { status: "error", runs, error: `${node.name}: ${run.error}` };
    }
    nodeOutputs[node.name] = run.output.main ?? Object.values(run.output)[0] ?? [];
    for (const c of wf.connections.filter((x) => x.from === id)) {
      const outName = c.output ?? "main";
      const produced = run.output[outName];
      if (produced && produced.length > 0) {
        pending.set(c.to, [...(pending.get(c.to) ?? []), ...produced]);
      }
    }
  }
  return { status: "success", runs };
}

async function runNode(
  node: WorkflowNode,
  items: Item[],
  nodeOutputs: Record<string, Item[]>,
  handlers: Record<string, NodeHandler>,
  doFetch: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<NodeRun> {
  const startedAt = Date.now();
  const handler = handlers[node.type];
  const retry = node.retry && node.retry.times > 0
    ? { times: Math.min(node.retry.times, MAX_RETRY_TIMES), delayMs: Math.min(Math.max(node.retry.delayMs, 0), MAX_RETRY_DELAY_MS) }
    : { times: 0, delayMs: 0 };

  /** یک بار اجرای گره روی مجموعه‌ای از آیتم‌ها، با تلاش دوباره */
  const attempt = async (scope: Item[]): Promise<NodeOutputs> => {
    let last: unknown;
    for (let i = 0; i <= retry.times; i++) {
      try {
        const raw = RAW_PARAMS[node.type] ?? [];
        const resolved = resolveParams(Object.fromEntries(Object.entries(node.params).filter(([k]) => !raw.includes(k))), { input: scope[0] ?? {}, nodeOutputs });
        const params = { ...resolved, ...Object.fromEntries(raw.filter((k) => k in node.params).map((k) => [k, node.params[k]])) };
        return await handler({ node, params, fetch: doFetch, sleep }, scope);
      } catch (e) {
        last = e;
        if (i < retry.times) await sleep(retry.delayMs);
      }
    }
    throw last;
  };

  try {
    if (!handler) throw new Error(`نوع گره ناشناخته است: ${node.type}`);
    let output: NodeOutputs;
    if (PER_ITEM_TYPES.has(node.type)) {
      output = {};
      for (const item of items) {
        try {
          const out = await attempt([item]);
          for (const [k, v] of Object.entries(out)) (output[k] ??= []).push(...v);
        } catch (e) {
          if (!node.continueOnFail) throw e;
          (output.main ??= []).push({ ...item, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (items.length === 0) output = { main: [] };
    } else {
      try {
        output = await attempt(items);
      } catch (e) {
        if (!node.continueOnFail) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        output = { main: items.map((it) => ({ ...it, error: msg })) };
      }
    }
    return { nodeId: node.id, nodeName: node.name, status: "success", input: items, output, startedAt, durationMs: Date.now() - startedAt };
  } catch (e) {
    return {
      nodeId: node.id, nodeName: node.name, status: "error", input: items, output: {},
      error: e instanceof Error ? e.message : String(e), startedAt, durationMs: Date.now() - startedAt,
    };
  }
}

function topoOrder(wf: Workflow): string[] {
  const indeg = new Map<string, number>(wf.nodes.map((n) => [n.id, 0]));
  for (const c of wf.connections) indeg.set(c.to, (indeg.get(c.to) ?? 0) + 1);
  const queue = wf.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const c of wf.connections.filter((x) => x.from === id)) {
      const d = (indeg.get(c.to) ?? 0) - 1;
      indeg.set(c.to, d);
      if (d === 0) queue.push(c.to);
    }
  }
  return out;
}
