import * as fs from "@tauri-apps/plugin-fs";
import type { Entry, VaultFS } from "./types";

/** Real filesystem access through the Tauri fs plugin. `root` is an absolute folder path. */
export class TauriFS implements VaultFS {
  readonly kind = "tauri" as const;
  constructor(readonly root: string) {}

  private abs(p: string) {
    const sep = this.root.includes("\\") && !this.root.includes("/") ? "\\" : "/";
    const rel = sep === "\\" ? p.replace(/\//g, "\\") : p;
    return rel ? `${this.root.replace(/[\\/]+$/, "")}${sep}${rel}` : this.root;
  }

  async readText(p: string) {
    return fs.readTextFile(this.abs(p));
  }
  async writeText(p: string, text: string) {
    await this.ensureParent(p);
    await fs.writeTextFile(this.abs(p), text);
  }
  async readBytes(p: string) {
    return fs.readFile(this.abs(p));
  }
  async writeBytes(p: string, data: Uint8Array) {
    await this.ensureParent(p);
    await fs.writeFile(this.abs(p), data);
  }
  async exists(p: string) {
    return fs.exists(this.abs(p));
  }
  async mkdir(p: string) {
    await fs.mkdir(this.abs(p), { recursive: true });
  }
  private async ensureParent(p: string) {
    const i = p.lastIndexOf("/");
    if (i > 0) await fs.mkdir(this.abs(p.slice(0, i)), { recursive: true });
  }

  async list(dir: string): Promise<Entry[]> {
    const out: Entry[] = [];
    const walk = async (rel: string) => {
      let entries: fs.DirEntry[];
      try {
        entries = await fs.readDir(this.abs(rel));
      } catch {
        return;
      }
      for (const e of entries) {
        const child = rel ? `${rel}/${e.name}` : e.name;
        let mtime = 0;
        if (e.isFile) {
          try {
            const st = await fs.stat(this.abs(child));
            mtime = st.mtime ? new Date(st.mtime).getTime() : 0;
          } catch {
            /* ignore */
          }
        }
        out.push({ path: child, isDir: e.isDirectory, mtime });
        if (e.isDirectory && !(rel === "" && e.name === ".git")) await walk(child);
      }
    };
    await walk(dir);
    return out;
  }

  async rename(from: string, to: string) {
    await this.ensureParent(to);
    await fs.rename(this.abs(from), this.abs(to));
  }
  async remove(p: string) {
    await fs.remove(this.abs(p), { recursive: true });
  }

  async watch(onChange: (paths: string[]) => void) {
    const rootNorm = this.root.replace(/\\/g, "/").replace(/\/+$/, "");
    const unwatch = await fs.watch(
      this.root,
      (event) => {
        const paths = (event.paths ?? [])
          .map((p) => p.replace(/\\/g, "/"))
          .map((p) => (p.startsWith(rootNorm) ? p.slice(rootNorm.length + 1) : p))
          .filter((p) => !p.startsWith(".manyapply/"));
        if (paths.length) onChange(paths);
      },
      { recursive: true, delayMs: 400 },
    );
    return () => unwatch();
  }
}
