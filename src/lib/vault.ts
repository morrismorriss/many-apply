import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import { basename, dirname, joinPath, type VaultFS } from "./fs/types";
import {
  DEADLINE_TYPES,
  DEFAULT_SETTINGS,
  GRANT_TYPES,
  ME,
  STATUSES,
  clientsOf,
  type Client,
  type Funder,
  type Grant,
  type GrantFM,
  type LibraryItem,
  type Question,
  type ReportDate,
  type Settings,
  type Status,
  type StatusEvent,
} from "./model";
import { asArray, parseNumber, slugify, str, todayISO, wordCount } from "./util";
import { readDonor, type Donor } from "./donors";
import { readSample, type WorkSample } from "./samples";
import { readDocument, type VaultDocument } from "./documents";
import { mergeFeeds } from "./feeds";
import { renameGrantReferences } from "./move";

export const GRANT_ORDER = [
  "title", "client", "clients", "funder", "url", "type", "status", "starred", "amount_requested", "amount_awarded",
  "max_award", "currency", "deadline", "deadline_type", "project", "location", "tags", "submitted_on",
  "decision_expected", "decision_on", "todoist_task_ids", "reports", "no_reporting", "work_samples", "library_items", "documents", "created", "updated", "status_history", "time_log",
];
const FUNDER_ORDER = ["name", "website", "funder_type", "contact_name", "contact_email", "contact_phone", "contacts", "notes"];
const CLIENT_ORDER = [
  "name", "type", "contact_person", "contact_email", "website", "mission", "fiscal_year_start",
  "annual_budget", "fiscal_sponsor", "color", "todoist_project_id", "budget_template",
];
const LIB_ORDER = ["title", "tags", "word_count", "used_in"];

export interface VaultData {
  grants: Grant[];
  funders: Funder[];
  clients: Client[];
  donors: Donor[];
  library: LibraryItem[];
  samples: WorkSample[];
  documents: VaultDocument[];
  libraryFolders: string[]; // relative to library/, excluding budgets
  budgetTemplates: string[]; // file names in library/budgets
  settings: Settings;
}

// ------------------------------------------------------------------ normalise

function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return str(v).trim();
}

export function normalizeGrant(raw: Record<string, unknown>, folder: string): GrantFM {
  const status = STATUSES.includes(raw.status as Status) ? (raw.status as Status) : "researching";
  const type = GRANT_TYPES.includes(raw.type as never) ? (raw.type as GrantFM["type"]) : "grant";
  const dtype = DEADLINE_TYPES.includes(String(raw.deadline_type).toLowerCase() as never)
    ? (String(raw.deadline_type).toLowerCase() as GrantFM["deadline_type"])
    : "fixed";
  const reports: ReportDate[] = Array.isArray(raw.reports)
    ? (raw.reports as Record<string, unknown>[])
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          title: str(r.title) || "Report",
          due: dateStr(r.due),
          submitted_on: dateStr(r.submitted_on) || null,
          todoist_task_id: str(r.todoist_task_id) || null,
          notes: str(r.notes) || null,
        }))
    : [];
  const history: StatusEvent[] = Array.isArray(raw.status_history)
    ? (raw.status_history as Record<string, unknown>[])
        .filter((h) => h && STATUSES.includes(h.status as Status))
        .map((h) => ({ status: h.status as Status, date: dateStr(h.date) }))
    : [];
  // The main client comes first; "clients" lists anyone else it's for (older files only have "client").
  const listed = asArray(raw.clients).map(slugOrMe);
  const main = str(raw.client).trim() ? slugOrMe(raw.client) : listed[0] ?? ME;
  const clients = [...new Set([main, ...listed])];
  const fm: GrantFM = {
    ...raw,
    title: str(raw.title) || folder,
    client: main,
    clients,
    funder: str(raw.funder),
    url: str(raw.url),
    type,
    status,
    starred: raw.starred === true || raw.starred === "true",
    amount_requested: parseNumber(raw.amount_requested),
    amount_awarded: parseNumber(raw.amount_awarded),
    max_award: parseNumber(raw.max_award),
    currency: str(raw.currency) || "USD",
    deadline: dateStr(raw.deadline),
    deadline_type: dtype,
    project: str(raw.project),
    location: str(raw.location),
    tags: asArray(raw.tags),
    submitted_on: dateStr(raw.submitted_on),
    decision_expected: dateStr(raw.decision_expected),
    decision_on: dateStr(raw.decision_on),
    todoist_task_ids: asArray(raw.todoist_task_ids),
    reports,
    no_reporting: raw.no_reporting === true || raw.no_reporting === "true",
    work_samples: asArray(raw.work_samples),
    library_items: asArray(raw.library_items),
    documents: asArray(raw.documents),
    created: dateStr(raw.created) || todayISO(),
    updated: dateStr(raw.updated) || todayISO(),
    status_history: history.length ? history : [{ status, date: dateStr(raw.created) || todayISO() }],
    time_log: Array.isArray(raw.time_log)
      ? (raw.time_log as Record<string, unknown>[])
          .filter((t) => t && typeof t === "object")
          .map((t) => ({ date: dateStr(t.date), minutes: Math.max(0, Math.round(parseNumber(t.minutes) ?? 0)), note: str(t.note) }))
          .filter((t) => t.minutes > 0)
      : [],
  };
  return fm;
}

