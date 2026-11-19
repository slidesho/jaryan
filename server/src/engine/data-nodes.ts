import { toGregorian, toJalali, JALALI_MONTHS, WEEKDAYS_FA } from "./jalali.js";
import type { Item, NodeHandler } from "./types.js";

// ───────── ابزارها ─────────
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of String(path).split(".").filter(Boolean)) {
    if (FORBIDDEN.has(k) || cur === null || typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function compare(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case "equals": return a == b; // eslint-disable-line eqeqeq
    case "notEquals": return a != b; // eslint-disable-line eqeqeq
    case "gt": return Number(a) > Number(b);
    case "lt": return Number(a) < Number(b);
    case "gte": return Number(a) >= Number(b);
    case "lte": return Number(a) <= Number(b);
    case "contains": return String(a ?? "").includes(String(b ?? ""));
    case "isEmpty": return a === undefined || a === null || a === "";
    case "isNotEmpty": return !(a === undefined || a === null || a === "");
    default: throw new Error(`عملگر شرط ناشناخته است: ${op}`);
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

// ───────── فیلتر ─────────
const filter: NodeHandler = async (ctx, items) => {
  const { left, op = "equals", right } = ctx.params as { left?: unknown; op?: string; right?: unknown };
  const keep = compare(left, op, right);
  return keep ? { main: items, rest: [] } : { main: [], rest: items };
};

// ───────── سوییچ (چند شاخه) ─────────
const switchNode: NodeHandler = async (ctx, items) => {
  const { value, cases } = ctx.params as { value?: unknown; cases?: unknown };
  const list = Array.isArray(cases) ? cases : [];
  if (list.length > 10) throw new Error("حداکثر ۱۰ حالت مجاز است");
  const out: Record<string, Item[]> = { other: [] };
  list.forEach((_c, i) => { out[`c${i}`] = []; });
  const idx = list.findIndex((c) => String((c as { value?: unknown })?.value ?? "") === String(value ?? ""));
  (out[idx >= 0 ? `c${idx}` : "other"]).push(...items);
  return out;
};

// ───────── مرتب‌سازی ─────────
const sort: NodeHandler = async (ctx, items) => {
  const { field, order = "asc", numeric = false } = ctx.params as { field?: string; order?: string; numeric?: boolean };
  if (!field) throw new Error("نام فیلد مرتب‌سازی الزامی است");
  const dir = order === "desc" ? -1 : 1;
  const arr = items.map((it, i) => ({ it, i }));
  arr.sort((a, b) => {
    const x = getPath(a.it, field), y = getPath(b.it, field);
    let c: number;
    if (numeric === true || numeric === ("true" as unknown)) c = Number(x) - Number(y);
    else c = String(x ?? "").localeCompare(String(y ?? ""), "fa");
    return c !== 0 && !Number.isNaN(c) ? c * dir : a.i - b.i;
  });
  return { main: arr.map((x) => x.it) };
};

// ───────── ادغام ─────────
const merge: NodeHandler = async (ctx, items) => {
  const { mode = "append", field } = ctx.params as { mode?: string; field?: string };
  if (mode === "single") return { main: [Object.assign({}, ...items)] };
  if (mode === "unique") {
    if (!field) throw new Error("نام فیلد یکتا الزامی است");
    const seen = new Set<string>();
    return { main: items.filter((it) => { const k = JSON.stringify(getPath(it, field)); if (seen.has(k)) return false; seen.add(k); return true; }) };
  }
  return { main: items };
};

// ───────── شکستن و جمع‌کردن فهرست ─────────
const splitOut: NodeHandler = async (ctx, items) => {
  const { field, keepParent = false } = ctx.params as { field?: string; keepParent?: boolean };
  if (!field) throw new Error("نام فیلد فهرست الزامی است");
  const out: Item[] = [];
  for (const it of items) {
    const arr = getPath(it, field);
    if (!Array.isArray(arr)) throw new Error(`فیلد «${field}» فهرست نیست`);
    if (arr.length > 1000) throw new Error("حداکثر ۱۰۰۰ عضو در هر فهرست مجاز است");
    for (const el of arr) {
      const base = el && typeof el === "object" && !Array.isArray(el) ? (el as Item) : { value: el };
      out.push(keepParent === true || keepParent === ("true" as unknown) ? { ...it, ...base } : base);
    }
  }
  return { main: out };
};

const aggregate: NodeHandler = async (ctx, items) => {
  const { field, outputField = "items" } = ctx.params as { field?: string; outputField?: string };
  const list = field ? items.map((it) => getPath(it, field)) : items;
  return { main: [{ [outputField || "items"]: list, count: items.length }] };
};

// ───────── تاریخ (شمسی) ─────────
function parseGregorian(v: unknown): { y: number; m: number; d: number } {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`تاریخ میلادی نامعتبر است: «${s}» (قالب درست: 2026-11-18)`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) throw new Error(`تاریخ وجود ندارد: ${s}`);
  return { y, m: mo, d };
}

function tehranDateParts(date: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), time: `${p.hour}:${p.minute}` };
}

