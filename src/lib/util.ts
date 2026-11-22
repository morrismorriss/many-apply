export function slugify(s: string, max = 60): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/, "") || "untitled";
}

export function todayISO(d = new Date()): string {
  return toISO(d);
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local date (not UTC). */
export function fromISO(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function daysBetween(a: Date, b: Date): number {
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.round(ms / 86400000);
}

/** Days from today until the ISO date (negative if past). */
export function daysUntil(iso: string | null | undefined, today = new Date()): number | null {
  const d = fromISO(iso);
  return d ? daysBetween(today, d) : null;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function fmtDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  const d = fromISO(iso);
  if (!d) return "—";
  const showYear = opts.year ?? d.getFullYear() !== new Date().getFullYear();
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}${showYear ? `, ${d.getFullYear()}` : ""}`;
}

export function relDays(n: number | null): string {
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n < 0) return `${-n} days ago`;
  return `in ${n} days`;
}

export function fmtMoney(n: number | null | undefined, currency = "USD", compact = false): string {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: compact && Math.abs(n) >= 10000 ? 1 : Number.isInteger(n) ? 0 : 2,
      notation: compact && Math.abs(n) >= 10000 ? "compact" : "standard",
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString()}`;
  }
}

export function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let mult = 1;
  const km = /([kKmM])\s*$/.exec(s);
  if (km) {
    mult = km[1].toLowerCase() === "k" ? 1000 : 1_000_000;
    s = s.slice(0, km.index);
  }
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = parseFloat(s) * mult;
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

export function wordCount(text: string): number {
  const stripped = text
    .replace(/^---[\s\S]*?---/, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, " ")
    .replace(/[#>*_`~[\]()]+/g, " ")
    .replace(/\s-+\s/g, " ")
    .trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).filter(Boolean).length;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
