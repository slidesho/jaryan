import { cronMatches, isValidTimeZone, parseCron } from "../engine/cron.js";
import type { Item } from "../engine/types.js";
import type { StoredWorkflow } from "./types.js";

export type TriggerMode = "schedule" | "bot";

export interface TriggerManagerOptions {
  listWorkflows: () => StoredWorkflow[];
  run: (wf: StoredWorkflow, input: Item[], mode: TriggerMode, startNodeId: string) => Promise<unknown>;
  fetch?: typeof fetch;
  now?: () => Date;
  onError?: (msg: string) => void;
}

const BOT_BASE: Record<string, string> = { telegramTrigger: "https://api.telegram.org", baleTrigger: "https://tapi.bale.ai" };
const TOKEN_RE = /^\d+:[\w-]+$/;

interface Update { update_id: number; message?: { message_id: number; date: number; text?: string; chat?: { id: number; type?: string }; from?: { id: number; first_name?: string; username?: string } } }

/** اجرای خودکار گردش‌کارهای فعال: زمان‌بندی (کرون) و دریافت پیام ربات با getUpdates */
export class TriggerManager {
  private lastMinute = new Map<string, number>();
  private offsets = new Map<string, number>();
  private busy = new Set<string>();
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(private o: TriggerManagerOptions) {}

  start(intervalMs = 15_000) {
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  private err(msg: string, secret?: string) {
    const safe = secret ? msg.split(secret).join("***") : msg;
    (this.o.onError ?? ((m) => console.error(m)))(safe);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = (this.o.now ?? (() => new Date()))();
      const minuteKey = Math.floor(now.getTime() / 60_000);
      const jobs: Promise<void>[] = [];
      for (const wf of this.o.listWorkflows()) {
        if (!wf.active) continue;
        for (const node of wf.nodes) {
          if (node.type === "schedule") jobs.push(this.doSchedule(wf, node.id, node.params, now, minuteKey));
          else if (node.type === "telegramTrigger" || node.type === "baleTrigger") jobs.push(this.doPoll(wf, node.id, node.type, node.params));
        }
      }
      await Promise.all(jobs);
    } finally { this.ticking = false; }
  }

  private async doSchedule(wf: StoredWorkflow, nodeId: string, params: Record<string, unknown>, now: Date, minuteKey: number) {
    const key = `${wf.id}:${nodeId}`;
    if (this.lastMinute.get(key) === minuteKey) return;
    try {
      const tz = typeof params.timezone === "string" && params.timezone ? params.timezone : "Asia/Tehran";
      if (!isValidTimeZone(tz)) throw new Error("منطقه‌ی زمانی نامعتبر است");
      if (!cronMatches(parseCron(String(params.cron ?? "")), now, tz)) return;
    } catch (e) { this.err(`زمان‌بندی «${wf.name}»: ${(e as Error).message}`); return; }
    this.lastMinute.set(key, minuteKey);
    await this.o.run(wf, [{ triggeredAt: now.toISOString() }], "schedule", nodeId);
  }

  private async doPoll(wf: StoredWorkflow, nodeId: string, type: string, params: Record<string, unknown>) {
    const key = `${wf.id}:${nodeId}`;
    if (this.busy.has(key)) return;
    const token = String(params.token ?? "");
    if (!TOKEN_RE.test(token)) return; // توکن هنوز وارد نشده یا نامعتبر است
    this.busy.add(key);
    try {
      const first = !this.offsets.has(key);
      const offset = this.offsets.get(key);
      const url = `${BOT_BASE[type]}/bot${token}/getUpdates?timeout=0&limit=50${offset !== undefined ? `&offset=${offset}` : ""}`;
      const res = await (this.o.fetch ?? fetch)(url, { signal: AbortSignal.timeout(15_000) });
      const data = (await res.json()) as { ok?: boolean; result?: Update[]; description?: string };
      if (!res.ok || !data.ok || !Array.isArray(data.result)) throw new Error(`پاسخ ناموفق از ربات (${res.status})`);
      const updates = data.result;
      if (updates.length) this.offsets.set(key, Math.max(...updates.map((u) => u.update_id)) + 1);
      else if (first) this.offsets.set(key, 0);
      // اولین بار: پیام‌های قدیمی صف را رد می‌کنیم تا اجرای ناخواسته نشود
      if (first && offset === undefined) return;
      const items: Item[] = updates.filter((u) => u.message).map((u) => ({
        updateId: u.update_id,
        messageId: u.message!.message_id,
        chatId: u.message!.chat?.id,
        chatType: u.message!.chat?.type,
        text: u.message!.text ?? "",
        fromId: u.message!.from?.id,
        fromName: u.message!.from?.first_name,
        fromUsername: u.message!.from?.username,
        date: u.message!.date,
      }));
      if (items.length) await this.o.run(wf, items, "bot", nodeId);
    } catch (e) {
      this.err(`دریافت پیام ربات «${wf.name}»: ${(e as Error).message}`, token);
    } finally { this.busy.delete(key); }
  }
}
