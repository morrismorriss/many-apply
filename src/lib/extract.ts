// Simple pattern matching for dates and dollar amounts. No AI: just regular expressions.
import { toISO } from "./util";

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function mk(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const dt = new Date(y, m, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
  return toISO(dt);
}

export type DateOrder = "us" | "dayfirst";

/**
 * Parse one date value in any of the accepted formats:
 * 2027-02-01, 2/1/2027, 1/2/2027 (dayfirst), Feb 1 2027, February 1, 2027, 1 February 2027.
 * Returns ISO (YYYY-MM-DD) or null.
 */
export function parseDate(input: string, order: DateOrder = "us", fallbackYear?: number): string | null {
  const s = input.trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/\s+/g, " ");
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return mk(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (order === "us") return mk(y, a - 1, b) ?? mk(y, b - 1, a);
    return mk(y, b - 1, a) ?? mk(y, a - 1, b);
  }
  // Weekday prefixes like "Monday, February 1, 2027"
  const noWeekday = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, "");
  m = new RegExp(`^${MONTH_RE}\\.?\\s+(\\d{1,2}),?\\s*(\\d{4})?$`, "i").exec(noWeekday);
  if (m) {
    const y = m[3] ? +m[3] : fallbackYear;
    return y ? mk(y, MONTHS[m[1].toLowerCase()], +m[2]) : null;
  }
  m = new RegExp(`^(\\d{1,2})\\s+${MONTH_RE}\\.?,?\\s*(\\d{4})?$`, "i").exec(noWeekday);
  if (m) {
    const y = m[3] ? +m[3] : fallbackYear;
    return y ? mk(y, MONTHS[m[2].toLowerCase()], +m[1]) : null;
  }
  // Notion sometimes exports "February 1, 2027 → February 3, 2027" ranges or "February 1, 2027 10:00 AM".
  const head = noWeekday.split(/\s*(?:→|->|–| to )\s*/)[0];
  if (head !== noWeekday) return parseDate(head, order, fallbackYear);
  const timeless = noWeekday.replace(/\s+\d{1,2}:\d{2}.*$/, "");
  if (timeless !== noWeekday) return parseDate(timeless, order, fallbackYear);
  return null;
}

/** True when a d/m vs m/d date could be read either way (both parts ≤ 12 and different). */
export function isAmbiguousDate(input: string): boolean {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(input.trim());
  return !!m && +m[1] <= 12 && +m[2] <= 12 && m[1] !== m[2];
}

export interface FoundDate {
  iso: string;
  text: string;
  context: string;
  label: "deadline" | "decision" | "date";
}

export interface FoundAmount {
  value: number;
  text: string;
  context: string;
  label: "max_award" | "amount";
}

function contextAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + len + 50);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

const DEADLINE_WORDS = /deadline|due|submit|close|apply by|postmark/g;
const DECISION_WORDS = /notif|decision|announce|award(?:ed)? on|results/g;

/** Label a date by whichever keyword sits closest before it. */
function labelFor(before: string): FoundDate["label"] {
  const last = (re: RegExp) => Math.max(-1, ...[...before.matchAll(re)].map((m) => m.index!));
  const d = last(DEADLINE_WORDS);
  const c = last(DECISION_WORDS);
  if (d < 0 && c < 0) return "date";
  return d > c ? "deadline" : "decision";
}

/** Find dates in free text, labelled by nearby words. */
export function findDates(text: string, today = new Date()): FoundDate[] {
  const out: FoundDate[] = [];
  const seen = new Set<string>();
  const patterns = [
    new RegExp(`\\b${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?(?:\\s+\\d{4})?\\b`, "gi"),
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?(?:\\s+\\d{4})?\\b`, "gi"),
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      let iso = parseDate(m[0], "us", today.getFullYear());
      if (!iso) continue;
      // A month/day with no year that's already passed most likely means next year.
      if (!/\d{4}/.test(m[0]) && iso < toISO(today)) iso = parseDate(m[0], "us", today.getFullYear() + 1);
      if (!iso || seen.has(iso)) continue;
      seen.add(iso);
      const before = text.slice(Math.max(0, m.index! - 60), m.index!).toLowerCase();
      const label = labelFor(before);
      out.push({ iso, text: m[0], context: contextAround(text, m.index!, m[0].length), label });
    }
  }
  return out.sort((a, b) => (a.label === "deadline" ? -1 : 0) - (b.label === "deadline" ? -1 : 0) || a.iso.localeCompare(b.iso));
}

/** Find dollar amounts: $5,000 · $5k · $1.5 million · 5,000 USD · up to $10,000 */
export function findAmounts(text: string): FoundAmount[] {
  const out: FoundAmount[] = [];
  const seen = new Set<number>();
  const re = /(?:US)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k|K|thousand|m|M|million)?\b|\b(\d{1,3}(?:,\d{3})+|\d{3,})\s*(?:USD|dollars)\b/g;
  for (const m of text.matchAll(re)) {
    const digits = (m[1] ?? m[4]).replace(/,/g, "");
    let value = parseFloat(digits + (m[2] ? "." + m[2] : ""));
    const unit = (m[3] || "").toLowerCase();
    if (unit === "k" || unit === "thousand") value *= 1000;
    if (unit === "m" || unit === "million") value *= 1_000_000;
    if (!isFinite(value) || value <= 0 || seen.has(value)) continue;
    seen.add(value);
    const before = text.slice(Math.max(0, m.index! - 40), m.index!).toLowerCase();
    const label: FoundAmount["label"] = /up to|maximum|max\.?|not to exceed|no more than|awards? of|grants? of/.test(before)
      ? "max_award"
      : "amount";
    out.push({ value, text: m[0].trim(), context: contextAround(text, m.index!, m[0].length), label });
  }
  return out;
}

/** Find the first URL in text. */
export function findUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>"')]+/.exec(text);
  return m ? m[0].replace(/[.,;]+$/, "") : null;
}
