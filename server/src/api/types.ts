import type { ExecutionResult, Workflow } from "../engine/types.js";

// انواع ذخیره‌شده (بدون ماژول Node؛ در مرورگر هم استفاده می‌شود)

export interface StoredWorkflow extends Workflow {
  active: boolean;
  createdAt: number;
  updatedAt: number;
  /** موقعیت گره‌ها روی بوم: شناسه ← {x,y} */
  positions?: Record<string, { x: number; y: number }>;
}

export interface StoredExecution extends ExecutionResult {
  id: string;
  workflowId: string;
  mode: "manual" | "webhook" | "schedule" | "bot";
  startedAt: number;
  finishedAt: number;
}

