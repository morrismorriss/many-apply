// CV builder: one artist CV per client, kept as cv/<client>.md so it stays readable and editable by hand.
//
//   ---
//   name: Jamie Rivera
//   location: Pittsburgh, PA
//   email: jamie@example.org
//   website: jamierivera.art
//   ---
//
//   ## Education
//   - 2015 | MFA, Playwriting, Carnegie Mellon University
//
//   ## Grants and awards
//   - 2026 | Project Grant, Pittsburgh Foundation
//
// Each "## " heading is a section. Each "- " line is an entry; the part before " | " is the year.
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import type { VaultFS } from "./fs/types";
import type { Grant } from "./model";
import { ME } from "./model";
import type { WorkSample } from "./samples";
import { para, packDocx, inlineRuns, run } from "./reviewExport";
import { asArray, fmtMoney, str } from "./util";

export interface CvEntry {
  year: string;
  text: string;
  /** "grant:<folder>" for an entry Many Apply added from an awarded application. */
  source?: string;
}

export interface CvSection {
  title: string;
  entries: CvEntry[];
}

export interface Cv {
  client: string;
  name: string;
  location: string;
  email: string;
  website: string;
  phone: string;
  sections: CvSection[];
  /** Awarded applications (by folder) the user took off this CV, so they aren't added again. */
  leftOff: string[];
  /** Other frontmatter keys, kept round-trip. */
  extra: Record<string, unknown>;
}

export const CV_SECTIONS = [
  "Education",
  "Grants and awards",
  "Residencies and fellowships",
  "Selected works",
  "Productions and performances",
  "Exhibitions",
  "Publications",
  "Commissions",
  "Freelance grant writing",
  "Teaching",
  "Press",
] as const;

/** The sections a new CV starts with. Empty ones are left out of exports. */
const STARTING_SECTIONS = ["Education", "Grants and awards", "Residencies and fellowships", "Selected works", "Productions and performances", "Exhibitions", "Press"];

export const cvPath = (client: string) => `cv/${client || ME}.md`;

export function blankCv(client: string, name: string): Cv {
  return {
    client,
    name,
    location: "",
    email: "",
    website: "",
    phone: "",
    sections: STARTING_SECTIONS.map((title) => ({ title, entries: [] })),
    leftOff: [],
    extra: {},
  };
}

const YEARISH = /^(\d{4}|\d{4}\s*[-–—]\s*(\d{2,4}|present|now|ongoing)?|present|forthcoming|ongoing|upcoming)$/i;

const SOURCE = /\s*<!--\s*(grant:[^>]*?)\s*-->\s*$/;

export function parseEntry(line: string): CvEntry {
  const src = SOURCE.exec(line);
  const e = parseEntryText(src ? line.slice(0, src.index) : line);
  return src ? { ...e, source: src[1] } : e;
}

function parseEntryText(line: string): CvEntry {
  const t = line.replace(/^\s*[-*•]\s+/, "").trim();
  const bar = t.indexOf(" | ");
  if (bar > 0 && bar <= 24) return { year: t.slice(0, bar).trim(), text: t.slice(bar + 3).trim() };
  const m = /^(\S+(?:\s*[-–—]\s*\S+)?)\s+(.+)$/.exec(t);
  if (m && YEARISH.test(m[1])) return { year: m[1], text: m[2] };
  return { year: "", text: t };
}

export function parseCv(text: string, client: string, fallbackName: string): Cv {
  const { data, body } = parseFrontmatter(text);
  const cv = blankCv(client, str(data.name) || fallbackName);
  cv.sections = [];
  for (const k of ["location", "email", "website", "phone"] as const) cv[k] = str(data[k]);
  cv.leftOff = asArray(data.left_off);
  cv.extra = Object.fromEntries(Object.entries(data).filter(([k]) => !["name", "location", "email", "website", "phone", "left_off"].includes(k)));
  let cur: CvSection | null = null;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const h = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (h) {
      cur = { title: h[1], entries: [] };
      cv.sections.push(cur);
    } else if (/^\s*[-*•]\s+\S/.test(line) && cur) {
      cur.entries.push(parseEntry(line));
    } else if (line.trim() && cur) {
      // A loose line under a heading still counts as an entry, so nothing typed by hand is lost.
      cur.entries.push(parseEntry(line));
    }
  }
  return cv;
}

