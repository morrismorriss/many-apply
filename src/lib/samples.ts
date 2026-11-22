// Work samples: images, video, audio, documents and links you send with applications.
// Each sample is a markdown file in samples/<owner>/ (owner = "shared" or a client's slug),
// with the media file it describes saved next to it. Like the Library, one client's samples
// are never offered for another client's application.
import { moveWithFile, renameGrantReferences } from "./move";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import { basename, dirname, joinPath, type VaultFS } from "./fs/types";
import { asArray, slugify, str } from "./util";
import { ME } from "./model";

export const SAMPLE_KINDS = ["image", "video", "audio", "document", "link"] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

export const SAMPLE_KIND_LABEL: Record<SampleKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  document: "Document",
  link: "Link",
};

const EXT: Record<Exclude<SampleKind, "link">, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "tif", "tiff", "bmp", "svg"],
  video: ["mp4", "mov", "m4v", "webm", "mkv", "avi"],
  audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "aif", "aiff"],
  document: ["pdf", "doc", "docx", "pages", "txt", "rtf", "odt", "key", "ppt", "pptx"],
};

/** Every extension the "Add work sample" picker accepts. Keep in step with OPENABLE in src-tauri/src/lib.rs. */
export const SAMPLE_EXTENSIONS = Object.values(EXT).flat();


const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  svg: "image/svg+xml", bmp: "image/bmp",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg",
  pdf: "application/pdf",
};

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function kindForFile(name: string): SampleKind {
  const ext = extOf(name);
  for (const k of ["image", "video", "audio", "document"] as const) if (EXT[k].includes(ext)) return k;
  return "document";
}

/** A best guess at the kind of a link, from well-known hosts. */
export function kindForUrl(url: string): SampleKind {
  const u = url.toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(u)) return "video";
  if (/soundcloud\.com|bandcamp\.com|spotify\.com|music\.apple\.com/.test(u)) return "audio";
  if (/flickr\.com|instagram\.com/.test(u)) return "image";
  return "link";
}

/** The MIME type to play or show a file with in the app, or "" if the app can't preview it. */
export function previewMime(name: string): string {
  return MIME[extOf(name)] ?? "";
}

export interface WorkSample {
  /** Path relative to samples/, e.g. "me/river-suite-excerpt.md" */
  path: string;
  fm: {
    title: string;
    kind: SampleKind;
    /** Media file name, in the same folder as the .md file. Empty for a link-only sample. */
    file: string;
    /** A link instead of (or as well as) a file: Vimeo, YouTube, SoundCloud, a portfolio page… */
    url: string;
    year: string;
    medium: string;
    /** Dimensions for visual work, running time for video and audio. */
    dimensions: string;
    duration: string;
    credits: string;
    tags: string[];
    used_in: string[];
    [extra: string]: unknown;
  };
  /** Description or caption, as it would appear on an application's work sample list. */
  body: string;
}

const SAMPLE_ORDER = ["title", "kind", "file", "url", "year", "medium", "dimensions", "duration", "credits", "tags", "used_in"];

export function sampleOwner(s: { path: string }): string {
  return s.path.split("/")[0];
}

/** Vault-relative path of a sample's media file, or "" if it has none. */
export function sampleFilePath(s: WorkSample): string {
  return s.fm.file ? `samples/${joinPath(dirname(s.path), s.fm.file)}` : "";
}

/** Samples a client may send: their own, then Shared. Never another client's. */
export function samplesForClient(samples: WorkSample[], client: string): WorkSample[] {
  const own = samples.filter((s) => sampleOwner(s) === (client || ME));
  const shared = samples.filter((s) => sampleOwner(s) === "shared");
  return [...own, ...shared];
}

export function searchSamples(samples: WorkSample[], query: string): WorkSample[] {
  const q = query.trim().toLowerCase();
  if (!q) return samples;
  return samples.filter(
    (s) =>
      s.fm.title.toLowerCase().includes(q) ||
      s.fm.medium.toLowerCase().includes(q) ||
      s.fm.year.includes(q) ||
      s.body.toLowerCase().includes(q) ||
      s.fm.tags.some((t) => t.includes(q)),
  );
}

/** One line for an application's work sample list: Title (2025). Medium, 24 x 36 in. 3:20. */
export function sampleCaption(s: WorkSample): string {
  const end = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);
  const head = s.fm.year ? `${s.fm.title} (${s.fm.year})` : s.fm.title;
  const rest = [s.fm.medium, s.fm.dimensions, s.fm.duration].map((x) => x.trim()).filter(Boolean).join(", ");
  return rest ? `${end(head)} ${end(rest)}` : end(head);
}

export function normalizeSample(raw: Record<string, unknown>, path: string, body: string): WorkSample {
  const file = str(raw.file).trim();
  const url = str(raw.url).trim();
  const kind = SAMPLE_KINDS.includes(raw.kind as SampleKind)
    ? (raw.kind as SampleKind)
    : file
      ? kindForFile(file)
      : kindForUrl(url);
  return {
    path,
    fm: {
      ...raw,
      title: str(raw.title) || basename(path).replace(/\.md$/, "").replace(/-/g, " "),
      kind,
      file,
      url,
      year: str(raw.year).trim(),
      medium: str(raw.medium),
      dimensions: str(raw.dimensions),
      duration: str(raw.duration),
      credits: str(raw.credits),
      tags: asArray(raw.tags),
      used_in: asArray(raw.used_in),
    },
    body,
  };
}

