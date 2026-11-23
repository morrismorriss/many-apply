import Papa from "papaparse";
import { parseDate, isAmbiguousDate, type DateOrder } from "./extract";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import type { VaultFS } from "./fs/types";
import { ME, STATUSES, type Grant, type GrantFM, type ImportPreset, type Status } from "./model";
import { asArray, parseNumber, slugify, str, todayISO } from "./util";
import {
  createGrant,
  defaultGrantBody,
  ensureClient,
  ensureFunder,
  GRANT_ORDER,
  bodySection,
  setBodySection,
  trash,
} from "./vault";

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  meaning: string;
  formats: string;
  example: string;
}

export const IMPORT_FIELDS: FieldDef[] = [
  { key: "title", label: "Title", required: true, meaning: "Name of the opportunity", formats: "Text", example: "Project Grant 2027" },
  { key: "funder", label: "Funder", meaning: "Who gives the money. A funder file is created if one doesn't exist.", formats: "Text", example: "Pittsburgh Foundation" },
  { key: "url", label: "URL", meaning: "Link to the guidelines or portal", formats: "A web link", example: "https://pittsburghfoundation.org/grants" },
  { key: "type", label: "Type", meaning: "Kind of opportunity", formats: "grant, residency, fellowship, award, commission", example: "grant" },
  { key: "status", label: "Status", meaning: "Where it stands. Your own words are matched in step 4.", formats: "Any words", example: "Sent" },
  { key: "amount_requested", label: "Amount requested", meaning: "What you asked for", formats: "Number. $ and commas are fine.", example: "$5,000" },
  { key: "amount_awarded", label: "Amount awarded", meaning: "What you got", formats: "Number. $ and commas are fine.", example: "4500" },
  { key: "max_award", label: "Max award", meaning: "The funder's cap", formats: "Number", example: "10000" },
  { key: "deadline", label: "Deadline", meaning: "When it's due", formats: "2027-02-01, 2/1/2027, Feb 1 2027, February 1, 2027", example: "February 1, 2027" },
  { key: "deadline_type", label: "Deadline type", meaning: "Kind of deadline", formats: "fixed, rolling, LOI", example: "fixed" },
  { key: "submitted_on", label: "Submitted on", meaning: "When you sent it", formats: "A date", example: "2027-01-28" },
  { key: "decision_on", label: "Decision on", meaning: "When you heard back", formats: "A date", example: "2027-05-15" },
  { key: "client", label: "Client", meaning: "Who the application is for. Defaults to Me; new names get a client profile.", formats: "Text", example: "Lakeside Youth Theater" },
  { key: "project", label: "Project", meaning: "The project it funds", formats: "Text", example: "Prodigy" },
  { key: "location", label: "Location", meaning: "Where", formats: "Text", example: "Pittsburgh, PA" },
  { key: "tags", label: "Tags", meaning: "Labels for filtering", formats: "Comma- or semicolon-separated", example: "theater, individual-artist" },
  { key: "notes", label: "Notes", meaning: "Goes into the grant.md body", formats: "Text", example: "Called the program officer in Dec." },
  { key: "report_1_title", label: "Report 1 title", meaning: "Optional reporting date name (also report_2_…, report_3_…)", formats: "Text", example: "Final report" },
  { key: "report_1_due", label: "Report 1 due", meaning: "Optional reporting date", formats: "A date", example: "2028-02-01" },
];

const REPORT_FIELD = /^report_(\d+)_(title|due)$/;
export const SKIP = "";
export const EXTRA = "__extra";
export const NOTES = "__notes";

