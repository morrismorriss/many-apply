import { CvBuilder } from "./screens/CvBuilder";
import { useEffect, useLayoutEffect } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Drawer } from "./components/Drawer";
import { DialogHost } from "./components/dialogs";
import { Dashboard } from "./screens/Dashboard";
import { Research } from "./screens/Research";
import { Pipeline } from "./screens/Pipeline";
import { CalendarScreen } from "./screens/Calendar";
import { Documents } from "./screens/Documents";
import { Library } from "./screens/Library";
import { Funders } from "./screens/Funders";
import { Clients } from "./screens/Clients";
import { Giving } from "./screens/Giving";
import { Reports } from "./screens/Reports";
import { ImportScreen } from "./screens/Import";
import { SettingsScreen } from "./screens/Settings";
import { DraftEditor } from "./screens/DraftEditor";
import { BudgetBuilder } from "./screens/BudgetBuilder";
import { Welcome } from "./screens/Welcome";
import { getPref, isTauri } from "./lib/platform";
import { startExtensionBridge } from "./lib/bridge";
import type { Settings } from "./lib/model";
import { applyDataColors } from "./lib/charts";

function applyTheme(s: Settings | undefined) {
  const root = document.documentElement;
  const theme = s?.theme ?? "light";
  root.dataset.theme = theme === "custom" ? "light" : theme;
  const props = ["--bg", "--surface", "--sidebar", "--text", "--text-soft", "--muted", "--accent", "--accent-soft", "--border", "--border-strong", "--hover", "--active"];
  for (const p of props) root.style.removeProperty(p);
  if (theme === "custom" && s) {
    const c = s.customTheme;
    root.style.setProperty("--bg", c.bg);
    root.style.setProperty("--surface", `color-mix(in srgb, ${c.bg} 70%, white)`);
    root.style.setProperty("--sidebar", c.sidebar);
    root.style.setProperty("--text", c.text);
    root.style.setProperty("--text-soft", `color-mix(in srgb, ${c.text} 78%, ${c.bg})`);
    root.style.setProperty("--muted", `color-mix(in srgb, ${c.text} 52%, ${c.bg})`);
    root.style.setProperty("--accent", c.accent);
    root.style.setProperty("--accent-soft", `color-mix(in srgb, ${c.accent} 16%, ${c.bg})`);
    root.style.setProperty("--border", `color-mix(in srgb, ${c.text} 11%, ${c.bg})`);
    root.style.setProperty("--border-strong", `color-mix(in srgb, ${c.text} 20%, ${c.bg})`);
    root.style.setProperty("--hover", `color-mix(in srgb, ${c.text} 6%, transparent)`);
    root.style.setProperty("--active", `color-mix(in srgb, ${c.text} 11%, transparent)`);
  }
}

export default function App() {
  const data = useStore((s) => s.data);
  const route = useStore((s) => s.route);
  const drawer = useStore((s) => s.drawer);
  const pinned = useStore((s) => s.drawerPinned);
  const loading = useStore((s) => s.loading);
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    const last = getPref("vault");
    const st = useStore.getState();
    if (last === "demo" || (!isTauri && last === null)) void st.openDemo();
    else if (last && isTauri) void st.openVault(last);
  }, []);

  // Layout effect, so CSS colours are on the page before anything paints with them.
  useLayoutEffect(() => {
    applyTheme(data?.settings);
    applyDataColors(data?.settings.dataColors);
  }, [data?.settings]);

  useEffect(() => {
    if (!isTauri || !data) return;
    let stop: (() => void) | undefined;
    void startExtensionBridge().then((s) => (stop = s));
    return () => stop?.();
  }, [!!data]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".overlay")) {
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag !== "input" && tag !== "textarea" && tag !== "select") useStore.getState().closeDrawer();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  if (!data) return (
    <>
      <Welcome loading={loading} />
      <DialogHost />
    </>
  );

  let screen: React.ReactNode;
  switch (route.screen) {
    case "dashboard": screen = <Dashboard />; break;
    case "research": screen = <Research />; break;
    case "pipeline": screen = <Pipeline />; break;
    case "calendar": screen = <CalendarScreen />; break;
    case "library": screen = <Library />; break;
    case "cv": screen = <CvBuilder />; break;
    case "documents": screen = <Documents />; break;
    case "funders": screen = <Funders />; break;
    case "clients": screen = <Clients />; break;
    case "giving": screen = <Giving />; break;
    case "reports": screen = <Reports />; break;
    case "import": screen = <ImportScreen />; break;
    case "settings": screen = <SettingsScreen />; break;
    case "draft": screen = <DraftEditor key={route.folder + route.draft} folder={route.folder} draft={route.draft} />; break;
    case "budget": screen = <BudgetBuilder key={route.folder} folder={route.folder} />; break;
  }

  return (
    <div className="app">
      <Sidebar />
      <main className={`main${drawer && pinned ? " with-drawer" : ""}`}>{screen}</main>
      {drawer && <Drawer target={drawer} />}
      <DialogHost />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ""}`}>
            {t.text}
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
