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
import { fmtMoney, str } from "./util";

export interface CvEntry {
  year: string;
  text: string;
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
    extra: {},
  };
}

const YEARISH = /^(\d{4}|\d{4}\s*[-–—]\s*(\d{2,4}|present|now|ongoing)?|present|forthcoming|ongoing|upcoming)$/i;

export function parseEntry(line: string): CvEntry {
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
  cv.extra = Object.fromEntries(Object.entries(data).filter(([k]) => !["name", "location", "email", "website", "phone"].includes(k)));
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
  for (const k of ["location", "email", "website", "phone"]) if (!fm[k]) delete fm[k];
  const body = cv.sections
    .map((s) => [`## ${s.title}`, ...s.entries.filter((e) => e.text.trim() || e.year.trim()).map((e) => `- ${e.year.trim() ? `${e.year.trim()} | ` : ""}${e.text.trim()}`)].join("\n"))
    .join("\n\n");
  return stringifyFrontmatter(fm, body ? `\n${body}\n` : "", ["name", "location", "email", "website", "phone"]);
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

/**
 * Entries Many Apply already knows about: awarded grants, residencies and fellowships, and work samples.
 * Only ones not already on the CV (by their wording) are returned.
 */
export function cvSuggestions(cv: Cv, grants: Grant[], samples: WorkSample[], funderName: (slug: string) => string, opts: { amounts?: boolean } = {}): CvSuggestion[] {
  const onCv = new Set(cv.sections.flatMap((s) => s.entries.map((e) => norm(e.text))));
  const has = (text: string) => [...onCv].some((t) => t === norm(text) || t.startsWith(norm(text)));
  const out: CvSuggestion[] = [];
  const client = cv.client || ME;
  for (const g of grants) {
    if ((g.fm.client || ME) !== client || g.fm.status !== "awarded") continue;
    const funder = funderName(g.fm.funder);
    const titleHasFunder = funder && norm(g.fm.title).includes(norm(funder));
    let text = titleHasFunder || !funder ? g.fm.title : `${g.fm.title}, ${funder}`;
    if (opts.amounts && g.fm.amount_awarded) text += ` (${fmtMoney(g.fm.amount_awarded, g.fm.currency)})`;
    if (has(text) || has(g.fm.title)) continue;
    const section = g.fm.type === "residency" || g.fm.type === "fellowship" ? "Residencies and fellowships" : "Grants and awards";
    out.push({ section, entry: { year: yearOf(g), text } });
  }
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
