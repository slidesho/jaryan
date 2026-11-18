// انواع پایه‌ی موتور اجرای گردش‌کار

export type Item = Record<string, unknown>;

export interface WorkflowNode {
  id: string;
  name: string; // نام یکتا؛ در عبارت‌ها با همین نام به خروجی گره اشاره می‌شود
  type: string;
  params: Record<string, unknown>;
}

export interface Connection {
  from: string; // شناسه‌ی گره مبدأ
  output?: string; // نام خروجی (پیش‌فرض main)؛ گره شرط: true | false
  to: string; // شناسه‌ی گره مقصد
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: Connection[];
}

/** خروجی هر گره: نام خروجی ← فهرست آیتم‌ها */
export type NodeOutputs = Record<string, Item[]>;

export interface NodeContext {
  node: WorkflowNode;
  params: Record<string, unknown>; // پارامترهای حل‌شده (بعد از جایگذاری عبارت‌ها)
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export type NodeHandler = (ctx: NodeContext, items: Item[]) => Promise<NodeOutputs>;

export type NodeStatus = "success" | "error" | "skipped";

export interface NodeRun {
  nodeId: string;
  nodeName: string;
  status: NodeStatus;
  input: Item[];
  output: NodeOutputs;
  error?: string;
  startedAt: number;
  durationMs: number;
}

export interface ExecutionResult {
  status: "success" | "error";
  runs: NodeRun[];
  error?: string;
}
