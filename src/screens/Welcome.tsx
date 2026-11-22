import { useStore } from "../store";
import { isTauri, pickFolder } from "../lib/platform";

export function Welcome({ loading }: { loading: boolean }) {
  const openVault = useStore((s) => s.openVault);
  const openDemo = useStore((s) => s.openDemo);
  const error = useStore((s) => s.error);
  return (
    <div className="welcome">
      <div className="box">
        <img src="/icon.svg" width={56} height={56} alt="" />
        <h1>Many Apply</h1>
        <p>
          Research, track and write grants in one place. Everything lives in a folder on your computer as plain markdown
          files you own. No accounts, no cloud.
        </p>
        {loading ? (
          <p className="muted">Opening…</p>
        ) : (
          <div className="stack" style={{ alignItems: "center", marginTop: 24 }}>
            {isTauri && (
              <button className="btn primary" onClick={async () => openVault(await pickFolder())}>
                Choose a vault folder
              </button>
            )}
            <button className={isTauri ? "btn ghost" : "btn primary"} onClick={() => openDemo(true)}>
              {isTauri ? "Explore with sample data" : "Open the demo vault"}
            </button>
            <p className="muted small" style={{ maxWidth: 380 }}>
              {isTauri
                ? "Pick an empty folder to start fresh, or an existing Many Apply folder. A folder in iCloud or Dropbox works too."
                : "You're running the browser preview. Data stays in this browser. Use the desktop app to work with a real folder."}
            </p>
            {error && <p className="danger-text small">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
