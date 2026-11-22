import { ACTIVE_STATUSES, DONE_STATUSES, type Funder, type Grant, type Status } from "./model";
import { daysBetween, fromISO, toISO } from "./util";

export function winRate(grants: Grant[]): number | null {
  const awarded = grants.filter((g) => g.fm.status === "awarded").length;
  const declined = grants.filter((g) => g.fm.status === "declined").length;
  return awarded + declined ? awarded / (awarded + declined) : null;
}

function yearOf(iso: string): number | null {
  const d = fromISO(iso);
  return d ? d.getFullYear() : null;
}

/** The year a grant "belongs to" for requested totals: submitted date, else deadline, else created. */
export function grantYear(g: Grant): number | null {
  return yearOf(g.fm.submitted_on) ?? yearOf(g.fm.deadline) ?? yearOf(g.fm.created);
}

export function dashboardNumbers(grants: Grant[], today = new Date()) {
  const y = today.getFullYear();
  const t = toISO(today);
  const in30 = toISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30));
  const requested = grants
    .filter((g) => ["submitted", "awarded", "declined"].includes(g.fm.status) && grantYear(g) === y)
    .reduce((s, g) => s + (g.fm.amount_requested ?? 0), 0);
  const awarded = grants
    .filter((g) => g.fm.status === "awarded" && (yearOf(g.fm.decision_on) ?? grantYear(g)) === y)
    .reduce((s, g) => s + (g.fm.amount_awarded ?? 0), 0);
  return {
    active: grants.filter((g) => ACTIVE_STATUSES.includes(g.fm.status)).length,
    deadlines30: grants.filter(
      (g) => g.fm.deadline >= t && g.fm.deadline <= in30 && !DONE_STATUSES.includes(g.fm.status),
    ).length,
    requested,
    awarded,
    winRate: winRate(grants),
  };
}

export interface Attention {
  kind: "due" | "stale" | "decision" | "report" | "noreports";
  grant: Grant;
  text: string;
  reportIndex?: number;
  days?: number;
}

export function needsAttention(grants: Grant[], today = new Date()): Attention[] {
  const out: Attention[] = [];
  const now = today.getTime();
  for (const g of grants) {
    const f = g.fm;
    const dd = f.deadline ? daysBetween(today, fromISO(f.deadline)!) : null;
    if (dd !== null && dd >= 0 && dd <= 14 && !DONE_STATUSES.includes(f.status) && f.deadline_type !== "rolling") {
      out.push({ kind: "due", grant: g, days: dd, text: dd === 0 ? "Due today, not submitted" : `Due in ${dd} day${dd === 1 ? "" : "s"}, not submitted` });
    }
    if (f.status === "drafting" && g.lastEdited && now - g.lastEdited > 7 * 86400000) {
      const d = Math.floor((now - g.lastEdited) / 86400000);
      out.push({ kind: "stale", grant: g, days: d, text: `Drafting, no edits in ${d} days` });
    }
    if (f.status === "submitted" && f.decision_expected && !f.decision_on) {
      const d = daysBetween(fromISO(f.decision_expected)!, today);
      if (d > 0) out.push({ kind: "decision", grant: g, days: d, text: `Decision expected ${d} day${d === 1 ? "" : "s"} ago, no result logged` });
    }
    f.reports.forEach((r, i) => {
      if (r.submitted_on || !r.due) return;
      const d = daysBetween(today, fromISO(r.due) ?? today);
      if (d <= 30) out.push({ kind: "report", grant: g, reportIndex: i, days: d, text: d < 0 ? `${r.title} overdue by ${-d} days` : `${r.title} due in ${d} days` });
    });
    if (f.status === "awarded" && f.reports.length === 0) {
      out.push({ kind: "noreports", grant: g, text: "Got your reporting dates? Add them here." });
    }
  }
  const order: Attention["kind"][] = ["due", "report", "decision", "stale", "noreports"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.days ?? 0) - (b.days ?? 0));
}

export function statusCounts(grants: Grant[]): Record<Status, number> {
  const c = { researching: 0, planning: 0, drafting: 0, submitted: 0, awarded: 0, declined: 0, withdrawn: 0 };
  for (const g of grants) c[g.fm.status]++;
  return c;
}

// ------------------------------------------------------------------ calendar

export interface CalEvent {
  date: string;
  kind: "deadline" | "submitted" | "decision" | "report";
  title: string;
  grant: Grant;
  reportIndex?: number;
  done?: boolean;
}

