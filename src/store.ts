import { create } from "zustand";
import type { VaultFS } from "./lib/fs/types";
import { MemoryFS } from "./lib/fs/memory";
import { TauriFS } from "./lib/fs/tauri";
import { errorText, getPref, isTauri, setPref } from "./lib/platform";
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
import type { Client, Funder, Grant, GrantFM, LibraryItem, ReportDate, Settings, Status, TimeEntry } from "./lib/model";
import { ME } from "./lib/model";
import * as todoist from "./lib/todoist";
import { calendarEvents, toICS } from "./lib/stats";
import { debounce, fmtMinutes, todayISO } from "./lib/util";
import { createDonor, writeDonor, type Donor } from "./lib/donors";
import { writeSample, type WorkSample } from "./lib/samples";
import { writeDocument, type VaultDocument } from "./lib/documents";

export type ScreenId =
  | "dashboard" | "research" | "pipeline" | "calendar" | "library" | "cv" | "documents" | "funders" | "clients" | "giving" | "reports" | "import" | "settings";

export type Route =
  | { screen: ScreenId }
  | { screen: "draft"; folder: string; draft: string }
  | { screen: "budget"; folder: string }
  | { screen: "libraryBudget"; file: string };

export type DrawerTarget =
  | { kind: "grant"; id: string }
  | { kind: "funder"; id: string }
  | { kind: "client"; id: string }
  | { kind: "donor"; id: string }
  | { kind: "library"; id: string }
  | { kind: "sample"; id: string }
  | { kind: "document"; id: string }
  | { kind: "feeds"; id: string };

interface Toast {
  id: number;
  text: string;
  tone?: "ok" | "warn" | "error";
  action?: { label: string; run: () => void };
}

/** A running timer. Kept in local prefs so it survives a reload or restart. */
export interface RunningTimer {
  folder: string;
  title: string;
  start: number; // ms since epoch
}

function loadTimer(): RunningTimer | null {
  try {
    const t = JSON.parse(getPref("timer") ?? "null");
    return t && typeof t.folder === "string" && typeof t.start === "number" ? t : null;
  } catch {
    return null;
  }
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
  timer: RunningTimer | null;

  startTimer(folder: string): Promise<void>;
  stopTimer(note?: string): Promise<void>;
  discardTimer(): void;
  logTime(folder: string, entry: TimeEntry): Promise<void>;
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
  saveDonor(d: Donor): Promise<void>;
  addDonor(name: string, client?: string): Promise<string>;
  /**
   * Move files to the vault's trash. The screen updates at once (via `removeLocal`); the files move right
   * after and the vault re-reads in the background. Offers Undo.
   */
  trashPaths(paths: string[], removeLocal: (d: VaultData) => VaultData, message?: string): Promise<void>;
  deleteDonor(slug: string): Promise<void>;
  saveLibrary(item: LibraryItem): Promise<void>;
  saveSample(s: WorkSample): Promise<void>;
  saveDocument(d: VaultDocument): Promise<void>;
  updateSettings(fn: (s: Settings) => Settings): Promise<void>;
  /** Run a function that writes files directly, then reload. */
  mutate<T>(fn: (fs: VaultFS) => Promise<T>): Promise<T>;
}

let unwatch: (() => void) | null = null;
let lastOwnWrite = 0;
let toastId = 0;

let reloadSeq = 0;