const HEADER_GUESSES: [RegExp, string][] = [
  [/^(name|grant( name)?|opportunity|title|program|opportunity name|grant title)$/, "title"],
  [/^(organi[sz]ation|funder|foundation|funding (org|organization|source)|grantor|funder name)$/, "funder"],
  [/^(due|due date|deadline|deadline date|application deadline|date due)$/, "deadline"],
  [/^(award|amount|ask|request|amount requested|requested|ask amount|requested amount)$/, "amount_requested"],
  [/^(awarded|amount awarded|award amount|received|amount received)$/, "amount_awarded"],
  [/^(max|max award|maximum|maximum award|award cap|cap|up to)$/, "max_award"],
  [/^(stage|status|state)$/, "status"],
  [/^(link|website|url|web|guidelines|portal)$/, "url"],
  [/^(type|category|kind|opportunity type)$/, "type"],
  [/^(deadline type|rolling)$/, "deadline_type"],
  [/^(submitted|submitted on|date submitted|submission date|sent|sent on)$/, "submitted_on"],
  [/^(decision|decision date|decision on|notified|notification date|result date)$/, "decision_on"],
  [/^(client|for|applicant|on behalf of)$/, "client"],
  [/^(project|project name)$/, "project"],
  [/^(location|city|region|place)$/, "location"],
  [/^(tags?|labels?|keywords?|disciplines?)$/, "tags"],
  [/^(notes?|comments?|description|details)$/, "notes"],
];

export function guessField(header: string): string {
  const h = header.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
  const exact = IMPORT_FIELDS.find((f) => f.key === header.trim().toLowerCase());
  if (exact) return exact.key;
  if (REPORT_FIELD.test(header.trim().toLowerCase())) return header.trim().toLowerCase();
  for (const [re, f] of HEADER_GUESSES) if (re.test(h)) return f;
  return SKIP;
}

export function guessStatus(value: string): Status {
  const v = value.trim().toLowerCase();
  if (!v) return "researching";
  if ((STATUSES as readonly string[]).includes(v)) return v as Status;
  if (/won|award|funded|accepted|approved|yes|granted|success/.test(v)) return "awarded";
  if (/reject|declin|^no$|denied|unsuccessful|not (funded|selected)|lost/.test(v)) return "declined";
  if (/withdr|cancel|skip|pass|not applying|abandon/.test(v)) return "withdrawn";
  if (/sent|submit|applied|pending|waiting|under review|in review/.test(v)) return "submitted";
  if (/draft|writing|in progress|working/.test(v)) return "drafting";
  if (/plan|next|to ?do|todo|ready|queued|upcoming|preparing/.test(v)) return "planning";
  return "researching";
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
}

/**
 * A cell Excel, Numbers or Google Sheets would run as a formula (=, +, -, @ at the start) gets a leading
 * apostrophe, so text from a feed or an import can't become a live formula in an exported file.
 * Plain numbers like -250 are left alone. readCsv takes the apostrophe off again.
 */
export function csvSafe(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s.trim())) return `'${s}`;
  return s;
}

export function readCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const r = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  });
  const headers = (r.meta.fields ?? []).filter((h) => h !== "");
  // Undo csvSafe: '=SUM(…) written by an export reads back as =SUM(…) text.
  for (const row of r.data) for (const k in row) if (typeof row[k] === "string" && /^'[=+\-@\t\r]/.test(row[k])) row[k] = row[k].slice(1);
  return { headers, rows: r.data, delimiter: r.meta.delimiter };
}

export interface Mapping {
  columns: Record<string, string>;
  statuses: Record<string, Status>;
  dateOrder: DateOrder;
  duplicate: "skip" | "merge";
}

export function autoMapping(csv: ParsedCsv, preset?: ImportPreset): Mapping {
  const columns: Record<string, string> = {};
  const used = new Set<string>();
  for (const h of csv.headers) {
    let f = preset?.columns[h] ?? guessField(h);
    if (f && f !== EXTRA && f !== NOTES && used.has(f)) f = SKIP;
    if (f && f !== EXTRA && f !== NOTES) used.add(f);
    columns[h] = f;
  }
  const mapping: Mapping = { columns, statuses: {}, dateOrder: preset?.dateOrder ?? guessDateOrder(csv), duplicate: "skip" };
  for (const v of distinctStatusValues(csv, mapping)) mapping.statuses[v] = preset?.statuses[v] ?? guessStatus(v);
  return mapping;
}

function guessDateOrder(csv: ParsedCsv): DateOrder {
  for (const row of csv.rows) {
    for (const v of Object.values(row)) {
      const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/.exec((v ?? "").trim());
      if (m && +m[1] > 12) return "dayfirst";
      if (m && +m[2] > 12) return "us";
    }
  }
  return "us";
}

