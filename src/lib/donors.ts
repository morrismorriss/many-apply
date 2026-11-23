// Individual giving: a small donor CRM. One markdown file per person in donors/,
// with gifts and touchpoints kept in frontmatter so the files stay readable by hand.
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import { basename, type VaultFS } from "./fs/types";
import { asArray, parseNumber, slugify, str, todayISO } from "./util";
import { ME } from "./model";

export const DONOR_STAGES = ["prospect", "first-time", "active", "major", "lapsed"] as const;
export type DonorStage = (typeof DONOR_STAGES)[number];
export const DONOR_STAGE_LABEL: Record<DonorStage, string> = {
  prospect: "Prospect",
  "first-time": "First-time",
  active: "Active",
  major: "Major",
  lapsed: "Lapsed",
};

export const TOUCH_KINDS = ["email", "call", "meeting", "letter", "event", "thank-you", "other"] as const;

export interface Gift {
  date: string;
  amount: number;
  method: string;
  note: string;
  acknowledged: boolean;
}

export interface Touch {
  date: string;
  kind: string;
  note: string;
}

export interface Donor {
  slug: string;
  fm: {
    name: string;
    email: string;
    phone: string;
    address: string;
    organization: string;
    /** Who they gave to: "me" or a client's slug. */
    client: string;
    stage: DonorStage;
    tags: string[];
    next_followup: string;
    next_step: string;
    gifts: Gift[];
    touches: Touch[];
    created: string;
    [extra: string]: unknown;
  };
  body: string;
}

const DONOR_ORDER = [
  "name", "email", "phone", "address", "organization", "client", "stage", "tags", "next_followup", "next_step", "gifts", "touches", "created",
];

function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return str(v).trim();
}

export function blankDonor(slug: string, name: string, client: string = ME): Donor {
  return {
    slug,
    fm: {
      name,
      email: "",
      phone: "",
      address: "",
      organization: "",
      client: client || ME,
      stage: "prospect",
      tags: [],
      next_followup: "",
      next_step: "",
      gifts: [],
      touches: [],
      created: todayISO(),
    },
    body: "",
  };
}

export function normalizeDonor(slug: string, data: Record<string, unknown>, body: string): Donor {
  const base = blankDonor(slug, str(data.name) || slug);
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);
  const stage = DONOR_STAGES.includes(data.stage as DonorStage) ? (data.stage as DonorStage) : "prospect";
  return {
    slug,
    fm: {
      ...base.fm,
      ...data,
      name: base.fm.name,
      email: str(data.email),
      phone: str(data.phone),
      address: str(data.address),
      organization: str(data.organization),
      client: str(data.client).trim() || ME,
      stage,
      tags: asArray(data.tags),
      next_followup: dateStr(data.next_followup),
      next_step: str(data.next_step),
      gifts: list(data.gifts)
        .map((g) => ({
          date: dateStr(g.date),
          amount: parseNumber(g.amount) ?? 0,
          method: str(g.method),
          note: str(g.note),
          acknowledged: g.acknowledged === true || g.acknowledged === "true",
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
      touches: list(data.touches)
        .map((t) => ({ date: dateStr(t.date), kind: str(t.kind) || "other", note: str(t.note) }))
        .sort((a, b) => b.date.localeCompare(a.date)),
      created: dateStr(data.created) || todayISO(),
    },
    body,
  };
}

export async function readDonor(fs: VaultFS, p: string): Promise<Donor> {
  const { data, body } = parseFrontmatter(await fs.readText(p));
  return normalizeDonor(basename(p).replace(/\.md$/, ""), data, body);
}

export async function writeDonor(fs: VaultFS, d: Donor) {
  await fs.mkdir("donors");
  await fs.writeText(`donors/${d.slug}.md`, stringifyFrontmatter(d.fm, d.body, DONOR_ORDER));
}

export async function createDonor(fs: VaultFS, name: string, client: string = ME): Promise<string> {
  const base = slugify(name) || "donor";
  let slug = base;
  for (let i = 2; await fs.exists(`donors/${slug}.md`); i++) slug = `${base}-${i}`;
  await writeDonor(fs, blankDonor(slug, name.trim(), client));
  return slug;
}

// ------------------------------------------------------------------ stats

export interface DonorSummary {
  lifetime: number;
  thisYear: number;
  lastGift: Gift | undefined;
  largest: number;
  unthanked: number;
  lastTouch: string;
}

export function summarize(d: Donor, year = new Date().getFullYear()): DonorSummary {
  const y = String(year);
  const gifts = d.fm.gifts;
  return {
    lifetime: gifts.reduce((s, g) => s + g.amount, 0),
    thisYear: gifts.filter((g) => g.date.startsWith(y)).reduce((s, g) => s + g.amount, 0),
    lastGift: gifts[0],
    largest: gifts.reduce((m, g) => Math.max(m, g.amount), 0),
    unthanked: gifts.filter((g) => !g.acknowledged).length,
    lastTouch: [d.fm.touches[0]?.date ?? "", gifts[0]?.date ?? ""].sort().pop() ?? "",
  };
}

/** Donors who gave to this client ("" for everyone). */
export function donorsFor(donors: Donor[], client: string): Donor[] {
  return client ? donors.filter((d) => d.fm.client === client) : donors;
}

/** A donor who gave before but not in the last 18 months. Suggested, never set automatically. */
export function looksLapsed(d: Donor, today = todayISO()): boolean {
  const last = d.fm.gifts[0]?.date;
  if (!last) return false;
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - 18);
  return last < cutoff.toISOString().slice(0, 10);
}