function slugOrMe(v: unknown): string {
  const s = str(v).trim();
  if (!s || /^me$/i.test(s)) return ME;
  return slugify(s);
}

function grantToYaml(fm: GrantFM): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fm };
  const clients = clientsOf(fm);
  out.client = clients[0];
  if (clients.length > 1) out.clients = clients;
  else delete out.clients;
  out.reports = fm.reports.map((r) => ({
    title: r.title,
    due: r.due,
    submitted_on: r.submitted_on ?? "",
    todoist_task_id: r.todoist_task_id ?? "",
    notes: r.notes ?? "",
  }));
  return out;
}

// ------------------------------------------------------------------ questions

const Q_HEAD = /^###\s+(?:(\d+)[.)]\s*)?(.+?)\s*$/;
const LIMIT = /\((\d[\d,]*)\s*(words?|characters?|chars?)\)\s*$/i;

export function parseQuestions(body: string): Question[] {
  const lines = body.split(/\r?\n/);
  const out: Question[] = [];
  let inQ = false;
  let cur: Question | null = null;
  for (const line of lines) {
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      inQ = /^##\s+questions\b/i.test(line);
      cur = null;
      continue;
    }
    if (!inQ) continue;
    const h = Q_HEAD.exec(line);
    if (h) {
      let title = h[2];
      let limit: number | null = null;
      let limitUnit: Question["limitUnit"] = "words";
      const lm = LIMIT.exec(title);
      if (lm) {
        limit = parseInt(lm[1].replace(/,/g, ""), 10);
        limitUnit = /^char/i.test(lm[2]) ? "characters" : "words";
        title = title.slice(0, lm.index).trim();
      }
      cur = { number: h[1] ?? String(out.length + 1), title, limit, limitUnit, draft: null };
      out.push(cur);
      continue;
    }
    const d = /^\s*Draft:\s*(\S.*?)\s*$/i.exec(line);
    if (d && cur) cur.draft = d[1].replace(/^\[.*?\]\((.*)\)$/, "$1");
  }
  return out;
}

/** Add a question to the body's "## Questions" section (creating it if needed). */
export function addQuestionToBody(body: string, q: { title: string; limit: number | null; unit: string; draft: string }): string {
  const head = `### ${q.title.match(/^\d+\./) ? "" : ""}${q.title}${q.limit ? ` (${q.limit} ${q.unit})` : ""}`;
  const block = `${head}\nDraft: ${q.draft}\n`;
  const lines = body.split("\n");
  const qi = lines.findIndex((l) => /^##\s+questions\b/i.test(l));
  if (qi < 0) {
    const ni = lines.findIndex((l) => /^##\s+notes\b/i.test(l));
    const section = `## Questions\n${block}`;
    if (ni < 0) return body.trimEnd() + `\n\n${section}`;
    lines.splice(ni, 0, section);
    return lines.join("\n");
  }
  let end = lines.length;
  for (let i = qi + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]) && !/^###/.test(lines[i])) {
      end = i;
      break;
    }
  }
  while (end > qi + 1 && lines[end - 1].trim() === "") end--;
  lines.splice(end, 0, "", block.trimEnd());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function defaultGrantBody(): string {
  return `## Eligibility\n\n\n## Questions\n\n\n## Notes\n\n`;
}

