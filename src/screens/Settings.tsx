import { useEffect, useState } from "react";
import { useStore } from "../store";
import { getSecret, isTauri, pickFolder, saveFile, setSecret } from "../lib/platform";
import { TOKEN_KEY, testToken } from "../lib/todoist";
import { zipVault } from "../lib/backup";
import { BRIDGE_PORT, newPairingCode, syncPairingCode } from "../lib/bridge";
import { confirmAction } from "../components/dialogs";
import type { Settings } from "../lib/model";
import { todayISO } from "../lib/util";

export function SettingsScreen() {
  const s = useStore((st) => st.data!.settings);
  const fs = useStore((st) => st.fs!);
  const update = useStore((st) => st.updateSettings);
  const openVault = useStore((st) => st.openVault);
  const openDemo = useStore((st) => st.openDemo);
  const closeVault = useStore((st) => st.closeVault);
  const toast = useStore((st) => st.toast);
  const set = (fn: (x: Settings) => Settings) => void update(fn);

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <Section title="Vault">
        <p className="soft small" style={{ marginTop: 0 }}>
          Your data is a folder of markdown files. Many Apply watches it, so edits made in Obsidian or a text editor show up here.
        </p>
        <div className="row">
          <code className="grow ellipsis" style={{ padding: "6px 10px" }}>{fs.root}</code>
          {isTauri && (
            <button className="btn" onClick={async () => openVault(await pickFolder())}>
              Change folder…
            </button>
          )}
          {fs.kind === "memory" && (
            <button
              className="btn"
              onClick={async () => (await confirmAction("Reset the demo vault?", "This browser's demo data goes back to the sample.", { okLabel: "Reset" })) && openDemo(true)}
            >
              Reset demo
            </button>
          )}
          {isTauri && <button className="btn ghost" onClick={closeVault}>Close</button>}
        </div>
      </Section>

      <Section title="Theme">
        <div className="seg">
          {(["light", "dark", "pink", "custom"] as const).map((t) => (
            <button key={t} className={s.theme === t ? "on" : ""} onClick={() => set((x) => ({ ...x, theme: t }))}>
              {t === "custom" ? "Build your own" : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {s.theme === "custom" && (
          <div className="row wrap" style={{ marginTop: 12, gap: 16 }}>
            {(["bg", "sidebar", "text", "accent"] as const).map((k) => (
              <label key={k} className="field" style={{ alignItems: "center" }}>
                {k === "bg" ? "Background" : k[0].toUpperCase() + k.slice(1)}
                <input
                  type="color"
                  value={s.customTheme[k]}
                  onChange={(e) => set((x) => ({ ...x, customTheme: { ...x.customTheme, [k]: e.target.value } }))}
                  style={{ width: 48, height: 32, border: "1px solid var(--border-strong)", borderRadius: 6, padding: 2, background: "var(--surface)" }}
                />
              </label>
            ))}
          </div>
        )}
      </Section>

      <TodoistSettings />

      <Section title="Budget categories">
        <p className="soft small" style={{ marginTop: 0 }}>Used in every budget. One per line.</p>
        <textarea
          className="textarea"
          defaultValue={s.categories.join("\n")}
          onBlur={(e) => set((x) => ({ ...x, categories: e.target.value.split("\n").map((c) => c.trim()).filter(Boolean) }))}
        />
      </Section>

      <Section title="Calendar">
        <label className="check">
          <input type="checkbox" checked={s.keepIcsUpdated} onChange={(e) => set((x) => ({ ...x, keepIcsUpdated: e.target.checked }))} />
          Keep <code>.manyapply/calendar.ics</code> up to date in the vault
        </label>
        <p className="muted small">If your vault is in iCloud or Dropbox, you can subscribe to that file from Google or Apple Calendar.</p>
      </Section>

      <Section title="Backup">
        <p className="soft small" style={{ marginTop: 0 }}>Zips the whole vault (minus the trash) to a place you choose.</p>
        <button
          className="btn"
          onClick={async () => {
            const data = await zipVault(fs);
            const p = await saveFile(`many-apply-backup-${todayISO()}.zip`, data, "application/zip");
            if (p) toast("Backup saved");
          }}
        >
          Back up now…
        </button>
      </Section>

      <Section title="Chrome extension">
        <p className="soft small" style={{ marginTop: 0 }}>
          Save grants from any web page. The extension talks only to this app, on <code>127.0.0.1:{BRIDGE_PORT}</code>. Nothing leaves your computer.
          {!isTauri && " (Available in the desktop app.)"}
        </p>
        <div className="row">
          <span className="soft">Pairing code</span>
          <code style={{ fontSize: 18, letterSpacing: "0.15em", padding: "4px 10px" }}>{s.pairingCode || "——————"}</code>
          <button
            className="btn small"
            onClick={async () => {
              const code = newPairingCode();
              await update((x) => ({ ...x, pairingCode: code }));
              await syncPairingCode(code);
              toast("New pairing code. Enter it in the extension.");
            }}
          >
            New code
          </button>
        </div>
      </Section>

      {s.importPresets.length > 0 && (
        <Section title="Saved import mappings">
          {s.importPresets.map((p) => (
            <div key={p.name} className="row">
              <span className="grow">{p.name}</span>
              <button className="btn small ghost" onClick={() => set((x) => ({ ...x, importPresets: x.importPresets.filter((y) => y.name !== p.name) }))}>
                Remove
              </button>
            </div>
          ))}
        </Section>
      )}

      <p className="muted small" style={{ marginTop: 32 }}>
        Many Apply is free and open source. No accounts, no servers, no AI. Your files are yours.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function TodoistSettings() {
  const s = useStore((st) => st.data!.settings);
  const update = useStore((st) => st.updateSettings);
  const toast = useStore((st) => st.toast);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (fn: (x: Settings["todoist"]) => Settings["todoist"]) => void update((x) => ({ ...x, todoist: fn(x.todoist) }));

  useEffect(() => {
    void getSecret(TOKEN_KEY).then((t) => setHasToken(!!t)).catch(() => setHasToken(false));
  }, []);

  return (
    <Section title="Todoist">
      <p className="soft small" style={{ marginTop: 0 }}>
        One-way sync: when an application moves to Planning, Many Apply adds a task due on the deadline, plus prep tasks. When you add a reporting date, it
        adds a task for that too. Your token is stored in your computer's keychain{isTauri ? "" : " (in the browser preview, only for this session)"}, never in the vault.
      </p>
      {hasToken ? (
        <div className="row">
          <span className="ok-text">✓ Connected</span>
          <span className="grow" />
          <button
            className="btn small"
            onClick={async () => {
              setBusy(true);
              try {
                const t = await getSecret(TOKEN_KEY);
                const n = await testToken(t!);
                toast(`Todoist is working (${n} projects)`);
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Test
          </button>
          <button className="btn small ghost" onClick={async () => { await setSecret(TOKEN_KEY, null); setHasToken(false); }}>
            Disconnect
          </button>
        </div>
      ) : (
        <div className="row">
          <input
            className="input grow"
            type="password"
            value={token}
            placeholder="Paste your Todoist API token"
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={!token.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await testToken(token.trim());
                await setSecret(TOKEN_KEY, token.trim());
                setToken("");
                setHasToken(true);
                toast("Todoist connected");
              } catch (e) {
                toast((e as Error).message || "Couldn't reach Todoist", "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Connect
          </button>
        </div>
      )}
      <p className="muted small">Find your token in Todoist: Settings → Integrations → Developer → API token.</p>

      <div className="stack" style={{ marginTop: 12 }}>
        <label className="check">
          <input type="checkbox" checked={s.todoist.enabled} onChange={(e) => set((t) => ({ ...t, enabled: e.target.checked }))} />
          Create tasks automatically
        </label>
        <label className="check">
          <input type="checkbox" checked={s.todoist.projectPerClient} onChange={(e) => set((t) => ({ ...t, projectPerClient: e.target.checked }))} />
          Put each client's tasks in its own Todoist project (created on first use)
        </label>
        <div>
          <div className="small soft" style={{ marginBottom: 6 }}>Prep tasks before each deadline</div>
          {s.todoist.prepTasks.map((p, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input
                className="input grow"
                defaultValue={p.title}
                onBlur={(e) => set((t) => ({ ...t, prepTasks: t.prepTasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }))}
              />
              <input
                className="input"
                style={{ width: 70 }}
                type="number"
                min={0}
                defaultValue={p.days_before}
                onBlur={(e) => set((t) => ({ ...t, prepTasks: t.prepTasks.map((x, j) => (j === i ? { ...x, days_before: Number(e.target.value) || 0 } : x)) }))}
              />
              <span className="muted small">days before</span>
              <button className="icon-btn" onClick={() => set((t) => ({ ...t, prepTasks: t.prepTasks.filter((_, j) => j !== i) }))}>
                ×
              </button>
            </div>
          ))}
          <button className="btn small ghost" onClick={() => set((t) => ({ ...t, prepTasks: [...t.prepTasks, { title: "New prep task", days_before: 7 }] }))}>
            + Add prep task
          </button>
        </div>
        <div className="row small">
          <span className="soft">Report reminder</span>
          <input
            className="input"
            style={{ width: 70 }}
            type="number"
            min={0}
            defaultValue={s.todoist.reportReminderDays ?? 0}
            onBlur={(e) => set((t) => ({ ...t, reportReminderDays: Number(e.target.value) || null }))}
          />
          <span className="muted">days before a report is due (0 for none)</span>
        </div>
      </div>
    </Section>
  );
}
