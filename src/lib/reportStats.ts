// Numbers for the Year in review, Document readiness and Individual giving reports.
import type { Client, Grant } from "./model";
import { grantYear } from "./stats";
import { documentOwner, expiryState, type VaultDocument } from "./documents";
import { giftsFor, looksLapsed, type Donor } from "./donors";
import { fmtMinutes, fmtMoney, todayISO } from "./util";

const yearOf = (iso: string) => (/^\d{4}/.test(iso) ? Number(iso.slice(0, 4)) : null);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- Year in review

export interface YearReview {
  year: number;
  submitted: number;
  requested: number;
  awarded: number;
  awardedTotal: number;
  declined: number;
  /** Awarded / (awarded + declined) for decisions made this year. Null with no decisions. */
  winRate: number | null;
  pending: number;
  newFunders: string[];
  topFunders: { slug: string; amount: number }[];
  minutes: number;
  /** Individual gifts in the year (to `client` when one is given). */
  gifts: { count: number; total: number; donors: number };
  reportsDue: number;
}

const sentYear = (g: Grant) => yearOf(g.fm.submitted_on) ?? (["submitted", "awarded", "declined"].includes(g.fm.status) ? grantYear(g) : null);
const decidedYear = (g: Grant) => yearOf(g.fm.decision_on) ?? sentYear(g);