/** Text of a "## Heading" section in the body. */
export function bodySection(body: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const m = re.exec(body);
  if (!m) return "";
  const rest = body.slice(m.index + m[0].length);
  const next = /^##\s+(?!#)/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

export function setBodySection(body: string, heading: string, text: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const m = re.exec(body);
  if (!m) return body.trimEnd() + `\n\n## ${heading}\n${text.trim()}\n`;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = /^##\s+(?!#)/m.exec(rest);
  const end = next ? start + next.index : body.length;
  return body.slice(0, start) + `\n${text.trim()}\n${next ? "\n" : ""}` + body.slice(end);
}

// ------------------------------------------------------------------ folder names

export function grantFolderName(fm: { deadline?: string; funder?: string; title?: string }): string {
  const ym = /^(\d{4})-(\d{2})/.exec(fm.deadline || "");
  const prefix = ym ? `${ym[1]}-${ym[2]}` : "rolling";
  const funder = fm.funder ? slugify(fm.funder, 40) : "";
  let title = slugify(fm.title || "untitled", 40);
  if (funder && title.startsWith(funder)) title = title.slice(funder.length).replace(/^-/, "") || title;
  return [prefix, funder, title].filter(Boolean).join("-");
}

async function uniqueFolder(fs: VaultFS, base: string, ignore?: string): Promise<string> {
  let name = base;
  let i = 2;
  while (name !== ignore && (await fs.exists(`grants/${name}`))) name = `${base}-${i++}`;
  return name;
}

// ------------------------------------------------------------------ load

export async function loadVault(fs: VaultFS): Promise<VaultData> {
  const entries = await fs.list("");
  const settings = await loadSettings(fs);

  const grantDirs = new Map<string, number>(); // folder -> newest mtime
  const libFolders = new Set<string>();
  const budgetTemplates: string[] = [];
  const funderFiles: string[] = [];
  const clientFiles: string[] = [];
  const donorFiles: string[] = [];
  const libFiles: string[] = [];
  const sampleFiles: string[] = [];
  const docFiles: string[] = [];

  for (const e of entries) {
    const parts = e.path.split("/");
    if (parts[0] === "grants" && parts.length >= 3) {
      const folder = parts[1];
      const isText = /\.(md|csv)$/i.test(e.path);
      if (!e.isDir && isText) grantDirs.set(folder, Math.max(grantDirs.get(folder) ?? 0, e.mtime));
      else if (!grantDirs.has(folder)) grantDirs.set(folder, 0);
    } else if (parts[0] === "funders" && parts.length === 2 && e.path.endsWith(".md")) {
      funderFiles.push(e.path);
    } else if (parts[0] === "clients" && parts.length === 2 && e.path.endsWith(".md")) {
      clientFiles.push(e.path);
    } else if (parts[0] === "donors" && parts.length === 2 && e.path.endsWith(".md")) {
      donorFiles.push(e.path);
    } else if (parts[0] === "samples" && parts.length >= 3 && !e.isDir && e.path.endsWith(".md")) {
      sampleFiles.push(e.path);
    } else if (parts[0] === "documents" && parts.length >= 3 && !e.isDir && e.path.endsWith(".md")) {
      docFiles.push(e.path);
    } else if (parts[0] === "library" && parts.length >= 2) {
      const rel = parts.slice(1).join("/");
      if (parts[1] === "budgets") {
        if (!e.isDir && e.path.endsWith(".csv")) budgetTemplates.push(parts.slice(2).join("/"));
        continue;
      }
      if (e.isDir) libFolders.add(rel);
      else if (e.path.endsWith(".md")) {
        libFiles.push(e.path);
        libFolders.add(dirname(rel));
      }
    }
  }

  const grants: Grant[] = [];
  await Promise.all(
    [...grantDirs.entries()].map(async ([folder, mtime]) => {
      const p = `grants/${folder}/grant.md`;
      let text: string;
      try {
        text = await fs.readText(p);
      } catch {
        return;
      }
      const { data, body } = parseFrontmatter(text);
      grants.push({ folder, fm: normalizeGrant(data, folder), body, lastEdited: mtime });
    }),
  );
  grants.sort((a, b) => a.folder.localeCompare(b.folder));

  const funders = await Promise.all(funderFiles.map((p) => readFunder(fs, p)));
  const clients = await Promise.all(clientFiles.map((p) => readClient(fs, p)));
  const library = await Promise.all(libFiles.map((p) => readLibrary(fs, p)));
  const samples = (await Promise.all(sampleFiles.map((p) => readSample(fs, p).catch(() => null)))).filter(
    (x): x is WorkSample => x !== null,
  );
  const documents = (await Promise.all(docFiles.map((p) => readDocument(fs, p).catch(() => null)))).filter(
    (x): x is VaultDocument => x !== null,
  );
  const donors = (await Promise.all(donorFiles.map((p) => readDonor(fs, p)))).sort((a, b) => a.fm.name.localeCompare(b.fm.name));

  if (!clients.some((c) => c.slug === ME)) clients.unshift(blankClient(ME, "Me"));
  clients.sort((a, b) => (a.slug === ME ? -1 : b.slug === ME ? 1 : a.fm.name.localeCompare(b.fm.name)));
  funders.sort((a, b) => a.fm.name.localeCompare(b.fm.name));
  libFolders.delete("");
  libFolders.add("shared");
  for (const c of clients) libFolders.add(c.slug);

  return {
    grants,
    funders,
    clients,
    donors,
    library: library.sort((a, b) => a.path.localeCompare(b.path)),
    samples: samples.sort((a, b) => b.fm.year.localeCompare(a.fm.year) || a.fm.title.localeCompare(b.fm.title)),
    documents: documents.sort((a, b) => a.fm.title.localeCompare(b.fm.title)),
    libraryFolders: [...libFolders].sort(),
    budgetTemplates: budgetTemplates.sort(),
    settings,
  };
}

async function readFunder(fs: VaultFS, p: string): Promise<Funder> {
  const { data, body } = parseFrontmatter(await fs.readText(p));
  const slug = basename(p).replace(/\.md$/, "");
  return {
    slug,
    fm: {
      ...data,
      name: str(data.name) || slug,
      website: str(data.website),
      funder_type: str(data.funder_type),
      contact_name: str(data.contact_name),
      contact_email: str(data.contact_email),
      contact_phone: str(data.contact_phone),
      contacts: str(data.contacts),
      notes: str(data.notes),
    },
    body,
  };
}

export function blankClient(slug: string, name: string): Client {
  return {
    slug,
    fm: {
      name,
      type: slug === ME ? "individual artist" : "nonprofit",
      contact_person: "",
      contact_email: "",
      website: "",
      mission: "",
      fiscal_year_start: "",
      annual_budget: null,
      fiscal_sponsor: "",
      color: slug === ME ? "#8a817c" : pickColor(slug),
      todoist_project_id: "",
      budget_template: "",
    },
    body: "",
  };
}

const LABEL_COLORS = ["#c2577a", "#4f7cac", "#5a9a78", "#c98a3d", "#8a63b8", "#3e9aa6", "#b5654a", "#6c7a3a"];
function pickColor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
}