export function distinctStatusValues(csv: ParsedCsv, mapping: Pick<Mapping, "columns">): string[] {
  const col = Object.entries(mapping.columns).find(([, f]) => f === "status")?.[0];
  if (!col) return [];
  const vals = new Set<string>();
  for (const r of csv.rows) vals.add((r[col] ?? "").trim());
  return [...vals].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
}

export interface PreviewRow {
  index: number;
  fm: Partial<GrantFM>;
  notes: string;
  extras: Record<string, string>;
  warnings: string[];
  error?: string;
  duplicateOf?: string;
  clientName?: string;
  funderName?: string;
}

const DATE_FIELDS = new Set(["deadline", "submitted_on", "decision_on"]);

export function dupKey(title: string, funder: string, deadline: string) {
  return `${slugify(title)}|${slugify(funder || "")}|${deadline || ""}`;
}

export function buildPreview(csv: ParsedCsv, mapping: Mapping, existing: Grant[]): PreviewRow[] {
  const existingKeys = new Map(existing.map((g) => [dupKey(g.fm.title, g.fm.funder, g.fm.deadline), g.folder]));
  const seen = new Map<string, number>();
  return csv.rows.map((row, index) => {
    const fm: Partial<GrantFM> = {};
    const reports: Record<string, { title?: string; due?: string }> = {};
    const extras: Record<string, string> = {};
    const notes: string[] = [];
    const warnings: string[] = [];
    let clientName: string | undefined;
    let funderName: string | undefined;

    for (const [header, field] of Object.entries(mapping.columns)) {
      const raw = (row[header] ?? "").trim();
      if (!field || !raw) continue;
      if (field === EXTRA) {
        extras[slugify(header).replace(/-/g, "_")] = raw;
        continue;
      }
      if (field === NOTES) {
        notes.push(`**${header}:** ${raw}`);
        continue;
      }
      const rm = REPORT_FIELD.exec(field);
      if (rm) {
        const r = (reports[rm[1]] ??= {});
        if (rm[2] === "title") r.title = raw;
        else {
          const iso = parseDate(raw, mapping.dateOrder);
          if (iso) r.due = iso;
          else warnings.push(`Can't read report date "${raw}"`);
        }
        continue;
      }
      if (DATE_FIELDS.has(field)) {
        const iso = parseDate(raw, mapping.dateOrder);
        if (!iso) warnings.push(`Can't read ${field.replace("_", " ")} "${raw}"`);
        else {
          (fm as Record<string, unknown>)[field] = iso;
          if (isAmbiguousDate(raw)) warnings.push(`"${raw}" read as ${iso} (${mapping.dateOrder === "us" ? "US" : "day-first"} order)`);
        }
        continue;
      }
      switch (field) {
        case "amount_requested":
        case "amount_awarded":
        case "max_award": {
          const n = parseNumber(raw);
          if (n === null) warnings.push(`Can't read amount "${raw}"`);
          else fm[field] = n;
          break;
        }
        case "status":
          fm.status = mapping.statuses[raw] ?? guessStatus(raw);
          break;
        case "type": {
          const t = raw.toLowerCase();
          const known = ["grant", "residency", "fellowship", "award", "commission"].find((k) => t.includes(k));
          fm.type = (known ?? "grant") as GrantFM["type"];
          if (!known) warnings.push(`Type "${raw}" isn't one of the five types, using grant`);
          break;
        }
        case "deadline_type": {
          const t = raw.toLowerCase();
          fm.deadline_type = t.includes("roll") ? "rolling" : t.includes("loi") || t.includes("letter") ? "loi" : "fixed";
          break;
        }
        case "tags":
          fm.tags = asArray(raw).map((t) => t.toLowerCase().replace(/\s+/g, "-"));
          break;
        case "client":
          clientName = raw;
          fm.client = /^me$/i.test(raw) ? ME : slugify(raw);
          break;
        case "funder":
          funderName = raw;
          fm.funder = slugify(raw);
          break;
        case "notes":
          notes.unshift(raw);
          break;
        default:
          (fm as Record<string, unknown>)[field] = raw;
      }
    }
    const repList = Object.keys(reports)
      .sort((a, b) => +a - +b)
      .map((k) => reports[k])
      .filter((r) => r.due)
      .map((r) => ({ title: r.title || "Report", due: r.due!, submitted_on: null, todoist_task_id: null, notes: "Imported" }));
    if (repList.length) fm.reports = repList;
    if (!fm.status) fm.status = "researching";

    const p: PreviewRow = { index, fm, notes: notes.join("\n\n"), extras, warnings, clientName, funderName };
    if (!fm.title) p.error = "Missing title";
    else {
      const key = dupKey(fm.title, fm.funder ?? "", fm.deadline ?? "");
      const dupFolder = existingKeys.get(key);
      if (dupFolder) p.duplicateOf = dupFolder;
      else if (seen.has(key)) p.warnings.push(`Same as row ${seen.get(key)! + 2} in this file`);
      seen.set(key, index);
    }
    return p;
  });
}