export function yearReview(grants: Grant[], donors: Donor[], year: number, client = ""): YearReview {
  const sent = grants.filter((g) => sentYear(g) === year);
  const decided = grants.filter((g) => ["awarded", "declined"].includes(g.fm.status) && decidedYear(g) === year);
  const won = decided.filter((g) => g.fm.status === "awarded");
  const lost = decided.filter((g) => g.fm.status === "declined");
  const earlierFunders = new Set(grants.filter((g) => (sentYear(g) ?? 9999) < year).map((g) => g.fm.funder));
  const byFunder = new Map<string, number>();
  for (const g of won) byFunder.set(g.fm.funder, (byFunder.get(g.fm.funder) ?? 0) + (g.fm.amount_awarded ?? 0));
  const gifts = donors.flatMap((d) => giftsFor(d, client).filter((x) => yearOf(x.date) === year).map((x) => ({ d: d.slug, amount: x.amount })));
  return {
    year,
    submitted: sent.length,
    requested: sum(sent.map((g) => g.fm.amount_requested ?? 0)),
    awarded: won.length,
    awardedTotal: sum(won.map((g) => g.fm.amount_awarded ?? 0)),
    declined: lost.length,
    winRate: decided.length ? won.length / decided.length : null,
    pending: sent.filter((g) => g.fm.status === "submitted").length,
    newFunders: [...new Set(sent.map((g) => g.fm.funder).filter((f) => f && !earlierFunders.has(f)))],
    topFunders: [...byFunder].map(([slug, amount]) => ({ slug, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5),
    minutes: sum(grants.flatMap((g) => g.fm.time_log.filter((t) => yearOf(t.date) === year).map((t) => t.minutes))),
    gifts: { count: gifts.length, total: sum(gifts.map((g) => g.amount)), donors: new Set(gifts.map((g) => g.d)).size },
    reportsDue: grants.flatMap((g) => g.fm.reports.filter((r) => yearOf(r.due) === year)).length,
  };
}

export function yearReviewText(r: YearReview, who: string, funderName: (slug: string) => string, currency = "USD"): string {
  const m = (n: number) => fmtMoney(n, currency);
  const lines = [
    `${who}: ${r.year} in review`,
    "",
    `Applications sent: ${r.submitted}${r.requested ? ` (${m(r.requested)} requested)` : ""}`,
    `Awarded: ${r.awarded}${r.awardedTotal ? ` (${m(r.awardedTotal)})` : ""}`,
    `Declined: ${r.declined}`,
    `Win rate: ${r.winRate === null ? "no decisions yet" : `${Math.round(r.winRate * 100)}%`}`,
    `Still waiting to hear: ${r.pending}`,
  ];
  if (r.newFunders.length) lines.push(`New funders: ${r.newFunders.map(funderName).join(", ")}`);
  if (r.topFunders.length) lines.push(`Top funders: ${r.topFunders.map((f) => `${funderName(f.slug)} (${m(f.amount)})`).join(", ")}`);
  if (r.minutes) lines.push(`Time logged: ${fmtMinutes(r.minutes)}`);
  if (r.gifts.count) lines.push(`Individual gifts: ${m(r.gifts.total)} from ${r.gifts.donors} donor${r.gifts.donors === 1 ? "" : "s"}`);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------- Document readiness

/** The paperwork funders ask for most. A column is satisfied by any of its types. */
export const READINESS_COLUMNS: { label: string; types: string[]; orgOnly?: boolean }[] = [
  { label: "W-9", types: ["W-9"] },
  { label: "501(c)(3) or fiscal sponsor", types: ["501(c)(3) letter", "Fiscal sponsor agreement"] },
  { label: "Insurance", types: ["Insurance certificate"], orgOnly: true },
  { label: "Financials", types: ["Financial statement", "Tax return"] },
  { label: "Board list", types: ["Board list"], orgOnly: true },
  { label: "Bylaws", types: ["Bylaws"], orgOnly: true },
];

export type ReadinessState = "ok" | "soon" | "expired" | "missing";

export interface ReadinessCell {
  state: ReadinessState;
  /** The best document found, for opening it. */
  doc?: VaultDocument;
}

export interface ReadinessRow {
  client: string;
  cells: ReadinessCell[];
  ready: number;
}

const RANK: Record<ReadinessState, number> = { ok: 3, soon: 2, expired: 1, missing: 0 };

export function documentReadiness(clients: Client[], documents: VaultDocument[], today = new Date()): ReadinessRow[] {
  return clients.map((c) => {
    const mine = documents.filter((d) => documentOwner(d) === c.slug);
    const cells = READINESS_COLUMNS.map((col) => {
      let best: ReadinessCell = { state: "missing" };
      for (const d of mine.filter((d) => col.types.includes(d.fm.type))) {
        const e = expiryState(d, today);
        const state: ReadinessState = e === "expired" ? "expired" : e === "soon" ? "soon" : "ok";
        if (RANK[state] > RANK[best.state]) best = { state, doc: d };
      }
      return best;
    });
    return { client: c.slug, cells, ready: cells.filter((x) => x.state === "ok" || x.state === "soon").length };
  });
}

/** Documents that need attention: expired, or expiring within 60 days. Soonest first. */
export function expiringDocuments(documents: VaultDocument[], clients: string[], today = new Date()): VaultDocument[] {
  return documents
    .filter((d) => clients.includes(documentOwner(d)) && ["expired", "soon"].includes(expiryState(d, today, 60)))
    .sort((a, b) => a.fm.expires.localeCompare(b.fm.expires));
}

// ---------------------------------------------------------------- Individual giving

export interface GivingReport {
  year: number;
  byYear: { year: number; total: number; donors: number }[];
  total: number;
  gifts: number;
  donors: number;
  newDonors: number;
  returningDonors: number;
  /** Share of last year's donors who gave again this year. Null if nobody gave last year. */
  retention: number | null;
  averageGift: number | null;
  largestGift: number;
  topDonors: { slug: string; name: string; total: number }[];
  byMethod: { method: string; total: number; count: number }[];
  unthanked: { count: number; total: number };
  lapsed: number;
}

export function givingReport(donors: Donor[], year: number, today = todayISO(), client = ""): GivingReport {
  const giftsIn = (d: Donor, y: number) => giftsFor(d, client).filter((g) => yearOf(g.date) === y);
  const gaveIn = (y: number) => new Set(donors.filter((d) => giftsIn(d, y).length).map((d) => d.slug));
  const now = gaveIn(year);
  const before = gaveIn(year - 1);
  const firstYear = (d: Donor) => Math.min(...giftsFor(d, client).map((g) => yearOf(g.date) ?? 9999));
  const thisYear = donors.flatMap((d) => giftsIn(d, year).map((g) => ({ ...g, d })));
  const methods = new Map<string, { total: number; count: number }>();
  for (const g of thisYear) {
    const k = g.method.trim() || "Not recorded";
    const m = methods.get(k) ?? { total: 0, count: 0 };
    methods.set(k, { total: m.total + g.amount, count: m.count + 1 });
  }
  const total = sum(thisYear.map((g) => g.amount));
  const years = Array.from({ length: 5 }, (_, i) => year - 4 + i);
  const unthanked = donors.flatMap((d) => giftsFor(d, client).filter((g) => !g.acknowledged));
  return {
    year,
    byYear: years.map((y) => ({ year: y, total: sum(donors.flatMap((d) => giftsIn(d, y).map((g) => g.amount))), donors: gaveIn(y).size })),
    total,
    gifts: thisYear.length,
    donors: now.size,
    newDonors: donors.filter((d) => now.has(d.slug) && firstYear(d) === year).length,
    returningDonors: donors.filter((d) => now.has(d.slug) && firstYear(d) < year).length,
    retention: before.size ? [...before].filter((s) => now.has(s)).length / before.size : null,
    averageGift: thisYear.length ? total / thisYear.length : null,
    largestGift: Math.max(0, ...thisYear.map((g) => g.amount)),
    topDonors: donors
      .map((d) => ({ slug: d.slug, name: d.fm.name, total: sum(giftsIn(d, year).map((g) => g.amount)) }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
    byMethod: [...methods].map(([method, m]) => ({ method, ...m })).sort((a, b) => b.total - a.total),
    unthanked: { count: unthanked.length, total: sum(unthanked.map((g) => g.amount)) },
    lapsed: donors.filter((d) => d.fm.stage !== "lapsed" && looksLapsed(d, today)).length,
  };
}