async function readClient(fs: VaultFS, p: string): Promise<Client> {
  const { data, body } = parseFrontmatter(await fs.readText(p));
  const slug = basename(p).replace(/\.md$/, "");
  const base = blankClient(slug, str(data.name) || slug);
  return {
    slug,
    fm: {
      ...base.fm,
      ...data,
      name: str(data.name) || base.fm.name,
      annual_budget: parseNumber(data.annual_budget),
      color: str(data.color) || base.fm.color,
      todoist_project_id: str(data.todoist_project_id),
      budget_template: str(data.budget_template),
    } as Client["fm"],
    body,
  };
}

async function readLibrary(fs: VaultFS, p: string): Promise<LibraryItem> {
  const { data, body } = parseFrontmatter(await fs.readText(p));
  const rel = p.replace(/^library\//, "");
  return {
    path: rel,
    fm: {
      ...data,
      title: str(data.title) || basename(rel).replace(/\.md$/, "").replace(/-/g, " "),
      tags: asArray(data.tags),
      word_count: wordCount(body),
      used_in: asArray(data.used_in),
    },
    body,
  };
}

export async function loadSettings(fs: VaultFS): Promise<Settings> {
  try {
    const raw = JSON.parse(await fs.readText(".manyapply/settings.json"));
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      customTheme: { ...DEFAULT_SETTINGS.customTheme, ...(raw.customTheme ?? {}) },
      todoist: { ...DEFAULT_SETTINGS.todoist, ...(raw.todoist ?? {}) },
      feeds: mergeFeeds(raw.feeds),
      dataColors: raw.dataColors && typeof raw.dataColors === "object" ? raw.dataColors : {},
      hiddenReports: Array.isArray(raw.hiddenReports) ? raw.hiddenReports.filter((x: unknown) => typeof x === "string") : [],
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(fs: VaultFS, s: Settings) {
  await fs.writeText(".manyapply/settings.json", JSON.stringify(s, null, 2) + "\n");
}

/** Create the vault skeleton in an empty (or existing) folder. Safe to run repeatedly. */
export async function initVault(fs: VaultFS) {
  for (const d of ["grants", "clients", "donors", "library/shared", "library/me", "library/budgets", "samples/shared", "samples/me", "documents/me", "funders", ".manyapply"]) {
    await fs.mkdir(d);
  }
  if (!(await fs.exists("clients/me.md"))) await writeClient(fs, blankClient(ME, "Me"));
  if (!(await fs.exists(".manyapply/settings.json"))) await saveSettings(fs, structuredClone(DEFAULT_SETTINGS));
  if (!(await fs.exists(".manyapply/README.md")))
    await fs.writeText(
      ".manyapply/README.md",
      "Many Apply keeps app data here. index.db / index.json are caches and safe to delete.\n" +
        "trash/ holds deleted items, imports/ holds import logs used for undo.\n",
    );
}

// ------------------------------------------------------------------ write

export async function writeGrant(fs: VaultFS, g: Grant): Promise<void> {
  const text = stringifyFrontmatter(grantToYaml(g.fm), g.body, GRANT_ORDER);
  await fs.writeText(`grants/${g.folder}/grant.md`, text);
}

/** Save a grant, renaming its folder if the deadline month or funder changed. Returns the (new) folder. */
export async function saveGrant(fs: VaultFS, g: Grant, opts: { touch?: boolean } = {}): Promise<Grant> {
  const fm = { ...g.fm, updated: opts.touch === false ? g.fm.updated : todayISO() };
  let folder = g.folder;
  const wanted = grantFolderName(fm);
  if (!folder.startsWith(wanted) && (await fs.exists(`grants/${folder}`))) {
    const next = await uniqueFolder(fs, wanted, folder);
    if (next !== folder) {
      await fs.rename(`grants/${folder}`, `grants/${next}`);
      await renameUsedIn(fs, folder, next);
      folder = next;
    }
  }
  const out = { ...g, folder, fm, lastEdited: Date.now() };
  await writeGrant(fs, out);
  return out;
}

async function renameUsedIn(fs: VaultFS, from: string, to: string) {
  const entries = [...(await fs.list("library")), ...(await fs.list("samples"))];
  for (const e of entries) {
    if (e.isDir || !e.path.endsWith(".md")) continue;
    const text = await fs.readText(e.path);
    if (!text.includes(from)) continue;
    const { data, body } = parseFrontmatter(text);
    const used = asArray(data.used_in);
    if (!used.includes(from)) continue;
    data.used_in = used.map((u) => (u === from ? to : u));
    await fs.writeText(e.path, stringifyFrontmatter(data, body, LIB_ORDER));
  }
}

export async function createGrant(fs: VaultFS, partial: Partial<GrantFM>, body = defaultGrantBody()): Promise<Grant> {
  const today = todayISO();
  const status = (partial.status as Status) || "researching";
  const fm = normalizeGrant(
    {
      ...partial,
      status,
      created: today,
      updated: today,
      status_history: [{ status, date: today }],
    },
    "",
  );
  const folder = await uniqueFolder(fs, grantFolderName(fm));
  const g: Grant = { folder, fm, body, lastEdited: Date.now() };
  await fs.mkdir(`grants/${folder}/drafts`);
  await fs.mkdir(`grants/${folder}/attachments`);
  await writeGrant(fs, g);
  return g;
}

/** Apply a status change, appending to status_history. */
export function withStatus(fm: GrantFM, status: Status, date = todayISO()): GrantFM {
  if (fm.status === status) return fm;
  const next: GrantFM = { ...fm, status, status_history: [...fm.status_history, { status, date }] };
  if (status === "submitted" && !next.submitted_on) next.submitted_on = date;
  if ((status === "awarded" || status === "declined") && !next.decision_on) next.decision_on = date;
  if (status === "awarded" && next.amount_awarded === null && next.amount_requested !== null)
    next.amount_awarded = next.amount_requested;
  return next;
}

/** Nothing is hard-deleted: move into .manyapply/trash/. */
export async function trash(fs: VaultFS, path: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = `.manyapply/trash/${stamp}__${path.replace(/\//g, "__")}`;
  await fs.rename(path, dest);
  return dest;
}

export async function writeFunder(fs: VaultFS, f: Funder) {
  await fs.writeText(`funders/${f.slug}.md`, stringifyFrontmatter(f.fm, f.body, FUNDER_ORDER));
}

export async function ensureFunder(fs: VaultFS, name: string): Promise<{ slug: string; created: boolean }> {
  const slug = slugify(name);
  if (await fs.exists(`funders/${slug}.md`)) return { slug, created: false };
  await writeFunder(fs, {
    slug,
    fm: { name, website: "", funder_type: "", contact_name: "", contact_email: "", contact_phone: "", contacts: "", notes: "" },
    body: "",
  });
  return { slug, created: true };
}

export async function writeClient(fs: VaultFS, c: Client) {
  await fs.writeText(`clients/${c.slug}.md`, stringifyFrontmatter(c.fm, c.body, CLIENT_ORDER));
  await fs.mkdir(`library/${c.slug}`);
}

export async function ensureClient(fs: VaultFS, name: string): Promise<{ slug: string; created: boolean }> {
  const slug = slugOrMe(name);
  if (await fs.exists(`clients/${slug}.md`)) return { slug, created: false };
  await writeClient(fs, blankClient(slug, slug === ME ? "Me" : name.trim()));
  return { slug, created: true };
}

export async function writeLibrary(fs: VaultFS, item: LibraryItem) {
  const fm = { ...item.fm, word_count: wordCount(item.body) };
  await fs.writeText(`library/${item.path}`, stringifyFrontmatter(fm, item.body, LIB_ORDER));
}

export async function createLibraryItem(fs: VaultFS, folder: string, title: string, body = "", tags: string[] = []) {
  let name = slugify(title);
  let i = 2;
  while (await fs.exists(`library/${joinPath(folder, name)}.md`)) name = `${slugify(title)}-${i++}`;
  const item: LibraryItem = {
    path: `${joinPath(folder, name)}.md`,
    fm: { title, tags, word_count: wordCount(body), used_in: [] },
    body,
  };
  await writeLibrary(fs, item);
  return item;
}

export async function moveLibraryItem(fs: VaultFS, path: string, toFolder: string): Promise<string> {
  let dest = joinPath(toFolder, basename(path));
  let i = 2;
  while (await fs.exists(`library/${dest}`)) dest = joinPath(toFolder, basename(path).replace(/\.md$/, `-${i++}.md`));
  await fs.rename(`library/${path}`, `library/${dest}`);
  await renameGrantReferences(fs, "library_items", path, dest);
  return dest;
}

/** Undo recordUsedIn, when an answer is taken off an application. */
export async function removeUsedIn(fs: VaultFS, item: LibraryItem, grantFolder: string): Promise<LibraryItem> {
  if (!item.fm.used_in.includes(grantFolder)) return item;
  const next = { ...item, fm: { ...item.fm, used_in: item.fm.used_in.filter((u) => u !== grantFolder) } };
  await writeLibrary(fs, next);
  return next;
}

/** Record that a library item was used in a grant. */
export async function recordUsedIn(fs: VaultFS, item: LibraryItem, grantFolder: string): Promise<LibraryItem> {
  if (item.fm.used_in.includes(grantFolder)) return item;
  const next = { ...item, fm: { ...item.fm, used_in: [...item.fm.used_in, grantFolder] } };
  await writeLibrary(fs, next);
  return next;
}

export async function readDraft(fs: VaultFS, folder: string, draft: string): Promise<string> {
  try {
    return await fs.readText(`grants/${folder}/${draft}`);
  } catch {
    return "";
  }
}

export async function listDrafts(fs: VaultFS, folder: string): Promise<string[]> {
  const entries = await fs.list(`grants/${folder}/drafts`);
  return entries.filter((e) => !e.isDir && e.path.endsWith(".md")).map((e) => e.path.replace(`grants/${folder}/`, "")).sort();
}

export async function listAttachments(fs: VaultFS, folder: string): Promise<string[]> {
  const entries = await fs.list(`grants/${folder}/attachments`);
  return entries.filter((e) => !e.isDir).map((e) => basename(e.path)).sort();
}
