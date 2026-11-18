export type FieldType = "text" | "number" | "json" | "select" | "secret";
export interface FieldDef {
  key: string; label: string; type: FieldType;
  options?: { value: string; label: string }[]; placeholder?: string; default?: unknown;
}
export interface NodeTypeDef {
  type: string; label: string; group: string; description: string; fields: FieldDef[];
}
export interface WfNode { id: string; name: string; type: string; params: Record<string, unknown> }
export interface WfConn { from: string; to: string; output?: string }
export interface Workflow {
  id: string; name: string; nodes: WfNode[]; connections: WfConn[];
  active: boolean; positions?: Record<string, { x: number; y: number }>; updatedAt: number;
}
export interface WorkflowSummary { id: string; name: string; active: boolean; nodeCount: number; updatedAt: number }
export interface NodeRun {
  nodeId: string; nodeName: string; status: "success" | "error" | "skipped";
  input: unknown[]; output: Record<string, unknown[]>; error?: string; durationMs: number;
}
export interface Execution {
  id: string; status: "success" | "error"; mode: string; runs: NodeRun[]; error?: string;
  startedAt: number; finishedAt: number;
}
export interface ExecSummary { id: string; status: "success" | "error"; mode: string; startedAt: number; finishedAt: number; error?: string }

export const SECRET_PLACEHOLDER = "__SECRET__";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined || method !== "GET" ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : method !== "GET" ? "{}" : undefined,
    });
  } catch {
    throw new Error("ارتباط با سرور برقرار نشد. مطمئن شوید سرور روشن است.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `خطای ${res.status}`);
  return data as T;
}

export const api = {
  nodeTypes: () => call<NodeTypeDef[]>("GET", "/api/node-types"),
  list: () => call<WorkflowSummary[]>("GET", "/api/workflows"),
  get: (id: string) => call<Workflow>("GET", `/api/workflows/${id}`),
  create: (w: Partial<Workflow>) => call<Workflow>("POST", "/api/workflows", w),
  update: (id: string, w: Partial<Workflow>) => call<Workflow>("PUT", `/api/workflows/${id}`, w),
  remove: (id: string) => call<{ ok: true }>("DELETE", `/api/workflows/${id}`),
  run: (id: string, input?: unknown[]) => call<Execution>("POST", `/api/workflows/${id}/run`, input ? { input } : {}),
  executions: (id: string) => call<ExecSummary[]>("GET", `/api/workflows/${id}/executions`),
  execution: (id: string) => call<Execution>("GET", `/api/executions/${id}`),
};

const fa = new Intl.NumberFormat("fa-IR");
export const faNum = (n: number) => fa.format(n);
export const faDate = (t: number) =>
  new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "medium", timeStyle: "short" }).format(t);

export const SAMPLE = {
  name: "نمونه: برچسب سفارش گران یا ارزان",
  nodes: [
    { id: "t", name: "شروع", type: "trigger", params: {} },
    { id: "c", name: "مبلغ؟", type: "condition", params: { left: "{{ $input.body.مبلغ }}", op: "gt", right: "100" } },
    { id: "y", name: "گران", type: "set", params: { fields: { برچسب: "گران", پیام: "سلام {{ $input.body.نام }}، سفارش شما گران است" } } },
    { id: "n", name: "ارزان", type: "set", params: { fields: { برچسب: "ارزان", پیام: "سلام {{ $input.body.نام }}، سفارش شما ارزان است" } } },
  ],
  connections: [
    { from: "t", to: "c" },
    { from: "c", to: "y", output: "true" },
    { from: "c", to: "n", output: "false" },
  ],
  positions: { t: { x: 700, y: 120 }, c: { x: 440, y: 120 }, y: { x: 180, y: 20 }, n: { x: 180, y: 220 } },
};
export const SAMPLE_INPUT = '[{"body": {"نام": "علی", "مبلغ": 250}}]';
