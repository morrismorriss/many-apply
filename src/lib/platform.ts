// Thin wrappers over Tauri APIs, with browser fallbacks for the web preview.
import type { VaultFS } from "./fs/types";
import { TauriFS } from "./fs/tauri";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  // recursive: true grants access to everything inside the folder (grants/, library/, .manyapply/…),
  // not just its top level. Without it, creating the vault's subfolders is refused.
  const r = await open({
    directory: true,
    recursive: true,
    multiple: false,
    canCreateDirectories: true,
    title: "Choose your Many Apply vault folder",
  });
  return typeof r === "string" ? r : null;
}

export async function pickFile(extensions: string[]): Promise<{ name: string; text: string } | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, filters: [{ name: "Files", extensions }] });
    if (typeof r !== "string") return null;
    const fs = await import("@tauri-apps/plugin-fs");
    return { name: r.split(/[\\/]/).pop() || r, text: await fs.readTextFile(r) };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((e) => "." + e).join(",");
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

/** A file the user picked or dropped, ready to be copied into the vault. */
export interface PickedFile {
  name: string;
  copyTo(fs: VaultFS, vaultPath: string): Promise<void>;
}

/** Files dropped onto the window (HTML drag and drop works in the desktop app too). */
export function droppedFiles(list: FileList | File[]): PickedFile[] {
  return [...list].map((f) => ({
    name: f.name,
    copyTo: async (fs, dest) => fs.writeBytes(dest, new Uint8Array(await f.arrayBuffer())),
  }));
}

/** Pick one or more binary files (images, video, audio…). Large files are copied on disk, not read into memory. */
export async function pickFiles(extensions: string[], title = "Choose files"): Promise<PickedFile[]> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: true, title, filters: [{ name: "Work samples", extensions }] });
    const paths = Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
    return paths.map((path) => ({
      name: path.split(/[\\/]/).pop() || path,
      copyTo: async (fs, dest) => {
        if (fs instanceof TauriFS) return fs.copyIn(path, dest);
        const pfs = await import("@tauri-apps/plugin-fs");
        await fs.writeBytes(dest, await pfs.readFile(path));
      },
    }));
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = extensions.map((e) => "." + e).join(",");
    input.onchange = () => resolve(droppedFiles(input.files ?? []));
    input.click();
  });
}

/** Open a file from the vault in the computer's default app (Preview, Photos, VLC, Word…). */
export async function openVaultFile(fs: VaultFS, path: string, mime = "") {
  if (isTauri && fs instanceof TauriFS) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_file", { path: fs.absPath(path) });
    return;
  }
  const blob = new Blob([new Uint8Array(await fs.readBytes(path))], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Save a file the user chooses the location of. Returns the saved path/name, or null if cancelled. */
export async function saveFile(defaultName: string, data: string | Uint8Array, mime = "text/plain"): Promise<string | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const ext = defaultName.split(".").pop() || "txt";
    const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    const fs = await import("@tauri-apps/plugin-fs");
    if (typeof data === "string") await fs.writeTextFile(path, data);
    else await fs.writeFile(path, data);
    return path;
  }
  const blob = new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return defaultName;
}

export async function openExternal(url: string) {
  if (!url) return;
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url });
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/** Readable text for any thrown value. Tauri commands reject with plain strings, not Error objects. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

// ---- Secrets: OS keychain in the desktop app, never in the vault. ----

const SECRET_FALLBACK = "manyapply.secret.";

export async function getSecret(key: string): Promise<string | null> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string | null>("secret_get", { key })) ?? null;
  }
  try {
    return sessionStorage.getItem(SECRET_FALLBACK + key);
  } catch {
    return null;
  }
}

export async function setSecret(key: string, value: string | null): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    if (value) await invoke("secret_set", { key, value });
    else await invoke("secret_delete", { key });
    return;
  }
  try {
    if (value) sessionStorage.setItem(SECRET_FALLBACK + key, value);
    else sessionStorage.removeItem(SECRET_FALLBACK + key);
  } catch {
    /* ignore */
  }
}

/** Read an RSS/Atom feed. In the desktop app this goes through Rust (GET only, size-capped). */
export async function fetchFeedText(url: string): Promise<string> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("fetch_feed", { url });
  }
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`The feed answered ${r.status}`);
    return await r.text();
  } catch (e) {
    // Most feeds block browser pages from reading them (CORS). The desktop app doesn't have that limit.
    throw new Error(`Couldn't read it in the browser preview (${errorText(e)}). Feeds load in the desktop app.`);
  }
}

/** fetch() that goes through the Tauri HTTP plugin in the desktop app (no CORS limits). */
export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isTauri) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(url, init);
  }
  return fetch(url, init);
}

// ---- Small app preferences (not vault data): last vault path, client filter. ----

export function getPref(key: string): string | null {
  try {
    return localStorage.getItem("manyapply.pref." + key);
  } catch {
    return null;
  }
}
export function setPref(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem("manyapply.pref." + key);
    else localStorage.setItem("manyapply.pref." + key, value);
  } catch {
    /* ignore */
  }
}

export async function copyToClipboard(text: string, html?: string) {
  try {
    if (html && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    }
  } catch {
    /* fall through */
  }
  await navigator.clipboard.writeText(text);
}
