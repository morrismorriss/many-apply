import type { Entry, VaultFS } from "./types";
import { dirname } from "./types";

interface Node {
  data: string | Uint8Array | null; // null = directory
  mtime: number;
}

const STORAGE_KEY = "manyapply.demo-vault.v1";

/**
 * In-memory vault used when running in a plain browser (the web preview and tests).
 * Text files are persisted to localStorage so the demo survives a reload.
 */
export class MemoryFS implements VaultFS {
  readonly kind = "memory" as const;
  readonly root = "Demo vault (browser)";
  private files = new Map<string, Node>();
  private persist: boolean;

  constructor(seed?: Record<string, string>, persist = true) {
    this.persist = persist && typeof localStorage !== "undefined";
    let loaded = false;
    if (this.persist) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const obj = JSON.parse(raw) as Record<string, { t: string | null; m: number }>;
          for (const [p, n] of Object.entries(obj)) this.files.set(p, { data: n.t, mtime: n.m });
          loaded = true;
        }
      } catch {
        /* storage blocked: start fresh */
      }
    }
    if (!loaded && seed) {
      const now = Date.now();
      for (const [p, t] of Object.entries(seed)) {
        this.ensureDirs(p);
        this.files.set(p, { data: t, mtime: now });
      }
    }
  }

  static reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Back-date a file's modified time (used by the demo seed). */
  touch(path: string, mtime: number) {
    const n = this.files.get(path);
    if (n) n.mtime = mtime;
  }

  private save() {
    if (!this.persist) return;
    try {
      const obj: Record<string, { t: string | null; m: number }> = {};
      for (const [p, n] of this.files) {
        if (n.data instanceof Uint8Array) continue; // binaries are session-only
        obj[p] = { t: n.data, m: n.mtime };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      /* quota or blocked */
    }
  }

  private ensureDirs(path: string) {
    let d = dirname(path);
    while (d) {
      if (!this.files.has(d)) this.files.set(d, { data: null, mtime: Date.now() });
      d = dirname(d);
    }
  }

  async readText(path: string) {
    const n = this.files.get(path);
    if (!n || n.data === null) throw new Error(`Not found: ${path}`);
    return typeof n.data === "string" ? n.data : new TextDecoder().decode(n.data);
  }
  async writeText(path: string, text: string) {
    this.ensureDirs(path);
    this.files.set(path, { data: text, mtime: Date.now() });
    this.save();
  }
  async readBytes(path: string) {
    const n = this.files.get(path);
    if (!n || n.data === null) throw new Error(`Not found: ${path}`);
    return typeof n.data === "string" ? new TextEncoder().encode(n.data) : n.data;
  }
  async writeBytes(path: string, data: Uint8Array) {
    this.ensureDirs(path);
    this.files.set(path, { data, mtime: Date.now() });
    this.save();
  }
  async exists(path: string) {
    return this.files.has(path);
  }
  async mkdir(path: string) {
    this.ensureDirs(path + "/x");
    this.save();
  }
  async list(dir: string): Promise<Entry[]> {
    const prefix = dir ? dir + "/" : "";
    const out: Entry[] = [];
    // Like the desktop app: the trash, import logs and git history aren't walked unless asked for by name.
    const skipped = [".git", ".manyapply/trash", ".manyapply/imports", "node_modules"].filter((d) => !dir.startsWith(d));
    for (const [p, n] of this.files) {
      if (!p.startsWith(prefix) || skipped.some((d) => p === d || p.startsWith(d + "/"))) continue;
      out.push({ path: p, isDir: n.data === null, mtime: n.mtime });
    }
    return out;
  }
  async rename(from: string, to: string) {
    const moves: [string, Node][] = [];
    for (const [p, n] of this.files) {
      if (p === from || p.startsWith(from + "/")) moves.push([p, n]);
    }
    if (!moves.length) throw new Error(`Not found: ${from}`);
    for (const [p] of moves) this.files.delete(p);
    this.ensureDirs(to);
    for (const [p, n] of moves) this.files.set(to + p.slice(from.length), n);
    this.save();
  }
  async remove(path: string) {
    for (const p of [...this.files.keys()]) {
      if (p === path || p.startsWith(path + "/")) this.files.delete(p);
    }
    this.save();
  }
  async watch() {
    return () => {};
  }
}