export async function readSample(fs: VaultFS, p: string): Promise<WorkSample> {
  const { data, body } = parseFrontmatter(await fs.readText(p));
  return normalizeSample(data, p.replace(/^samples\//, ""), body);
}

export async function writeSample(fs: VaultFS, s: WorkSample) {
  await fs.writeText(`samples/${s.path}`, stringifyFrontmatter(s.fm, s.body, SAMPLE_ORDER));
}

/** A free name in samples/<folder>/ for both the .md file and its media file. */
async function freeBase(fs: VaultFS, folder: string, title: string, ext: string): Promise<string> {
  const stem = slugify(title) || "sample";
  let base = stem;
  let i = 2;
  const taken = async (b: string) =>
    (await fs.exists(`samples/${folder}/${b}.md`)) || (!!ext && (await fs.exists(`samples/${folder}/${b}.${ext}`)));
  while (await taken(base)) base = `${stem}-${i++}`;
  return base;
}

export interface NewSample {
  title: string;
  url?: string;
  /** The picked file. `copyTo` writes it to the vault-relative path it's given. */
  file?: { name: string; copyTo: (vaultPath: string) => Promise<void> };
}

export async function createSample(fs: VaultFS, folder: string, n: NewSample): Promise<WorkSample> {
  await fs.mkdir(`samples/${folder}`);
  const ext = n.file ? extOf(n.file.name) : "";
  const base = await freeBase(fs, folder, n.title, ext);
  let file = "";
  if (n.file) {
    file = ext ? `${base}.${ext}` : base;
    await n.file.copyTo(`samples/${folder}/${file}`);
  }
  const s = normalizeSample({ title: n.title, file, url: n.url ?? "", tags: [], used_in: [] }, `${folder}/${base}.md`, "");
  await writeSample(fs, s);
  return s;
}

/** Copy a sample (and its file) into another owner's folder. */
export async function duplicateSample(fs: VaultFS, s: WorkSample, toFolder: string): Promise<WorkSample> {
  const src = sampleFilePath(s);
  return createSample(fs, toFolder, {
    title: s.fm.title,
    url: s.fm.url,
    file: src
      ? { name: s.fm.file, copyTo: async (dest) => fs.writeBytes(dest, await fs.readBytes(src)) }
      : undefined,
  }).then(async (copy) => {
    const next: WorkSample = { ...copy, fm: { ...s.fm, file: copy.fm.file, used_in: [] }, body: s.body };
    await writeSample(fs, next);
    return next;
  });
}

/** Move a sample (and its file) to another owner's folder, keeping applications that list it pointed at it. */
export async function moveSample(fs: VaultFS, s: WorkSample, owner: string): Promise<WorkSample> {
  if (sampleOwner(s) === owner) return s;
  const moved = await moveWithFile(fs, "samples", s.path, s.fm.file, owner);
  const next: WorkSample = { ...s, path: moved.path, fm: { ...s.fm, file: moved.file } };
  await writeSample(fs, next);
  await renameGrantReferences(fs, "work_samples", s.path, next.path);
  return next;
}

/** Paths (vault-relative) to move to trash when a sample is deleted. */
export function samplePaths(s: WorkSample): string[] {
  const f = sampleFilePath(s);
  return [`samples/${s.path}`, ...(f ? [f] : [])];
}

/** Record that a sample was sent with a grant. */
export async function recordSampleUsedIn(fs: VaultFS, s: WorkSample, grantFolder: string): Promise<WorkSample> {
  if (s.fm.used_in.includes(grantFolder)) return s;
  const next = { ...s, fm: { ...s.fm, used_in: [...s.fm.used_in, grantFolder] } };
  await writeSample(fs, next);
  return next;
}

export async function removeSampleUsedIn(fs: VaultFS, s: WorkSample, grantFolder: string): Promise<WorkSample> {
  if (!s.fm.used_in.includes(grantFolder)) return s;
  const next = { ...s, fm: { ...s.fm, used_in: s.fm.used_in.filter((u) => u !== grantFolder) } };
  await writeSample(fs, next);
  return next;
}

/**
 * Upload a file to an existing sample (or replace its file). The old file goes to trash via `discard`.
 * The kind follows the new file, unless it was set to something that still fits.
 */
export async function setSampleFile(
  fs: VaultFS,
  s: WorkSample,
  picked: { name: string; copyTo: (vaultPath: string) => Promise<void> },
  discard: (vaultPath: string) => Promise<unknown>,
): Promise<WorkSample> {
  const folder = dirname(s.path);
  const stem = basename(s.path).replace(/\.md$/, "");
  const ext = extOf(picked.name);
  const old = sampleFilePath(s);
  let name = ext ? `${stem}.${ext}` : stem;
  let i = 2;
  // Don't overwrite an unrelated file that happens to have the name we want.
  while (`samples/${joinPath(folder, name)}` !== old && (await fs.exists(`samples/${joinPath(folder, name)}`)))
    name = `${stem}-${i++}${ext ? `.${ext}` : ""}`;
  const dest = `samples/${joinPath(folder, name)}`;
  if (old && (await fs.exists(old))) await discard(old);
  await picked.copyTo(dest);
  const kind = kindForFile(picked.name);
  const next: WorkSample = { ...s, fm: { ...s.fm, file: name, kind } };
  await writeSample(fs, next);
  return next;
}
