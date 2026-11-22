import { create } from "zustand";
import type { VaultFS } from "./lib/fs/types";
import { MemoryFS } from "./lib/fs/memory";
import { TauriFS } from "./lib/fs/tauri";
import { getPref, isTauri, setPref } from "./lib/platform";
import { sampleVault } from "./lib/sample";
import {
  createGrant,
  ensureClient,
  initVault,
  loadVault,
  saveGrant,
  saveSettings,
  trash,
  withStatus,
  writeClient,
  writeFunder,
  writeLibrary,
  type VaultData,
} from "./lib/vault";
import type { Client, Funder, Grant, GrantFM, LibraryItem, ReportDate, Settings, Status } from "./lib/model";
import { ME } from "./lib/model";
import * as todoist from "./lib/todoist";
import { calendarEvents, toICS } from "./lib/stats";
import { debounce } from "./lib/util";

export type ScreenId =
  | "dashboard" | "research" | "pipeline" | "calendar" | "library" | "funders" | "clients" | "reports" | "import" | "settings";

export type Route =
  | { screen: ScreenId }
  | { screen: "draft"; folder: string; draft: string }
  | { screen: "budget"; folder: string };

export type DrawerTarget =
  | { kind: "grant"; id: string }
  | { kind: "funder"; id: string }
  | { kind: "client"; id: string }
  | { kind: "library"; id: string };

interface Toast {
  id: number;
  text: string;
  tone?: "ok" | "warn" | "error";
  action?: { label: string; run: () => void };
}

interface State {
  fs: VaultFS | null;
  data: VaultData | null;
  loading: boolean;
  error: string | null;
  route: Route;
  drawer: DrawerTarget | null;
  drawerPinned: boolean;
  drawerExpanded: boolean;
  clientFilter: string; // "" = all clients
  toasts: Toast[];

  openVault(path: string | null): Promise<void>;
  openDemo(reset?: boolean): Promise<void>;
  closeVault(): void;
  reload(): Promise<void>;
  go(route: Route): void;
  openDrawer(t: DrawerTarget): void;
  closeDrawer(): void;
  setDrawer(p: { pinned?: boolean; expanded?: boolean }): void;
  setClientFilter(c: string): void;
  toast(text: string, tone?: Toast["tone"], action?: Toast["action"]): void;
  dismissToast(id: number): void;

  addGrant(partial: Partial<GrantFM>, body?: string): Promise<Grant>;
  updateGrant(folder: string, fn: (g: Grant) => Grant): Promise<Grant | null>;
  setStatus(folder: string, status: Status): Promise<void>;
  createPlanningTasks(folder: string, explicit?: boolean): Promise<void>;
  addReport(folder: string, r: ReportDate): Promise<void>;
  deleteGrant(folder: string): Promise<void>;
  saveFunder(f: Funder): Promise<void>;
  saveClient(c: Client): Promise<void>;
  addClient(name: string): Promise<string>;
  saveLibrary(item: LibraryItem): Promise<void>;
  updateSettings(fn: (s: Settings) => Settings): Promise<void>;
  /** Run a function that writes files directly, then reload. */
  mutate<T>(fn: (fs: VaultFS) => Promise<T>): Promise<T>;
}

let unwatch: (() => void) | null = null;
let lastOwnWrite = 0;
let toastId = 0;

function markWrite() {
  lastOwnWrite = Date.now();
}