export interface ImportLog {
  id: string;
  file: string;
  date: string;
  created: string[]; // grant folders
  createdFunders: string[];
  createdClients: string[];
  merged: { folder: string; before: string }[];
  skipped: { row: number; reason: string; title: string }[];
}

export async function runImport(
  fs: VaultFS,
  rows: PreviewRow[],
  mapping: Mapping,
  fileName: string,
  /** Original spreadsheet row numbers, when rows were removed before importing. */
  rowNumbers?: number[],
): Promise<ImportLog> {
  const rowNo = (i: number) => rowNumbers?.[i] ?? i + 2;
  const log: ImportLog = {
    id: new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19),
    file: fileName,
    date: todayISO(),
    created: [],
    createdFunders: [],
    createdClients: [],
    merged: [],
    skipped: [],
  };
  for (const r of rows) {
    if (r.error) {
      log.skipped.push({ row: rowNo(r.index), reason: r.error, title: r.fm.title ?? "" });
      continue;
    }
    if (r.duplicateOf && mapping.duplicate === "skip") {
      log.skipped.push({ row: rowNo(r.index), reason: "Duplicate", title: r.fm.title ?? "" });
      continue;
    }
    if (r.funderName) {
      const f = await ensureFunder(fs, r.funderName);
      if (f.created) log.createdFunders.push(f.slug);
    }
    if (r.clientName && r.fm.client !== ME) {
      const c = await ensureClient(fs, r.clientName);
      if (c.created) log.createdClients.push(c.slug);
    }
    if (r.duplicateOf) {
      const path = `grants/${r.duplicateOf}/grant.md`;
      const before = await fs.readText(path);
      const { data, body } = parseFrontmatter(before);
      const merged: Record<string, unknown> = { ...data };
      for (const [k, v] of Object.entries({ ...r.extras, ...r.fm })) {
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
        if (k === "tags") merged.tags = [...new Set([...asArray(data.tags), ...(v as string[])])];
        else if (k === "reports") merged.reports = [...((data.reports as unknown[]) ?? []), ...(v as unknown[])];
        else merged[k] = v;
      }
      merged.updated = todayISO();
      const nextBody = r.notes ? setBodySection(body, "Notes", [str(bodyNotes(body)), r.notes].filter(Boolean).join("\n\n")) : body;
      await fs.writeText(path, stringifyFrontmatter(merged, nextBody, GRANT_ORDER));
      log.merged.push({ folder: r.duplicateOf, before });
      continue;
    }
    const body = r.notes ? setBodySection(defaultGrantBody(), "Notes", r.notes) : defaultGrantBody();
    const g = await createGrant(fs, { ...r.extras, ...r.fm, client: r.fm.client ?? ME }, body);
    // Imported history: date the status event by what we know.
    const date = r.fm.decision_on || r.fm.submitted_on || r.fm.deadline || todayISO();
    if (g.fm.status !== "researching") {
      const history = [] as { status: Status; date: string }[];
      if (r.fm.submitted_on) history.push({ status: "submitted", date: r.fm.submitted_on });
      if (g.fm.status !== "submitted" || !r.fm.submitted_on) history.push({ status: g.fm.status, date });
      g.fm.status_history = history;
      await fs.writeText(`grants/${g.folder}/grant.md`, stringifyFrontmatter({ ...g.fm }, g.body, GRANT_ORDER));
    }
    log.created.push(g.folder);
  }
  await fs.writeText(`.manyapply/imports/${log.id}.json`, JSON.stringify(log, null, 2));
  return log;
}