function describe(y: number, m: number, d: number) {
  const j = toJalali(y, m, d);
  const wd = WEEKDAYS_FA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return {
    gregorian: `${y}-${pad(m)}-${pad(d)}`,
    jalali: `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`,
    jy: j.jy, jm: j.jm, jd: j.jd,
    monthName: JALALI_MONTHS[j.jm - 1],
    weekday: wd,
  };
}

const date: NodeHandler = async (ctx, items) => {
  const { op = "now", value, days, outputField = "date" } = ctx.params as {
    op?: string; value?: unknown; days?: unknown; outputField?: string;
  };
  let result: Record<string, unknown>;
  if (op === "now") {
    const t = tehranDateParts(new Date());
    result = { ...describe(t.y, t.m, t.d), time: t.time };
  } else if (op === "toJalali") {
    const s = String(value ?? "");
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
      const dt = new Date(s);
      if (Number.isNaN(dt.getTime())) throw new Error(`تاریخ نامعتبر است: «${s}»`);
      const t = tehranDateParts(dt);
      result = { ...describe(t.y, t.m, t.d), time: t.time };
    } else {
      const g = parseGregorian(s);
      result = describe(g.y, g.m, g.d);
    }
  } else if (op === "fromJalali") {
    const m = String(value ?? "").trim().replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (!m) throw new Error(`تاریخ شمسی نامعتبر است: «${String(value ?? "")}» (قالب درست: 1405/08/27)`);
    const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (jm < 1 || jm > 12 || jd < 1 || jd > 31 || (jm > 6 && jd > 30)) throw new Error("تاریخ شمسی وجود ندارد");
    const g = toGregorian(jy, jm, jd);
    const back = toJalali(g.gy, g.gm, g.gd);
    if (back.jy !== jy || back.jm !== jm || back.jd !== jd) throw new Error("تاریخ شمسی وجود ندارد (روز ۳۰ اسفند فقط در سال کبیسه)");
    result = describe(g.gy, g.gm, g.gd);
  } else if (op === "addDays") {
    const n = Number(days);
    if (!Number.isInteger(n) || Math.abs(n) > 36500) throw new Error("تعداد روز باید عدد صحیح (حداکثر ±۳۶۵۰۰) باشد");
    const g = parseGregorian(value);
    const t = new Date(Date.UTC(g.y, g.m - 1, g.d + n));
    result = describe(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  } else {
    throw new Error(`عملیات تاریخ ناشناخته است: ${op}`);
  }
  return { main: items.map((it) => ({ ...it, [outputField || "date"]: result })) };
};

// ───────── CSV ─────────
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delimiter) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cur += c;
  }
  if (q) throw new Error("CSV نامعتبر است: گیومه بسته نشده");
  row.push(cur);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

const csvParse: NodeHandler = async (ctx, items) => {
  const { text, delimiter = ",", hasHeader = true } = ctx.params as { text?: unknown; delimiter?: string; hasHeader?: boolean };
  const src = String(text ?? "");
  if (src.length > 2_000_000) throw new Error("حجم CSV بیش از ۲ مگابایت است");
  const rows = parseCsv(src, delimiter || ",");
  if (rows.length > 10_000) throw new Error("حداکثر ۱۰۰۰۰ ردیف مجاز است");
  const header = hasHeader === false || hasHeader === ("false" as unknown) ? rows[0]?.map((_, i) => `ستون${i + 1}`) : rows.shift();
  void items;
  return { main: rows.map((r) => Object.fromEntries((header ?? []).map((h, i) => [h, r[i] ?? ""]))) };
};

function csvCell(v: unknown, delimiter: string): string {
  let s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // جلوگیری از تزریق فرمول در اکسل
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /["\n\r]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvStringify: NodeHandler = async (ctx, items) => {
  const { delimiter = ",", outputField = "csv", bom = true } = ctx.params as { delimiter?: string; outputField?: string; bom?: boolean };
  const d = delimiter || ",";
  const keys: string[] = [];
  for (const it of items) for (const k of Object.keys(it)) if (!keys.includes(k)) keys.push(k);
  const lines = [keys.map((k) => csvCell(k, d)).join(d), ...items.map((it) => keys.map((k) => csvCell(it[k], d)).join(d))];
  return { main: [{ [outputField || "csv"]: (bom === false || bom === ("false" as unknown) ? "" : "﻿") + lines.join("\r\n"), rows: items.length }] };
};

export const dataNodes: Record<string, NodeHandler> = {
  filter, switch: switchNode, sort, merge, splitOut, aggregate, date, csvParse, csvStringify,
};
