import type { Item } from "./types.js";

/**
 * جایگذاری عبارت‌های {{ مسیر }} بدون هیچ eval.
 * مسیرهای مجاز:
 *   {{ $input.فیلد.زیرفیلد }}          آیتم جاری ورودی
 *   {{ $node["نام گره"].فیلد }}        اولین آیتم خروجی main یک گره قبلی
 * فقط خواندن ویژگی؛ هیچ تابع یا عملگری اجرا نمی‌شود.
 */

const EXPR = /\{\{\s*([^{}]+?)\s*\}\}/g;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

export interface ExprScope {
  input: Item;
  nodeOutputs: Record<string, Item[]>; // نام گره ← آیتم‌های main
}

function parsePath(path: string): string[] | null {
  const parts: string[] = [];
  let rest = path.trim();
  while (rest.length > 0) {
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\["([^"]+)"\]/)) || (m = rest.match(/^\['([^']+)'\]/))) {
      parts.push(m[1]);
    } else if ((m = rest.match(/^\.?([^.\[\]\s]+)/))) {
      parts.push(m[1]);
    } else {
      return null;
    }
    rest = rest.slice(m[0].length);
  }
  return parts;
}

function walk(value: unknown, keys: string[]): unknown {
  let cur: unknown = value;
  for (const k of keys) {
    if (FORBIDDEN.has(k)) return undefined;
    if (cur === null || typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function evaluatePath(path: string, scope: ExprScope): unknown {
  const parts = parsePath(path);
  if (!parts || parts.length === 0) return undefined;
  const [head, ...rest] = parts;
  if (head === "$input") return walk(scope.input, rest);
  if (head === "$node") {
    const [name, ...tail] = rest;
    const items = name === undefined ? undefined : scope.nodeOutputs[name];
    if (!items || items.length === 0) return undefined;
    return walk(items[0], tail);
  }
  return undefined;
}

export function resolveString(text: string, scope: ExprScope): unknown {
  const whole = text.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
  if (whole) return evaluatePath(whole[1], scope); // مقدار کامل با نوع اصلی
  return text.replace(EXPR, (_m, p: string) => {
    const v = evaluatePath(p, scope);
    if (v === undefined || v === null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

export function resolveParams<T>(value: T, scope: ExprScope): T {
  if (typeof value === "string") return resolveString(value, scope) as T;
  if (Array.isArray(value)) return value.map((v) => resolveParams(v, scope)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveParams(v, scope);
    return out as T;
  }
  return value;
}
