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
