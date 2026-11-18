import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export interface FlowNodeData extends Record<string, unknown> {
  type: string;
  name: string;
  label: string;
  group: string;
  params: Record<string, unknown>;
  status?: "success" | "error";
}
export type FlowNode = Node<FlowNodeData, "card">;

export function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const isTrigger = data.type === "trigger";
  const isCondition = data.type === "condition";
  return (
    <div className={`card-node ${selected ? "sel" : ""} ${data.status ?? ""} ${isCondition ? "has-branches" : ""}`} dir="rtl">
      {!isTrigger && <Handle type="target" position={Position.Right} id="in" />}
      <div className="cn-group">{data.group}</div>
      <div className="cn-name">{data.name}</div>
      <div className="cn-type">{data.label}</div>
      {data.status && <div className="cn-status">{data.status === "success" ? "✓ موفق" : "✕ خطا"}</div>}
      {isCondition ? (
        <>
          <Handle type="source" position={Position.Left} id="true" style={{ top: "30%" }} />
          <span className="h-label" style={{ top: "30%" }}>درست</span>
          <Handle type="source" position={Position.Left} id="false" style={{ top: "70%" }} />
          <span className="h-label" style={{ top: "70%" }}>نادرست</span>
        </>
      ) : (
        <Handle type="source" position={Position.Left} id="main" />
      )}
    </div>
  );
}
