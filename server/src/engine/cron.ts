// تجزیه‌گر کرون پنج‌فیلدی (دقیقه ساعت روز‌ماه ماه روز‌هفته) — بدون وابستگی بیرونی

interface Field { values: Set<number>; star: boolean }
export interface CronSpec { minute: Field; hour: Field; dom: Field; month: Field; dow: Field }

const RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function parseField(src: string, [min, max]: [number, number], label: string): Field {
  const values = new Set<number>();
  const star = src === "*";
  for (const part of src.split(",")) {
    if (!part) throw new Error(`فیلد ${label} نامعتبر است`);
    const [range, stepS] = part.split("/");
    let step = 1;
    if (stepS !== undefined) {
      if (!/^\d+$/.test(stepS) || Number(stepS) < 1) throw new Error(`گام فیلد ${label} نامعتبر است`);
      step = Number(stepS);
    }
    let lo: number, hi: number;
    if (range === "*") { lo = min; hi = max; }
    else if (/^\d+$/.test(range)) { lo = Number(range); hi = stepS !== undefined ? max : lo; }
    else if (/^\d+-\d+$/.test(range)) { [lo, hi] = range.split("-").map(Number); }
    else throw new Error(`فیلد ${label} نامعتبر است: «${part}»`);
    if (lo < min || hi > max || lo > hi) throw new Error(`مقدار فیلد ${label} خارج از بازه‌ی ${min}–${max} است`);
    for (let v = lo; v <= hi; v += step) values.add(label === "روزهفته" && v === 7 ? 0 : v);
  }
  return { values, star };
}

export function parseCron(expr: string): CronSpec {
  const f = String(expr ?? "").trim().split(/\s+/);
  if (f.length !== 5) throw new Error("کرون باید پنج بخش داشته باشد: دقیقه ساعت روز-ماه ماه روز-هفته");
  const labels = ["دقیقه", "ساعت", "روزماه", "ماه", "روزهفته"];
  const [minute, hour, dom, month, dow] = f.map((s, i) => parseField(s, RANGES[i], labels[i]));
  return { minute, hour, dom, month, dow };
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** اجزای زمان در منطقه‌ی زمانی داده‌شده */
export function zonedParts(date: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
      weekday: "short", hourCycle: "h23",
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: WD[p.weekday] };
}

export function cronMatches(spec: CronSpec, date: Date, timeZone = "Asia/Tehran"): boolean {
  const t = zonedParts(date, timeZone);
  if (!spec.minute.values.has(t.minute) || !spec.hour.values.has(t.hour) || !spec.month.values.has(t.month)) return false;
  const domOk = spec.dom.values.has(t.day), dowOk = spec.dow.values.has(t.weekday);
  // قاعده‌ی استاندارد: اگر هر دو محدود شده باشند یکی کافی است
  if (!spec.dom.star && !spec.dow.star) return domOk || dowOk;
  return domOk && dowOk;
}

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
