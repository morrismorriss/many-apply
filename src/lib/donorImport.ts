// Import donors and gifts from a CSV: exports from PayPal, Stripe, Givebutter, Venmo, a mailing
// list or a spreadsheet. Each row is a person, a gift, or both. Rows for the same person (same
// email, or same name when there's no email) are merged, and so are people already in donors/.
// Existing details are never overwritten: only empty fields get filled in.
import { isAmbiguousDate, parseDate, type DateOrder } from "./extract";
import { stringifyFrontmatter } from "./frontmatter";
import type { VaultFS } from "./fs/types";
import { blankDonor, writeDonor, DONOR_STAGES, type Donor, type DonorStage, type Gift } from "./donors";
import { parseNumber, slugify, todayISO } from "./util";
import { ME } from "./model";
import { trash } from "./vault";

export interface DonorField {
  key: string;
  label: string;
  hint: string;
}

export const DONOR_FIELDS: DonorField[] = [
  { key: "name", label: "Full name", hint: "Jamie Rivera" },
  { key: "first_name", label: "First name", hint: "Joined with last name" },
  { key: "last_name", label: "Last name", hint: "Joined with first name" },
  { key: "email", label: "Email", hint: "Used to match people" },
  { key: "phone", label: "Phone", hint: "" },
  { key: "address", label: "Address", hint: "Several columns are joined: street, city, state, zip" },
  { key: "organization", label: "Organization", hint: "Employer or company" },
  { key: "stage", label: "Stage", hint: "prospect, first-time, active, major, lapsed" },
  { key: "client", label: "Gave to (client)", hint: "A client's name; other rows use the client you import to" },
  { key: "tags", label: "Tags", hint: "Comma- or semicolon-separated" },
  { key: "notes", label: "Notes", hint: "Added to the donor's notes" },
  { key: "gift_date", label: "Gift date", hint: "Any common date format" },
  { key: "gift_amount", label: "Gift amount", hint: "$ and commas are fine" },
  { key: "gift_method", label: "Gift method", hint: "check, card, PayPal…" },
  { key: "gift_note", label: "Gift note", hint: "Campaign, fund, memo" },
  { key: "acknowledged", label: "Thanked?", hint: "yes / no, or a date" },
];

export const DONOR_SKIP = "";

const GUESSES: [RegExp, string][] = [
  [/^(full name|name|donor|donor name|contact|contact name|supporter|display name|from|payer name|customer name)$/, "name"],
  [/^(first|first name|firstname|given name|fname)$/, "first_name"],
  [/^(last|last name|lastname|surname|family name|lname)$/, "last_name"],
  [/^(e-?mail|e-?mail address|donor email|from email address|customer email|payer email)$/, "email"],
  [/^(phone|phone number|mobile|cell|telephone)$/, "phone"],
  [/^(address|street|street address|address 1|address line 1|address 2|address line 2|city|town|state|province|region|zip|zip code|postal code|postcode|country|mailing address)$/, "address"],
  [/^(organi[sz]ation|company|employer|business|business name)$/, "organization"],
  [/^(stage|donor stage|donor type|level)$/, "stage"],
  [/^(client|gave to|recipient|beneficiary|organi[sz]ation supported|for)$/, "client"],
  [/^(tags?|labels?|groups?|segments?|lists?)$/, "tags"],
  [/^(notes?|comments?|donor notes?)$/, "notes"],
  [/^(date|gift date|donation date|transaction date|payment date|created|created at|created date|date received|received)$/, "gift_date"],
  [/^(amount|gift|gift amount|donation|donation amount|gross|total|net|amount paid|payment amount)$/, "gift_amount"],
  [/^(method|payment method|gift method|payment type|type|source|platform)$/, "gift_method"],
  [/^(memo|gift note|campaign|fund|designation|purpose|note to seller|message|item title|description)$/, "gift_note"],
  [/^(acknowledged|thanked|thank you sent|thank-you sent|receipt sent|acknowledgement|ack)$/, "acknowledged"],
];

export function guessDonorField(header: string): string {
  const h = header.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
  if (DONOR_FIELDS.some((f) => f.key === header.trim().toLowerCase())) return header.trim().toLowerCase();
  for (const [re, f] of GUESSES) if (re.test(h)) return f;
  return DONOR_SKIP;
}