export function stringifyCv(cv: Cv): string {
  const fm: Record<string, unknown> = { name: cv.name, location: cv.location, email: cv.email, website: cv.website, phone: cv.phone, ...cv.extra };
  if (cv.leftOff.length) fm.left_off = cv.leftOff;
  for (const k of ["location", "email", "website", "phone"]) if (!fm[k]) delete fm[k];
  const body = cv.sections
    .map((s) => [`## ${s.title}`, ...s.entries.filter((e) => e.text.trim() || e.year.trim()).map((e) => `- ${e.year.trim() ? `${e.year.trim()} | ` : ""}${e.text.trim()}${e.source ? ` <!-- ${e.source} -->` : ""}`)].join("\n"))
    .join("\n\n");
  return stringifyFrontmatter(fm, body ? `\n${body}\n` : "", ["name", "location", "email", "website", "phone", "left_off"]);
}

export async function readCv(fs: VaultFS, client: string, fallbackName: string): Promise<Cv> {
  const p = cvPath(client);
  if (!(await fs.exists(p))) return blankCv(client, fallbackName);
  return parseCv(await fs.readText(p), client, fallbackName);
}

export async function writeCv(fs: VaultFS, cv: Cv) {
  await fs.mkdir("cv");
  await fs.writeText(cvPath(cv.client), stringifyCv(cv));
}

/** Newest first; entries with no year go last, in the order they were typed. */
export function sortEntries(entries: CvEntry[]): CvEntry[] {
  const key = (e: CvEntry) => {
    if (/present|now|ongoing|forthcoming|upcoming/i.test(e.year)) return 99999;
    const years = e.year.match(/\d{4}/g);
    return years ? Math.max(...years.map(Number)) : -1;
  };
  return entries.map((e, i) => ({ e, i })).sort((a, b) => key(b.e) - key(a.e) || a.i - b.i).map((x) => x.e);
}

// ---------------------------------------------------------------- filling in from the vault

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function yearOf(g: Grant): string {
  return (g.fm.decision_on || g.fm.submitted_on || g.fm.deadline || g.fm.created).slice(0, 4);
}

export interface CvSuggestion {
  section: string;
  entry: CvEntry;
}

/** Where grants you wrote for clients go on your own CV. */
export const FREELANCE_SECTION = "Freelance grant writing";

/**
 * The CV line for an awarded application, and the section it belongs in. An award you won for a client
 * goes under Freelance grant writing on your own CV, with who it was for and how much it brought in.
 */
export function awardEntry(
  g: Grant,
  funderName: (slug: string) => string,
  clientName: (slug: string) => string = (x) => x,
  /** Whose CV the line is for. A client's own award is an ordinary grant on their CV. */
  cvClient: string = ME,
): CvSuggestion {
  const funder = funderName(g.fm.funder);
  const titleHasFunder = funder && norm(g.fm.title).includes(norm(funder));
  const base = titleHasFunder || !funder ? g.fm.title : `${g.fm.title}, ${funder}`;
  const client = g.fm.client || ME;
  if (client !== ME && (cvClient || ME) === ME) {
    const amount = g.fm.amount_awarded ? ` (${fmtMoney(g.fm.amount_awarded, g.fm.currency)})` : "";
    return { section: FREELANCE_SECTION, entry: { year: yearOf(g), text: `${base}, for ${clientName(client)}${amount}`, source: `grant:${g.folder}` } };
  }
  const section = g.fm.type === "residency" || g.fm.type === "fellowship" ? "Residencies and fellowships" : "Grants and awards";
  return { section, entry: { year: yearOf(g), text: base, source: `grant:${g.folder}` } };
}

/** A client's CV gets their own awards; yours also gets every award you won for a client. */
const awardedFor = (cv: Cv, grants: Grant[]) =>
  grants.filter((g) => g.fm.status === "awarded" && ((cv.client || ME) === ME || (g.fm.client || ME) === (cv.client || ME)));

