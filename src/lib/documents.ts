// Documents: contracts, tax forms, legal and organizational paperwork that applications ask for again
// and again (W-9, 501(c)(3) letter, fiscal sponsor agreement, insurance certificate…).
// One markdown file per document in documents/<owner>/, with the file it describes next to it.
// These are sensitive, so they're never included in "Share client folder".
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import { basename, dirname, joinPath, type VaultFS } from "./fs/types";
import { extOf } from "./samples";
import { moveWithFile, renameGrantReferences } from "./move";
import { asArray, daysUntil, slugify, str } from "./util";

export const DOC_TYPES = [
  "W-9",
  "501(c)(3) letter",
  "Fiscal sponsor agreement",
  "Grant agreement",
  "Contract",
  "Insurance certificate",
  "Tax return",
  "Financial statement",
  "Board list",
  "Bylaws",
  "ID",
  "Other",
] as const;

/** Files a document can be. Keep in step with OPENABLE in src-tauri/src/lib.rs. */
export const DOC_EXTENSIONS = ["pdf", "doc", "docx", "pages", "odt", "rtf", "txt", "jpg", "jpeg", "png", "heic", "tif", "tiff", "xls", "xlsx", "csv", "numbers"];

export interface VaultDocument {
  /** Path relative to documents/, e.g. "me/w-9-2026.md" */
  path: string;
  fm: {
    title: string;
    type: string;
    file: string;
    issued: string;
    /** When it stops being valid: insurance certificates, W-9s, letters of good standing. */
    expires: string;
    tags: string[];
    [extra: string]: unknown;
  };
  body: string;
}

const DOC_ORDER = ["title", "type", "file", "issued", "expires", "tags"];

function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return str(v).trim();
}

export function documentOwner(d: { path: string }): string {
  return d.path.split("/")[0];
}

export function documentFilePath(d: VaultDocument): string {
  return d.fm.file ? `documents/${joinPath(dirname(d.path), d.fm.file)}` : "";
}

/** Guess a type from a file name: "W9 2026.pdf" → W-9. */
export function guessDocType(name: string): string {
  const n = name.toLowerCase();
  if (/\bw-?9\b/.test(n)) return "W-9";
  if (/501|determination/.test(n)) return "501(c)(3) letter";
  if (/fiscal.?spons/.test(n)) return "Fiscal sponsor agreement";
  if (/insurance|\bcoi\b|certificate of ins/.test(n)) return "Insurance certificate";
  if (/990|1040|tax return|schedule c/.test(n)) return "Tax return";
  if (/audit|financial|balance sheet|p&l|profit/.test(n)) return "Financial statement";
  if (/board/.test(n)) return "Board list";
  if (/bylaw/.test(n)) return "Bylaws";
  if (/grant agreement|award letter/.test(n)) return "Grant agreement";
  if (/contract|agreement/.test(n)) return "Contract";
  return "Other";
}

export function normalizeDocument(raw: Record<string, unknown>, path: string, body: string): VaultDocument {
  return {
    path,
    fm: {
      ...raw,
      title: str(raw.title) || basename(path).replace(/\.md$/, "").replace(/-/g, " "),
      type: str(raw.type) || "Other",
      file: str(raw.file).trim(),
      issued: dateStr(raw.issued),
      expires: dateStr(raw.expires),
      tags: asArray(raw.tags),
    },
    body,
  };
}

export async function readDocument(fs: VaultFS, p: string): Promise<VaultDocument> {
  const { data, body } = parseFrontmatter(await fs.readText(p));
  return normalizeDocument(data, p.replace(/^documents\//, ""), body);
}

export async function writeDocument(fs: VaultFS, d: VaultDocument) {
  await fs.writeText(`documents/${d.path}`, stringifyFrontmatter(d.fm, d.body, DOC_ORDER));
}

export async function createDocument(
  fs: VaultFS,
  folder: string,
  n: { title: string; file?: { name: string; copyTo: (vaultPath: string) => Promise<void> } },
): Promise<VaultDocument> {
  await fs.mkdir(`documents/${folder}`);
  const ext = n.file ? extOf(n.file.name) : "";
  const stem = slugify(n.title) || "document";
  let base = stem;
  let i = 2;
  while ((await fs.exists(`documents/${folder}/${base}.md`)) || (ext && (await fs.exists(`documents/${folder}/${base}.${ext}`))))
    base = `${stem}-${i++}`;
  let file = "";
  if (n.file) {
    file = ext ? `${base}.${ext}` : base;
    await n.file.copyTo(`documents/${folder}/${file}`);
  }
  const d = normalizeDocument({ title: n.title, type: n.file ? guessDocType(n.file.name) : "Other", file }, `${folder}/${base}.md`, "");
  await writeDocument(fs, d);
  return d;
}

/** Upload or replace a document's file. The old file goes to trash via `discard`. */
export async function setDocumentFile(
  fs: VaultFS,
  d: VaultDocument,
  picked: { name: string; copyTo: (vaultPath: string) => Promise<void> },
  discard: (vaultPath: string) => Promise<unknown>,
): Promise<VaultDocument> {
  const folder = dirname(d.path);
  const stem = basename(d.path).replace(/\.md$/, "");
  const ext = extOf(picked.name);
  const old = documentFilePath(d);
  let name = ext ? `${stem}.${ext}` : stem;
  let i = 2;
  while (`documents/${joinPath(folder, name)}` !== old && (await fs.exists(`documents/${joinPath(folder, name)}`)))
    name = `${stem}-${i++}${ext ? `.${ext}` : ""}`;
  if (old && (await fs.exists(old))) await discard(old);
  await picked.copyTo(`documents/${joinPath(folder, name)}`);
  const next = { ...d, fm: { ...d.fm, file: name } };
  await writeDocument(fs, next);
  return next;
}

/** Move a document (and its file) into another client's folder, keeping applications that list it pointed at it. */
export async function moveDocument(fs: VaultFS, d: VaultDocument, owner: string): Promise<VaultDocument> {
  if (documentOwner(d) === owner) return d;
  const moved = await moveWithFile(fs, "documents", d.path, d.fm.file, owner);
  const next: VaultDocument = { ...d, path: moved.path, fm: { ...d.fm, file: moved.file } };
  await writeDocument(fs, next);
  await renameGrantReferences(fs, "documents", d.path, next.path);
  return next;
}

export function documentPaths(d: VaultDocument): string[] {
  const f = documentFilePath(d);
  return [`documents/${d.path}`, ...(f ? [f] : [])];
}

export type ExpiryState = "expired" | "soon" | "ok" | "none";

/** "soon" means within `soonDays` (30 by default). */
export function expiryState(d: VaultDocument, today = new Date(), soonDays = 30): ExpiryState {
  const n = daysUntil(d.fm.expires, today);
  if (n === null) return "none";
  if (n < 0) return "expired";
  if (n <= soonDays) return "soon";
  return "ok";
}

export const SENSITIVE_NOTE =
  "These files are sensitive: tax returns, ID numbers, contracts. They live in the documents/ folder of your vault, so if your vault is in Dropbox, iCloud, Google Drive or OneDrive, anyone that folder is shared with can open them, and so can anyone with access to that account. Keep the vault in a folder only you can see, turn on two-step sign-in for that account, and think twice before sharing the whole vault. \"Share client folder\" never includes documents; full backups do.";
