import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredExecution, StoredWorkflow } from "./types.js";

export type { StoredExecution, StoredWorkflow };

interface Data {
  workflows: StoredWorkflow[];
  executions: StoredExecution[];
}

/** مخزن فایلی ساده برای نسخه‌ی آزمایشی؛ جایگزین آن PostgreSQL است */
export class FileStore {
  private data: Data = { workflows: [], executions: [] };
  private chain: Promise<void> = Promise.resolve();
  constructor(private dir: string, private maxExecutions = 200) {}

  private get file() { return path.join(this.dir, "data.json"); }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8")) as Data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    this.chain = this.chain.then(async () => {
      const tmp = this.file + ".tmp";
      await writeFile(tmp, snapshot, "utf8");
      await rename(tmp, this.file);
    });
    return this.chain;
  }

  listWorkflows() { return this.data.workflows; }
  getWorkflow(id: string) { return this.data.workflows.find((w) => w.id === id); }

  async putWorkflow(w: StoredWorkflow) {
    const i = this.data.workflows.findIndex((x) => x.id === w.id);
    if (i >= 0) this.data.workflows[i] = w; else this.data.workflows.push(w);
    await this.save();
  }

  async deleteWorkflow(id: string) {
    this.data.workflows = this.data.workflows.filter((w) => w.id !== id);
    this.data.executions = this.data.executions.filter((e) => e.workflowId !== id);
    await this.save();
  }

  listExecutions(workflowId?: string) {
    const all = workflowId ? this.data.executions.filter((e) => e.workflowId === workflowId) : this.data.executions;
    return [...all].reverse();
  }
  getExecution(id: string) { return this.data.executions.find((e) => e.id === id); }

  async addExecution(e: StoredExecution) {
    this.data.executions.push(e);
    if (this.data.executions.length > this.maxExecutions) {
      this.data.executions.splice(0, this.data.executions.length - this.maxExecutions);
    }
    await this.save();
  }
}