/** Map each header to a field. When two headers look like the same single-value field, only the first gets it. */
export function autoDonorMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const h of headers) {
    const f = guessDonorField(h);
    if (f && f !== "address" && used.has(f)) out[h] = DONOR_SKIP;
    else out[h] = f;
    if (f) used.add(f);
  }
  return out;
}

export interface DonorImportOptions {
  mapping: Record<string, string>;
  dateOrder: DateOrder;
  /** Who these donors gave to: "me" or a client's slug. A "Gave to" column overrides it row by row. */
  client?: string;
  /** Clients a "Gave to" column can name, matched by name or slug. */
  clients?: { slug: string; name: string }[];
}

export interface DonorPlanEntry {
  donor: Donor;
  isNew: boolean;
  giftsAdded: number;
}

export interface DonorPlan {
  entries: DonorPlanEntry[];
  created: number;
  updated: number;
  gifts: number;
  /** Total of the gifts being added. */
  giftTotal: number;
  duplicateGifts: number;
  /** Rows with no name and no email. */
  skippedRows: number;
  /** Rows whose date or amount couldn't be read. */
  badRows: number[];
}

const truthy = (v: string) => /^(y|yes|true|1|x|✓|thanked|sent|done)$/i.test(v.trim()) || !!parseDate(v);

function cells(row: Record<string, string>, mapping: Record<string, string>, key: string): string[] {
  return Object.entries(mapping)
    .filter(([, f]) => f === key)
    .map(([h]) => (row[h] ?? "").trim())
    .filter(Boolean);
}

// A person is matched within one client: someone who gives to two clients has a donor file for each.
const keyFor = (client: string, email: string, name: string) =>
  `${client}|` + (email ? `e:${email.toLowerCase()}` : `n:${name.trim().toLowerCase().replace(/\s+/g, " ")}`);

/** Whether any mapped date column holds a date like 3/4/2026 that reads differently day-first. */
export function donorDatesAmbiguous(rows: Record<string, string>[], mapping: Record<string, string>): boolean {
  return rows.some((r) => cells(r, mapping, "gift_date").some(isAmbiguousDate));
}

