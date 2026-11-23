export interface Entry {
  /** Path relative to the vault root, using "/" separators. */
  path: string;
  isDir: boolean;
  mtime: number;
}

/** Everything the app needs from a filesystem. All paths are relative to the vault root. */
export interface VaultFS {
  readonly kind: "tauri" | "memory";
  readonly root: string;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** Recursive listing of everything under `dir` ("" for the whole vault). */
  list(dir: string): Promise<Entry[]>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Watch the vault for outside edits. Returns an unsubscribe function. */
  watch(onChange: (paths: string[]) => void): Promise<() => void>;
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== "" && p !== undefined)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\/(?=.)/, "");
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/** True when `s` can be one segment of a vault path: not empty, not "." or "..", no separators or control characters. */
export function isSafeSegment(s: string): boolean {
  return !!s && s !== "." && s !== ".." && !/[/\\\0-\x1f]/.test(s);
}

/** True when `p` is a relative path made only of safe segments. */
export function isSafeRelPath(p: string): boolean {
  return !!p && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && p.split("/").every(isSafeSegment);
}

/** A file name that can be joined into a folder, or "" when it could escape it. */
export function safeFileName(name: string): string {
  const s = (name ?? "").trim();
  return isSafeSegment(s) ? s : "";
}

/** A draft path ("drafts/<safe>.md"), or "" when it is not one. */
export function safeDraftPath(draft: string): string {
  const d = (draft ?? "").trim();
  return d.startsWith("drafts/") && /\.md$/i.test(d) && isSafeRelPath(d) ? d : "";
}
