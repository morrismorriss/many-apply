// Receives grants from the Chrome extension through the desktop app's local listener (127.0.0.1 only).
import { isTauri } from "./platform";
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

export async function startExtensionBridge(): Promise<() => void> {
  if (!isTauri) return () => {};
  const st = useStore.getState();
  let code = st.data?.settings.pairingCode;
  if (!code) {
    code = newPairingCode();
    await st.updateSettings((s) => ({ ...s, pairingCode: code! }));
  }
  await syncPairingCode(code);
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
    const g = e.payload;
    if (!g?.title) return;
    let body = defaultGrantBody();
    if (g.eligibility) body = setBodySection(body, "Eligibility", g.eligibility);
    if (g.questions) body = setBodySection(body, "Notes", `From the web page:\n\n${g.questions}`);
    const s = useStore.getState();
    let funder = "";
    if (g.funder) {
      const { ensureFunder } = await import("./vault");
      funder = (await s.mutate((fs) => ensureFunder(fs, g.funder!))).slug;
    }
    const created = await s.addGrant(
      {
        title: g.title,
        url: g.url ?? "",
        funder,
        status: STATUSES.includes(g.status as Status) ? (g.status as Status) : "researching",
        tags: (g.tags ?? []).map((t) => slugify(t)),
        deadline: g.deadline ?? "",
        amount_requested: g.amount ?? null,
        max_award: g.max_award ?? null,
        ...clientsFrom(g),
      },
      body,
    );
    s.toast(`Added from Chrome: ${created.fm.title}`, "ok", { label: "Open", run: () => s.openDrawer({ kind: "grant", id: created.folder }) });
  });
  return () => {
    unsubscribe();
    unlisten();
  };
}

/** Who a grant from the extension is for. Unknown clients are dropped; nothing known leaves the default. */
function clientsFrom(g: ExtensionGrant): { clients?: string[] } {
  const known = new Set(clientList().map((c) => c.slug));
  const asked = Array.isArray(g.clients) ? g.clients : g.client ? [g.client] : [];
  const clients = [...new Set(asked.filter((c) => typeof c === "string" && known.has(c)))];
  return clients.length ? { clients } : {};
}