function bodyNotes(body: string) {
  return bodySection(body, "Notes");
}

export async function listImports(fs: VaultFS): Promise<ImportLog[]> {
  const entries = await fs.list(".manyapply/imports");
  const logs: ImportLog[] = [];
  for (const e of entries) {
    if (e.isDir || !e.path.endsWith(".json")) continue;
    try {
      const log = JSON.parse(await fs.readText(e.path)) as ImportLog & { undone?: boolean };
      // The same folder holds donor-import logs, which have a different shape.
      if (!log.undone && Array.isArray(log.created) && Array.isArray(log.merged)) logs.push(log);
    } catch {
      /* ignore */
    }
  }
  return logs.sort((a, b) => b.id.localeCompare(a.id));
}

/** Undo an import: created items go to trash, merged files get their old text back. */
export async function undoImport(fs: VaultFS, log: ImportLog) {
  for (const f of log.created ?? []) if (await fs.exists(`grants/${f}`)) await trash(fs, `grants/${f}`);
  for (const m of log.merged ?? []) await fs.writeText(`grants/${m.folder}/grant.md`, m.before);
  for (const f of log.createdFunders ?? []) if (await fs.exists(`funders/${f}.md`)) await trash(fs, `funders/${f}.md`);
  for (const c of log.createdClients ?? []) if (await fs.exists(`clients/${c}.md`)) await trash(fs, `clients/${c}.md`);
  await fs.writeText(`.manyapply/imports/${log.id}.json`, JSON.stringify({ ...log, undone: true }, null, 2));
}

// ------------------------------------------------------------------ export

export const TEMPLATE_HEADERS = [
  "title", "funder", "url", "type", "status", "amount_requested", "amount_awarded", "max_award", "deadline",
  "deadline_type", "submitted_on", "decision_on", "client", "project", "location", "tags", "notes",
  "report_1_title", "report_1_due", "report_2_title", "report_2_due",
];

export function starterTemplateCsv(): string {
  return (
    Papa.unparse({
      fields: TEMPLATE_HEADERS,
      data: [
        ["Project Grant 2027", "Pittsburgh Foundation", "https://example.org/project-grant", "grant", "drafting", "5000", "", "5000", "2027-02-01", "fixed", "", "", "Me", "Prodigy", "Pittsburgh, PA", "theater, individual-artist", "Program officer: call in January.", "", "", "", ""],
        ["Summer Residency", "Lakeside Arts Colony", "https://example.org/residency", "residency", "awarded", "2500", "2500", "", "2026-03-15", "fixed", "2026-03-10", "2026-05-01", "Me", "Made Men", "Erie, PA", "residency; writing", "", "Final report", "2026-10-01", "", ""],
      ],
    }) + "\n"
  );
}

export function exportGrantsCsv(grants: Grant[], funderName: (slug: string) => string, clientName: (slug: string) => string): string {
  const maxReports = Math.max(2, ...grants.map((g) => g.fm.reports.length));
  const headers = [...TEMPLATE_HEADERS.filter((h) => !REPORT_FIELD.test(h))];
  for (let i = 1; i <= maxReports; i++) headers.push(`report_${i}_title`, `report_${i}_due`);
  const data = grants.map((g) => {
    const f = g.fm;
    const row: Record<string, string> = {
      title: f.title,
      funder: funderName(f.funder),
      url: f.url,
      type: f.type,
      status: f.status,
      amount_requested: f.amount_requested?.toString() ?? "",
      amount_awarded: f.amount_awarded?.toString() ?? "",
      max_award: f.max_award?.toString() ?? "",
      deadline: f.deadline,
      deadline_type: f.deadline_type,
      submitted_on: f.submitted_on,
      decision_on: f.decision_on,
      client: clientName(f.client),
      project: f.project,
      location: f.location,
      tags: f.tags.join(", "),
      notes: bodyNotes(g.body),
    };
    f.reports.forEach((r, i) => {
      row[`report_${i + 1}_title`] = r.title;
      row[`report_${i + 1}_due`] = r.due;
    });
    return headers.map((h) => csvSafe(row[h] ?? ""));
  });
  return "﻿" + Papa.unparse({ fields: headers, data }) + "\n";
}