/**
 * Keep the CV in step with awarded applications: add any that aren't on it (unless they were taken off),
 * and drop ones that are no longer awarded, unless their wording was changed by hand. Entries typed by hand
 * that match an award are linked to it rather than duplicated. Returns the same object when nothing changed.
 */
export function syncAwards(cv: Cv, grants: Grant[], funderName: (slug: string) => string, clientName?: (slug: string) => string): Cv {
  const awarded = awardedFor(cv, grants);
  const byFolder = new Map(grants.map((g) => [g.folder, g]));
  let changed = false;
  const sections = cv.sections.map((s) => ({ ...s, entries: [...s.entries] }));
  const linked = new Set<string>();

  for (const sec of sections) {
    sec.entries = sec.entries.flatMap((e) => {
      if (!e.source) return [e];
      const folder = e.source.slice("grant:".length);
      const g = byFolder.get(folder);
      if (g && g.fm.status === "awarded") {
        linked.add(folder);
        return [e];
      }
      changed = true;
      if (g) {
        // No longer awarded: drop it if it still reads as Many Apply wrote it, else keep it as the user's own.
        return norm(awardEntry(g, funderName, clientName, cv.client).entry.text) === norm(e.text) ? [] : [{ year: e.year, text: e.text }];
      }
      // The application was renamed (its folder follows the deadline and funder) or deleted.
      const renamed = awarded.find((x) => !linked.has(x.folder) && norm(awardEntry(x, funderName, clientName, cv.client).entry.text) === norm(e.text));
      if (renamed) {
        linked.add(renamed.folder);
        return [{ ...e, source: `grant:${renamed.folder}` }];
      }
      return [{ year: e.year, text: e.text }];
    });
  }

  const leftOff = cv.leftOff.filter((f) => awarded.some((g) => g.folder === f));
  if (leftOff.length !== cv.leftOff.length) changed = true;
  const touched = new Set<string>();
  for (const g of awarded) {
    if (linked.has(g.folder) || leftOff.includes(g.folder)) continue;
    const want = awardEntry(g, funderName, clientName, cv.client);
    // A matching line typed by hand (or added before awards were automatic): link it instead of adding another.
    const match = sections.flatMap((s) => s.entries).find((e) => !e.source && (norm(e.text) === norm(want.entry.text) || norm(e.text).startsWith(norm(g.fm.title))));
    if (match) {
      match.source = want.entry.source;
    } else {
      let sec = sections.find((s) => norm(s.title) === norm(want.section));
      if (!sec) {
        sec = { title: want.section, entries: [] };
        sections.push(sec);
      }
      sec.entries.push(want.entry);
      touched.add(norm(want.section));
    }
    changed = true;
  }
  if (!changed) return cv;
  return {
    ...cv,
    leftOff,
    sections: sections.map((s) => (touched.has(norm(s.title)) ? { ...s, entries: sortEntries(s.entries) } : s)),
  };
}

/** Take an entry off the CV. An award is remembered as left off, so it isn't added back automatically. */
export function removeEntry(cv: Cv, sectionIndex: number, entryIndex: number): Cv {
  const e = cv.sections[sectionIndex]?.entries[entryIndex];
  if (!e) return cv;
  const folder = e.source?.startsWith("grant:") ? e.source.slice("grant:".length) : "";
  return {
    ...cv,
    leftOff: folder && !cv.leftOff.includes(folder) ? [...cv.leftOff, folder] : cv.leftOff,
    sections: cv.sections.map((s, i) => (i === sectionIndex ? { ...s, entries: s.entries.filter((_, j) => j !== entryIndex) } : s)),
  };
}

/** Put a left-off award back on the CV. */
export function addAwardBack(cv: Cv, folder: string, grants: Grant[], funderName: (slug: string) => string, clientName?: (slug: string) => string): Cv {
  return syncAwards({ ...cv, leftOff: cv.leftOff.filter((f) => f !== folder) }, grants, funderName, clientName);
}

