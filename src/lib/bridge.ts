// Receives grants from the Chrome extension through the desktop app's local listener (127.0.0.1 only).
import { isTauri } from "./platform";
import { useStore } from "../store";
import { STATUSES, type Status } from "./model";
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
  client?: string;
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

export async function startExtensionBridge(): Promise<() => void> {
  if (!isTauri) return () => {};
  const st = useStore.getState();
  let code = st.data?.settings.pairingCode;
  if (!code) {
    code = newPairingCode();
    await st.updateSettings((s) => ({ ...s, pairingCode: code! }));
  }
  await syncPairingCode(code);
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
        ...(g.client ? { client: g.client } : {}),
      },
      body,
    );
    s.toast(`Added from Chrome: ${created.fm.title}`, "ok", { label: "Open", run: () => s.openDrawer({ kind: "grant", id: created.folder }) });
  });
  return unlisten;
}
