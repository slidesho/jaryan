import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export interface FlowNodeData extends Record<string, unknown> {
  type: string;
  name: string;
  label: string;
  group: string;
  params: Record<string, unknown>;
  status?: "success" | "error";
  retry?: { times: number; delayMs: number };
  continueOnFail?: boolean;
}
export type FlowNode = Node<FlowNodeData, "card">;

/** خروجی‌های هر نوع گره (شناسه و برچسب) */
export function outputsOf(type: string, params: Record<string, unknown>): { id: string; label: string }[] {
  if (type === "condition") return [{ id: "true", label: "درست" }, { id: "false", label: "نادرست" }];
  if (type === "filter") return [{ id: "main", label: "عبور" }, { id: "rest", label: "ردشده" }];
  if (type === "switch") {
    const cases = Array.isArray(params.cases) ? params.cases.slice(0, 10) : [];
    return [
      ...cases.map((c, i) => ({ id: `c${i}`, label: String((c as { value?: unknown })?.value ?? `حالت ${i + 1}`).slice(0, 14) })),
      { id: "other", label: "دیگر" },
    ];
  }
  return [{ id: "main", label: "" }];
}

export const TRIGGER_TYPES = ["trigger", "schedule", "telegramTrigger", "baleTrigger"];

export function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const isTrigger = TRIGGER_TYPES.includes(data.type);
  const outs = outputsOf(data.type, data.params);
  const branched = outs.length > 1;
  return (
    <div className={`card-node ${selected ? "sel" : ""} ${data.status ?? ""} ${branched ? "has-branches" : ""}`} dir="rtl" style={branched ? { minHeight: 36 + outs.length * 24 } : undefined}>
      {!isTrigger && <Handle type="target" position={Position.Right} id="in" />}
      <div className="cn-group">{data.group}</div>
      <div className="cn-name">{data.name}</div>
      <div className="cn-type">{data.label}</div>
      {data.status && <div className="cn-status">{data.status === "success" ? "✓ موفق" : "✕ خطا"}</div>}
      {data.continueOnFail || data.retry ? (
        <div className="cn-flags">{data.retry ? `↻ ${data.retry.times}` : ""} {data.continueOnFail ? "⇢ ادامه با خطا" : ""}</div>
      ) : null}
      {branched ? outs.map((o, k) => {
        const top = `${((k + 1) / (outs.length + 1)) * 100}%`;
        return (
          <span key={o.id}>
            <Handle type="source" position={Position.Left} id={o.id} style={{ top }} />
            <span className="h-label" style={{ top }}>{o.label}</span>
          </span>
        );
      }) : <Handle type="source" position={Position.Left} id="main" />}
    </div>
  );
}
