// Receives grants from the Chrome extension through the desktop app's local listener (127.0.0.1 only).
import { errorText, isTauri } from "./platform";
import { useStore } from "../store";
import { ME, STATUSES, type Status } from "./model";
import { defaultGrantBody, setBodySection } from "./vault";
import { slugify } from "./util";

export const BRIDGE_PORT = 47321;

export interface ExtensionGrant {
  title: string;
  url?: string;
  funder?: string;
  eligibility?: string;
  questions?: string;
  status?: string;
  tags?: string[];
  deadline?: string;
  amount?: number | null;
  max_award?: number | null;
  /** Old extension versions send one client; newer ones send a list. */
  client?: string;
  clients?: string[];
}

export function newPairingCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const textList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const numberOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function syncPairingCode(code: string) {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("bridge_set_code", { code });
}

/** Hand the vault's clients to the listener, so the extension can offer them. */
async function syncClients(clients: { slug: string; name: string }[]) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("bridge_set_clients", { clients });
}

const clientList = () => {
  const cs = useStore.getState().data?.clients ?? [];
  const list = cs.map((c) => ({ slug: c.slug, name: c.fm.name }));
  // "Me" always comes first, even before a vault has a clients/me.md.
  return list.some((c) => c.slug === ME) ? [...list.filter((c) => c.slug === ME), ...list.filter((c) => c.slug !== ME)] : [{ slug: ME, name: "Me" }, ...list];
};

let activeStop: (() => void) | null = null;

/** Stop the listener, if one is running. Safe to call more than once. */
export function stopExtensionBridge() {
  const stop = activeStop;
  activeStop = null;
  stop?.();
}

export async function startExtensionBridge(): Promise<() => void> {
  stopExtensionBridge();
  if (!isTauri) return () => {};
  const st = useStore.getState();
  if (!st.data || st.data.settings.pairingEnabled === false) return () => {};
  let code = typeof st.data?.settings.pairingCode === "string" ? st.data.settings.pairingCode : "";
  if (!/^\d{6}$/.test(code)) {
    code = newPairingCode();
    await st.updateSettings((s) => ({ ...s, pairingCode: code }));
  }
  try {
    await syncPairingCode(code);
  } catch (e) {
    console.error("Couldn't set the extension pairing code:", errorText(e));
    st.toast("Couldn't start the Chrome extension listener.", "warn");
  }
  let lastClients = "";
  const pushClients = () => {
    const list = clientList();
    const key = JSON.stringify(list);
    if (key === lastClients) return;
    lastClients = key;
    void syncClients(list).catch(() => (lastClients = ""));
  };
  pushClients();
  const unsubscribe = useStore.subscribe((st, prev) => {
    if (st.data?.clients !== prev.data?.clients) pushClients();
  });
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<ExtensionGrant>("extension-grant", async (e) => {
    const g = e.payload as Partial<ExtensionGrant> | null;
    const title = text(g?.title).trim();
    if (!g || !title) return;
    const s = useStore.getState();
    try {
      let body = defaultGrantBody();
      const eligibility = text(g.eligibility);
      if (eligibility.trim()) body = setBodySection(body, "Eligibility", eligibility);
      const questions = text(g.questions);
      if (questions.trim()) body = setBodySection(body, "Notes", `From the web page:\n\n${questions}`);
      let funder = "";
      const funderName = text(g.funder).trim();
      if (funderName) {
        const { ensureFunder } = await import("./vault");
        funder = (await s.mutate((fs) => ensureFunder(fs, funderName))).slug;
      }
      const created = await s.addGrant(
        {
          title,
          url: text(g.url),
          funder,
          status: STATUSES.includes(g.status as Status) ? (g.status as Status) : "researching",
          tags: textList(g.tags).map((t) => slugify(t)),
          deadline: text(g.deadline),
          amount_requested: numberOrNull(g.amount),
          max_award: numberOrNull(g.max_award),
          ...clientsFrom(g),
        },
        body,
      );
      s.toast(`Added from Chrome: ${created.fm.title}`, "ok", { label: "Open", run: () => s.openDrawer({ kind: "grant", id: created.folder }) });
    } catch (err) {
      s.toast(`Couldn't add the grant from Chrome: ${errorText(err)}`, "error");
    }
  });
  const stop = () => {
    unsubscribe();
    unlisten();
    if (activeStop === stop) activeStop = null;
  };
  activeStop = stop;
  return stop;
}

/** Who a grant from the extension is for. Unknown clients are dropped; nothing known leaves the default. */
function clientsFrom(g: Pick<ExtensionGrant, "client" | "clients">): { clients?: string[] } {
  const known = new Set(clientList().map((c) => c.slug));
  const asked = Array.isArray(g.clients) ? g.clients : g.client ? [g.client] : [];
  const clients = [...new Set(asked.filter((c) => typeof c === "string" && known.has(c)))];
  return clients.length ? { clients } : {};
}