/** Note a write the app made itself, so the folder watcher doesn't reload for it. */
export function markWrite() {
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

  /** Open a vault. On failure, keep whatever was open before and report why. Returns true on success. */
  const attach = async (fs: VaultFS): Promise<boolean> => {
    const prev = { fs: get().fs, data: get().data };
    set({ loading: true, error: null });
    let data: VaultData;
    try {
      await initVault(fs);
      data = await loadVault(fs);
    } catch (e) {
      const why = errorText(e);
      set({
        ...prev,
        loading: false,
        error: /forbidden|not allowed|scope|denied/i.test(why)
          ? `Many Apply wasn't given access to that folder. Choose it again. (${why})`
          : `Couldn't open that folder: ${why}`,
      });
      return false;
    }
    unwatch?.();
    unwatch = null;
    set({ fs, data, loading: false, drawer: null, route: { screen: "dashboard" } });
    const saved = getPref("clientFilter") ?? "";
    if (saved && !data.clients.some((c) => c.slug === saved)) set({ clientFilter: "" });
    try {
      unwatch = await fs.watch(
        debounce(() => {
          if (Date.now() - lastOwnWrite < 1500) return;
          void get().reload();
        }, 500),
      );
    } catch (e) {
      // Watching is a nice-to-have; the vault still works without it.
      console.warn("Folder watching unavailable:", errorText(e));
    }
    writeIcs();
    return true;
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
    timer: loadTimer(),

    async startTimer(folder) {
      if (get().timer) await get().stopTimer();
      const g = get().data?.grants.find((x) => x.folder === folder);
      const timer = { folder, title: g?.fm.title ?? folder, start: Date.now() };
      setPref("timer", JSON.stringify(timer));
      set({ timer });
    },
    async stopTimer(note = "") {
      const t = get().timer;
      if (!t) return;
      setPref("timer", null);
      set({ timer: null });
      const minutes = Math.max(1, Math.round((Date.now() - t.start) / 60000));
      const grants = get().data?.grants ?? [];
      // The folder is renamed when a title or deadline changes, so fall back to the title.
      const g = grants.find((x) => x.folder === t.folder) ?? grants.find((x) => x.fm.title === t.title);
      if (!g) {
        get().toast(`Couldn't find "${t.title}" to log ${minutes} min`, "warn");
        return;
      }
      await get().logTime(g.folder, { date: todayISO(new Date(t.start)), minutes, note });
      get().toast(`Logged ${fmtMinutes(minutes)} on ${g.fm.title}`);
    },
    discardTimer() {
      setPref("timer", null);
      set({ timer: null });
    },
    async logTime(folder, entry) {
      await get().updateGrant(folder, (g) => ({ ...g, fm: { ...g.fm, time_log: [...g.fm.time_log, entry] } }));
    },

    async openVault(path) {
      if (!path) return;
      if (!isTauri) return get().openDemo();
      if (await attach(new TauriFS(path))) setPref("vault", path);
      else if (get().data) get().toast(get().error ?? "Couldn't open that folder", "error");
    },
    async openDemo(reset = false) {
      if (reset) MemoryFS.reset();
      const { files, staleDrafts } = sampleVault();
      const fs = new MemoryFS(files);
      const old = Date.now() - 10 * 86400000;
      for (const p of staleDrafts) fs.touch(p, old);
      if ((await attach(fs)) && !isTauri) setPref("vault", "demo");
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
      // When reloads overlap, only the newest result is kept, so a slow older read can't undo a newer change.
      const seq = ++reloadSeq;
      const data = await loadVault(fs);
      if (seq === reloadSeq && get().fs === fs) set({ data });
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
      if (get().drawer?.id === folder) set({ drawer: null });
      await get().trashPaths([`grants/${folder}`], (d) => ({ ...d, grants: d.grants.filter((g) => g.folder !== folder) }));
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
    async saveDonor(d) {
      markWrite();
      await writeDonor(get().fs!, d);
      const data = get().data!;
      set({ data: { ...data, donors: data.donors.map((x) => (x.slug === d.slug ? d : x)) } });
    },
    async addDonor(name, client) {
      markWrite();
      const slug = await createDonor(get().fs!, name, client);
      await get().reload();
      return slug;
    },
    async deleteDonor(slug) {
      if (get().drawer?.id === slug) set({ drawer: null });
      await get().trashPaths([`donors/${slug}.md`], (d) => ({ ...d, donors: d.donors.filter((x) => x.slug !== slug) }));
    },
    async trashPaths(paths, removeLocal, message = "Moved to trash") {
      const fs = get().fs;
      if (!fs) return;
      const before = get().data;
      if (before) set({ data: removeLocal(before) });
      markWrite();
      const moved: [string, string][] = [];
      try {
        for (const p of paths) if (await fs.exists(p)) moved.push([p, await trash(fs, p)]);
      } catch (e) {
        get().toast(`Couldn't move it to trash: ${errorText(e)}`, "error");
        await get().reload();
        return;
      }
      get().toast(message, "ok", {
        label: "Undo",
        run: async () => {
          markWrite();
          for (const [p, dest] of [...moved].reverse()) await fs.rename(dest, p);
          await get().reload();
          writeIcs();
        },
      });
      void get().reload().then(() => {
        markWrite();
        writeIcs();
      });
    },
    async saveLibrary(item) {
      markWrite();
      await writeLibrary(get().fs!, item);
      const d = get().data!;
      set({ data: { ...d, library: d.library.map((x) => (x.path === item.path ? item : x)) } });
    },
    async saveSample(sample) {
      markWrite();
      await writeSample(get().fs!, sample);
      const d = get().data!;
      set({ data: { ...d, samples: d.samples.map((x) => (x.path === sample.path ? sample : x)) } });
    },
    async saveDocument(doc) {
      markWrite();
      await writeDocument(get().fs!, doc);
      const d = get().data!;
      set({ data: { ...d, documents: d.documents.map((x) => (x.path === doc.path ? doc : x)) } });
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
