import { useState } from "react";
import { useGrants, useStore } from "../store";
import { funderStats } from "../lib/stats";
import { ensureFunder } from "../lib/vault";
import { fmtMoney } from "../lib/util";
import { askText } from "../components/dialogs";
import { Empty } from "../components/ui";
import { confirmDeleteFunder } from "../components/FunderDrawer";

export function Funders() {
  const funders = useStore((s) => s.data!.funders);
  const grants = useGrants();
  const clientFilter = useStore((s) => s.clientFilter);
  const open = useStore((s) => s.openDrawer);
  const mutate = useStore((s) => s.mutate);
  const del = useStore((s) => s.deleteFunder);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "applied" | "awarded" | "rate">("awarded");
  const rows = funders
    .map((f) => ({ f, s: funderStats(f, grants) }))
    .filter((r) => !clientFilter || r.s.grants.length > 0)
    .filter((r) => !q || r.f.fm.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      sort === "name" ? a.f.fm.name.localeCompare(b.f.fm.name)
        : sort === "applied" ? b.s.applied - a.s.applied
          : sort === "awarded" ? b.s.awarded - a.s.awarded
            : (b.s.winRate ?? -1) - (a.s.winRate ?? -1),
    );
  const th = (k: typeof sort, label: string, cls = "") => (
    <th className={`sortable ${cls}`} onClick={() => setSort(k)}>
      {label} {sort === k ? "↓" : ""}
    </th>
  );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Funders</h1>
          <div className="sub">Everyone you've applied to, and how it went. Click a funder to add their website, contact and notes.</div>
        </div>
        <span className="spacer" />
        <button
          className="btn primary"
          onClick={async () => {
            const name = await askText("New funder", { placeholder: "Funder name" });
            if (!name) return;
            const r = await mutate((fs) => ensureFunder(fs, name));
            open({ kind: "funder", id: r.slug });
          }}
        >
          + New funder
        </button>
      </div>
      <div className="toolbar">
        <input className="input" style={{ width: 240 }} placeholder="Search funders" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {rows.length === 0 ? (
        <Empty title="No funders yet">
          <p>Funders are added when you create or import applications.</p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {th("name", "Funder")}
                <th>Type</th>
                <th className="r">Grants</th>
                {th("applied", "Applied", "r")}
                {th("awarded", "Awarded", "r")}
                {th("rate", "Win rate", "r")}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ f, s }) => (
                <tr key={f.slug} className="click" onClick={() => open({ kind: "funder", id: f.slug })}>
                  <td style={{ fontWeight: 550 }}>{f.fm.name}</td>
                  <td className="soft">{f.fm.funder_type || "—"}</td>
                  <td className="r num">{s.grants.length}</td>
                  <td className="r num">{s.applied}</td>
                  <td className="r num">{s.awarded ? fmtMoney(s.awarded) : "—"}</td>
                  <td className="r num">{s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`}</td>
                  <td className="r" style={{ width: 1 }}>
                    <button
                      className="icon-btn"
                      title={`Delete ${f.fm.name}`}
                      aria-label={`Delete ${f.fm.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void confirmDeleteFunder(f.fm.name, s.grants.length, () => del(f.slug));
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