export function calendarEvents(grants: Grant[]): CalEvent[] {
  const out: CalEvent[] = [];
  for (const g of grants) {
    const f = g.fm;
    if (f.deadline) out.push({ date: f.deadline, kind: "deadline", title: `${f.deadline_type === "loi" ? "LOI due" : "Deadline"}: ${f.title}`, grant: g, done: DONE_STATUSES.includes(f.status) });
    if (f.submitted_on) out.push({ date: f.submitted_on, kind: "submitted", title: `Submitted: ${f.title}`, grant: g, done: true });
    if (f.decision_expected && !f.decision_on && f.status === "submitted")
      out.push({ date: f.decision_expected, kind: "decision", title: `Decision expected: ${f.title}`, grant: g });
    f.reports.forEach((r, i) => {
      if (r.due) out.push({ date: r.due, kind: "report", title: `${r.title}: ${f.title}`, grant: g, reportIndex: i, done: !!r.submitted_on });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function fold(line: string) {
  const out: string[] = [];
  let s = line;
  while (s.length > 74) {
    out.push(s.slice(0, 74));
    s = " " + s.slice(74);
  }
  out.push(s);
  return out.join("\r\n");
}

export function toICS(events: CalEvent[], name = "Many Apply"): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Many Apply//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEscape(name)}`,
  ];
  for (const e of events) {
    const d = e.date.replace(/-/g, "");
    const next = fromISO(e.date)!;
    next.setDate(next.getDate() + 1);
    const uidPart = `${e.grant.folder}-${e.kind}${e.reportIndex !== undefined ? "-" + e.reportIndex : ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uidPart}@manyapply`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${toISO(next).replace(/-/g, "")}`,
      fold(`SUMMARY:${icsEscape(e.title)}`),
      `CATEGORIES:${e.kind}`,
    );
    if (e.grant.fm.url) lines.push(fold(`URL:${e.grant.fm.url}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ------------------------------------------------------------------ reports

export interface ReportFilters {
  year: string;
  tag: string;
  project: string;
  client: string;
}

export function filterForReports(grants: Grant[], f: ReportFilters): Grant[] {
  return grants.filter(
    (g) =>
      (!f.year || String(grantYear(g)) === f.year) &&
      (!f.tag || g.fm.tags.includes(f.tag)) &&
      (!f.project || g.fm.project === f.project) &&
      (!f.client || g.fm.client === f.client),
  );
}

export function requestedVsAwardedByYear(grants: Grant[]) {
  const years = new Map<number, { requested: number; awarded: number }>();
  for (const g of grants) {
    if (!["submitted", "awarded", "declined"].includes(g.fm.status)) continue;
    const y = grantYear(g);
    if (!y) continue;
    const row = years.get(y) ?? { requested: 0, awarded: 0 };
    row.requested += g.fm.amount_requested ?? 0;
    if (g.fm.status === "awarded") row.awarded += g.fm.amount_awarded ?? 0;
    years.set(y, row);
  }
  return [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, ...v }));
}

export function winRateBy(grants: Grant[], key: (g: Grant) => string) {
  const m = new Map<string, { awarded: number; decided: number }>();
  for (const g of grants) {
    if (g.fm.status !== "awarded" && g.fm.status !== "declined") continue;
    const k = key(g) || "Unknown";
    const row = m.get(k) ?? { awarded: 0, decided: 0 };
    row.decided++;
    if (g.fm.status === "awarded") row.awarded++;
    m.set(k, row);
  }
  return [...m.entries()].map(([label, v]) => ({ label, ...v, rate: v.awarded / v.decided })).sort((a, b) => b.decided - a.decided);
}

export function fundingByFunder(grants: Grant[], funderName: (slug: string) => string) {
  const m = new Map<string, number>();
  for (const g of grants) {
    if (g.fm.status !== "awarded") continue;
    const k = funderName(g.fm.funder) || "Unknown";
    m.set(k, (m.get(k) ?? 0) + (g.fm.amount_awarded ?? 0));
  }
  return [...m.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
}

/** Count of deadlines per year × month. */
export function deadlineHeatmap(grants: Grant[]) {
  const m = new Map<number, number[]>();
  for (const g of grants) {
    const d = fromISO(g.fm.deadline);
    if (!d) continue;
    const row = m.get(d.getFullYear()) ?? new Array(12).fill(0);
    row[d.getMonth()]++;
    m.set(d.getFullYear(), row);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([year, months]) => ({ year, months }));
}

export function turnaround(grants: Grant[]) {
  const days: number[] = [];
  for (const g of grants) {
    const s = fromISO(g.fm.submitted_on) ?? fromISO(g.fm.status_history.find((h) => h.status === "submitted")?.date);
    const d =
      fromISO(g.fm.decision_on) ??
      fromISO([...g.fm.status_history].reverse().find((h) => h.status === "awarded" || h.status === "declined")?.date);
    if (s && d && d >= s) days.push(daysBetween(s, d));
  }
  return { count: days.length, avg: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null };
}

export function funderStats(funder: Funder, grants: Grant[]) {
  const gs = grants.filter((g) => g.fm.funder === funder.slug);
  return {
    grants: gs,
    applied: gs.filter((g) => !["researching", "planning", "drafting"].includes(g.fm.status)).length,
    awarded: gs.filter((g) => g.fm.status === "awarded").reduce((s, g) => s + (g.fm.amount_awarded ?? 0), 0),
    awardedCount: gs.filter((g) => g.fm.status === "awarded").length,
    winRate: winRate(gs),
  };
}