export const useStore = create<State>((set, get) => {
  const replaceGrant = (oldFolder: string, g: Grant) => {
    const d = get().data;
    if (!d) return;
    const grants = d.grants.filter((x) => x.folder !== oldFolder && x.folder !== g.folder);
    grants.push(g);
    grants.sort((a, b) => a.folder.localeCompare(b.folder));
    const drawer = get().drawer;
    set({
      data: { ...d, grants },
      drawer: drawer?.kind === "grant" && drawer.id === oldFolder ? { kind: "grant", id: g.folder } : drawer,
      route: (() => {
        const r = get().route;
        if ((r.screen === "draft" || r.screen === "budget") && r.folder === oldFolder) return { ...r, folder: g.folder };
        return r;
      })(),
    });
  };

  const writeIcs = debounce(async () => {
    const { fs, data } = get();
    if (!fs || !data?.settings.keepIcsUpdated) return;
    markWrite();
    await fs.writeText(".manyapply/calendar.ics", toICS(calendarEvents(data.grants)));
  }, 1500);

  const withTodoist = async (fn: (token: string, s: Settings) => Promise<void>) => {
    const s = get().data?.settings;
    if (!s?.todoist.enabled) return;
    const token = await todoist.getToken();
    if (!token) return;
    try {
      await fn(token, s);
    } catch (e) {
      get().toast(`Todoist: ${(e as Error).message}`, "warn");
    }
  };

  const projectFor = async (token: string, s: Settings, clientSlug: string) => {
    const client = get().data?.clients.find((c) => c.slug === clientSlug);
    const r = await todoist.projectFor(token, s, client);
    if (r.updatedClient) await get().saveClient(r.updatedClient);
    return r.projectId;
  };

  const attach = async (fs: VaultFS) => {
    unwatch?.();
    unwatch = null;
    set({ fs, loading: true, error: null });
    try {
      await initVault(fs);
      const data = await loadVault(fs);
      set({ data, loading: false });
      const saved = getPref("clientFilter") ?? "";
      if (saved && !data.clients.some((c) => c.slug === saved)) set({ clientFilter: "" });
      unwatch = await fs.watch(
        debounce(() => {
          if (Date.now() - lastOwnWrite < 1500) return;
          void get().reload();
        }, 500),
      );
      writeIcs();
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  };

  return {
    fs: null,
    data: null,
    loading: false,
    error: null,
    route: { screen: "dashboard" },
    drawer: null,
    drawerPinned: getPref("drawerPinned") === "1",
    drawerExpanded: false,
    clientFilter: getPref("clientFilter") ?? "",
    toasts: [],

    async openVault(path) {
      if (!path) return;
      if (!isTauri) return get().openDemo();
      setPref("vault", path);
      await attach(new TauriFS(path));
    },
    async openDemo(reset = false) {
      if (reset) MemoryFS.reset();
      const { files, staleDrafts } = sampleVault();
      const fs = new MemoryFS(files);
      const old = Date.now() - 10 * 86400000;
      for (const p of staleDrafts) fs.touch(p, old);
      if (!isTauri) setPref("vault", "demo");
      await attach(fs);
    },
    closeVault() {
      unwatch?.();
      unwatch = null;
      setPref("vault", null);
      set({ fs: null, data: null, drawer: null, route: { screen: "dashboard" } });
    },
    async reload() {
      const fs = get().fs;
      if (!fs) return;
      const data = await loadVault(fs);
      set({ data });
    },
    go(route) {
      set({ route });
      if (!get().drawerPinned) set({ drawer: null, drawerExpanded: false });
      else set({ drawerExpanded: false });
    },
    openDrawer(t) {
      set({ drawer: t });
    },
    closeDrawer() {
      set({ drawer: null, drawerExpanded: false });
    },
    setDrawer(p) {
      if (p.pinned !== undefined) setPref("drawerPinned", p.pinned ? "1" : "0");
      set({ drawerPinned: p.pinned ?? get().drawerPinned, drawerExpanded: p.expanded ?? get().drawerExpanded });
    },
    setClientFilter(c) {
      setPref("clientFilter", c);
      set({ clientFilter: c });
    },
    toast(text, tone = "ok", action) {
      const id = ++toastId;
      set({ toasts: [...get().toasts, { id, text, tone, action }] });
      setTimeout(() => get().dismissToast(id), action ? 8000 : 4000);
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },

    async addGrant(partial, body) {
      const fs = get().fs!;
      markWrite();
      if (partial.client && partial.client !== ME && !get().data?.clients.some((c) => c.slug === partial.client)) {
        await ensureClient(fs, partial.client);
      }
      const g = await createGrant(fs, { client: get().clientFilter || ME, ...partial }, body);
      await get().reload();
      if (g.fm.status === "planning") await get().setStatus(g.folder, "planning");
      writeIcs();
      return g;
    },

    async updateGrant(folder, fn) {
      const { fs, data } = get();
      const g = data?.grants.find((x) => x.folder === folder);
      if (!fs || !g) return null;
      markWrite();
      const next = await saveGrant(fs, fn(g));
      replaceGrant(folder, next);
      writeIcs();
      return next;
    },

    async setStatus(folder, status) {
      const g0 = get().data?.grants.find((x) => x.folder === folder);
      if (!g0) return;
      const wasPlanning = g0.fm.status === "planning";
      const g = g0.fm.status === status ? g0 : await get().updateGrant(folder, (g) => ({ ...g, fm: withStatus(g.fm, status) }));
      if (!g) return;
      if (status === "planning" && !wasPlanning && g.fm.todoist_task_ids.length === 0) await get().createPlanningTasks(g.folder);
    },

    async createPlanningTasks(folder, explicit = false) {
      const g = get().data?.grants.find((x) => x.folder === folder);
      if (!g) return;
      if (!g.fm.deadline) {
        if (explicit) get().toast("Add a deadline first, so tasks have a due date.", "warn");
        return;
      }
      if (explicit && !(await todoist.getToken())) {
        get().toast("Connect Todoist in Settings first.", "warn");
        return;
      }
      await withTodoist(async (token, s) => {
        const pid = await projectFor(token, s, g.fm.client);
        const ids = await todoist.tasksForPlanning(token, s, g, pid);
        if (ids.length) {
          await get().updateGrant(g.folder, (x) => ({ ...x, fm: { ...x.fm, todoist_task_ids: [...x.fm.todoist_task_ids, ...ids] } }));
          get().toast(`Added ${ids.length} Todoist task${ids.length === 1 ? "" : "s"}`);
        }
      });
    },

    async addReport(folder, r) {
      let g = await get().updateGrant(folder, (g) => ({ ...g, fm: { ...g.fm, reports: [...g.fm.reports, r] } }));
      if (!g || !r.due) return;
      await withTodoist(async (token, s) => {
        const pid = await projectFor(token, s, g!.fm.client);
        const ids = await todoist.tasksForReport(token, s, g!, r, pid);
        if (!ids.length) return;
        g = await get().updateGrant(folder, (x) => {
          const reports = [...x.fm.reports];
          const i = reports.length - 1;
          reports[i] = { ...reports[i], todoist_task_id: ids[0] };
          return { ...x, fm: { ...x.fm, reports, todoist_task_ids: [...x.fm.todoist_task_ids, ...ids] } };
        });
        get().toast("Added the report to Todoist");
      });
    },

    async deleteGrant(folder) {
      const fs = get().fs!;
      markWrite();
      const dest = await trash(fs, `grants/${folder}`);
      if (get().drawer?.id === folder) set({ drawer: null });
      await get().reload();
      writeIcs();
      get().toast("Moved to trash", "ok", {
        label: "Undo",
        run: async () => {
          markWrite();
          await fs.rename(dest, `grants/${folder}`);
          await get().reload();
        },
      });
    },

    async saveFunder(f) {
      markWrite();
      await writeFunder(get().fs!, f);
      await get().reload();
    },
    async saveClient(c) {
      markWrite();
      await writeClient(get().fs!, c);
      await get().reload();
    },
    async addClient(name) {
      markWrite();
      const r = await ensureClient(get().fs!, name);
      await get().reload();
      return r.slug;
    },
    async saveLibrary(item) {
      markWrite();
      await writeLibrary(get().fs!, item);
      const d = get().data!;
      set({ data: { ...d, library: d.library.map((x) => (x.path === item.path ? item : x)) } });
    },
    async updateSettings(fn) {
      const d = get().data!;
      const settings = fn(d.settings);
      set({ data: { ...d, settings } });
      markWrite();
      await saveSettings(get().fs!, settings);
      if (settings.keepIcsUpdated) writeIcs();
    },
    async mutate(fn) {
      markWrite();
      const r = await fn(get().fs!);
      await get().reload();
      markWrite();
      writeIcs();
      return r;
    },
  };
});

// ---- Selectors / helpers

export function useFiltered<T extends { fm: { client: string } }>(xs: T[]): T[] {
  const c = useStore((s) => s.clientFilter);
  return c ? xs.filter((x) => x.fm.client === c) : xs;
}

export function useGrants(): Grant[] {
  const grants = useStore((s) => s.data?.grants ?? EMPTY);
  return useFiltered(grants);
}
const EMPTY: Grant[] = [];

export function useLookups() {
  const data = useStore((s) => s.data);
  const funders = new Map((data?.funders ?? []).map((f) => [f.slug, f]));
  const clients = new Map((data?.clients ?? []).map((c) => [c.slug, c]));
  return {
    funderName: (slug: string) => funders.get(slug)?.fm.name ?? (slug ? slug.replace(/-/g, " ") : ""),
    funder: (slug: string) => funders.get(slug),
    client: (slug: string) => clients.get(slug),
    clientName: (slug: string) => (slug === ME ? "Me" : clients.get(slug)?.fm.name ?? slug),
  };
}