/** Work out what an import would do, without writing anything. */
export function planDonorImport(existing: Donor[], rows: Record<string, string>[], opts: DonorImportOptions): DonorPlan {
  const { mapping, dateOrder } = opts;
  const target = opts.client || ME;
  const norm = (x: string) => x.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const clientFor = (raw: string) => {
    if (!raw.trim()) return target;
    const c = (opts.clients ?? []).find((c) => norm(c.name) === norm(raw) || c.slug === raw.trim().toLowerCase());
    return c ? c.slug : target;
  };
  const byKey = new Map<string, DonorPlanEntry>();
  const taken = new Set(existing.map((d) => d.slug));
  for (const d of existing) {
    const entry = { donor: structuredClone(d), isNew: false, giftsAdded: 0 };
    if (d.fm.email) byKey.set(keyFor(d.fm.client, d.fm.email, ""), entry);
    if (!byKey.has(keyFor(d.fm.client, "", d.fm.name))) byKey.set(keyFor(d.fm.client, "", d.fm.name), entry);
  }
  const touched = new Set<DonorPlanEntry>();
  let duplicateGifts = 0;
  let giftTotal = 0;
  let skippedRows = 0;
  const badRows: number[] = [];
  const notesAdded = new Map<DonorPlanEntry, string[]>();

  rows.forEach((row, i) => {
    const one = (k: string) => cells(row, mapping, k)[0] ?? "";
    const email = one("email");
    const name = one("name") || [one("first_name"), one("last_name")].filter(Boolean).join(" ") || "";
    if (!name && !email) {
      skippedRows++;
      return;
    }
    const client = clientFor(one("client"));
    let entry = (email && byKey.get(keyFor(client, email, ""))) || (name && byKey.get(keyFor(client, "", name))) || undefined;
    if (!entry) {
      const base = slugify(name || email.split("@")[0]) || "donor";
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      taken.add(slug);
      const d = blankDonor(slug, name || email, client);
      d.fm.created = todayISO();
      entry = { donor: d, isNew: true, giftsAdded: 0 };
    }
    if (email) byKey.set(keyFor(client, email, ""), entry);
    if (name && !byKey.has(keyFor(client, "", name))) byKey.set(keyFor(client, "", name), entry);
    touched.add(entry);
    const fm = entry.donor.fm;

    // Fill in empty details only.
    if (name && (fm.name === fm.email || !fm.name)) fm.name = name;
    if (email && !fm.email) fm.email = email;
    const phone = one("phone");
    if (phone && !fm.phone) fm.phone = phone;
    const address = cells(row, mapping, "address").join(", ");
    if (address && !fm.address) fm.address = address;
    const org = one("organization");
    if (org && !fm.organization) fm.organization = org;
    const stage = one("stage").toLowerCase().replace(/\s+/g, "-");
    const knownStage = DONOR_STAGES.find((s) => s === stage || (s === "first-time" && /^first/.test(stage)));
    if (knownStage && (entry.isNew || fm.stage === "prospect")) fm.stage = knownStage as DonorStage;
    const tags = cells(row, mapping, "tags").flatMap((t) => t.split(/[,;]/)).map((t) => t.trim()).filter(Boolean);
    for (const t of tags) if (!fm.tags.includes(t)) fm.tags.push(t);
    const note = cells(row, mapping, "notes").join("\n");
    if (note && !entry.donor.body.includes(note)) {
      const list = notesAdded.get(entry) ?? [];
      if (!list.includes(note)) list.push(note);
      notesAdded.set(entry, list);
    }

    // The gift, if the row has one.
    const rawAmount = one("gift_amount");
    const rawDate = one("gift_date");
    if (rawAmount || rawDate) {
      const amount = parseNumber(rawAmount.replace(/[()]/g, ""));
      const date = rawDate ? parseDate(rawDate, dateOrder) : todayISO();
      if (amount === null || !date) {
        badRows.push(i + 2);
        return;
      }
      if (amount <= 0) return;
      const ack = one("acknowledged");
      const gift: Gift = { date, amount, method: one("gift_method"), note: one("gift_note"), acknowledged: ack ? truthy(ack) : false };
      if (fm.gifts.some((g) => g.date === gift.date && g.amount === gift.amount)) {
        duplicateGifts++;
        return;
      }
      fm.gifts.push(gift);
      entry.giftsAdded++;
      giftTotal += amount;
    }
  });

  const entries = [...touched];
  for (const e of entries) {
    const fm = e.donor.fm;
    fm.gifts.sort((a, b) => b.date.localeCompare(a.date));
    if (fm.stage === "prospect" && fm.gifts.length) fm.stage = fm.gifts.length === 1 ? "first-time" : "active";
    const notes = notesAdded.get(e);
    if (notes?.length) e.donor.body = [e.donor.body.trimEnd(), ...notes].filter(Boolean).join("\n\n") + "\n";
  }
  // Leave untouched existing donors out: nothing changes for them.
  const changed = entries.filter((e) => e.isNew || e.giftsAdded > 0 || differs(e.donor, existing.find((d) => d.slug === e.donor.slug)));
  return {
    entries: changed,
    created: changed.filter((e) => e.isNew).length,
    updated: changed.filter((e) => !e.isNew).length,
    gifts: changed.reduce((n, e) => n + e.giftsAdded, 0),
    giftTotal,
    duplicateGifts,
    skippedRows,
    badRows,
  };
}

function differs(a: Donor, b: Donor | undefined): boolean {
  return !b || stringifyFrontmatter(a.fm, a.body) !== stringifyFrontmatter(b.fm, b.body);
}

export interface DonorImportResult {
  created: string[];
  /** Each updated donor's file as it was, so the import can be undone. */
  originals: Record<string, string>;
}

export async function applyDonorImport(fs: VaultFS, plan: DonorPlan): Promise<DonorImportResult> {
  const out: DonorImportResult = { created: [], originals: {} };
  for (const e of plan.entries) {
    const p = `donors/${e.donor.slug}.md`;
    if (e.isNew) {
      // Someone may have added a donor with this name since the plan was made.
      if (await fs.exists(p)) continue;
      out.created.push(e.donor.slug);
    } else if (await fs.exists(p)) out.originals[e.donor.slug] = await fs.readText(p);
    await writeDonor(fs, e.donor);
  }
  return out;
}

export async function undoDonorImport(fs: VaultFS, r: DonorImportResult) {
  for (const slug of r.created) if (await fs.exists(`donors/${slug}.md`)) await trash(fs, `donors/${slug}.md`);
  for (const [slug, text] of Object.entries(r.originals)) await fs.writeText(`donors/${slug}.md`, text);
}