/** Awarded applications taken off this CV, for the "Add back" list. */
export function leftOffAwards(cv: Cv, grants: Grant[]): Grant[] {
  return awardedFor(cv, grants).filter((g) => cv.leftOff.includes(g.folder));
}

/** Work samples not on the CV yet (awards are added automatically by syncAwards). */
export function cvSuggestions(cv: Cv, samples: WorkSample[]): CvSuggestion[] {
  const onCv = new Set(cv.sections.flatMap((s) => s.entries.map((e) => norm(e.text))));
  const has = (text: string) => [...onCv].some((t) => t === norm(text) || t.startsWith(norm(text)));
  const out: CvSuggestion[] = [];
  const client = cv.client || ME;
  for (const s of samples) {
    if (s.path.split("/")[0] !== client) continue;
    const detail = [s.fm.medium].filter((x) => x.trim()).join(", ");
    const text = detail ? `*${s.fm.title}*, ${detail}` : `*${s.fm.title}*`;
    if (has(s.fm.title) || has(text)) continue;
    out.push({ section: "Selected works", entry: { year: s.fm.year, text } });
  }
  return out;
}

/** Add suggestions to their sections (creating a section if needed), newest first within each. */
export function applySuggestions(cv: Cv, picks: CvSuggestion[]): Cv {
  const sections = cv.sections.map((s) => ({ ...s, entries: [...s.entries] }));
  for (const p of picks) {
    let sec = sections.find((s) => norm(s.title) === norm(p.section));
    if (!sec) {
      sec = { title: p.section, entries: [] };
      sections.push(sec);
    }
    sec.entries.push(p.entry);
  }
  const touched = new Set(picks.map((p) => norm(p.section)));
  return { ...cv, sections: sections.map((s) => (touched.has(norm(s.title)) ? { ...s, entries: sortEntries(s.entries) } : s)) };
}

// ---------------------------------------------------------------- exports

const filled = (cv: Cv) => cv.sections.filter((s) => s.entries.some((e) => e.text.trim()));
const contactLine = (cv: Cv) => [cv.location, cv.email, cv.phone, cv.website].map((x) => x.trim()).filter(Boolean).join(" · ");
const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g, (_, a, b, c) => a ?? b ?? c);

/** Plain text, for pasting into an application portal's CV box. */
export function cvText(cv: Cv): string {
  const lines = [cv.name.toUpperCase()];
  const contact = contactLine(cv);
  if (contact) lines.push(contact);
  for (const s of filled(cv)) {
    lines.push("", s.title.toUpperCase());
    for (const e of s.entries) if (e.text.trim()) lines.push(`${e.year ? `${e.year}  ` : ""}${plain(e.text)}`);
  }
  return lines.join("\n") + "\n";
}

/** Markdown, for the Library (so it can be attached to applications). */
export function cvMarkdown(cv: Cv): string {
  const out = [`# ${cv.name}`];
  const contact = contactLine(cv);
  if (contact) out.push(contact);
  for (const s of filled(cv)) {
    out.push("", `## ${s.title}`);
    for (const e of s.entries) if (e.text.trim()) out.push(`- ${e.year ? `${e.year}: ` : ""}${e.text}`);
  }
  return out.join("\n") + "\n";
}

export function cvDocumentXml(cv: Cv): string {
  const body: string[] = [];
  body.push(para(run(cv.name), "Title"));
  const contact = contactLine(cv);
  if (contact) body.push(para(run(contact, { color: "6B6460" }), "Subtitle"));
  // Year in a 1-inch column, the entry hanging next to it.
  const entryPr = `<w:tabs><w:tab w:val="left" w:pos="1260"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="1260" w:hanging="1260"/>`;
  for (const s of filled(cv)) {
    body.push(para(run(s.title), "Heading1"));
    for (const e of s.entries) {
      if (!e.text.trim()) continue;
      body.push(para(run(e.year) + `<w:r><w:tab/></w:r>` + inlineRuns(e.text), undefined, entryPr));
    }
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${body.join("")}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

export function buildCvDocx(cv: Cv): Promise<Uint8Array> {
  return packDocx(`${cv.name} CV`, cvDocumentXml(cv));
}
