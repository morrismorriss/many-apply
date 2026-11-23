import { useState } from "react";
import { Bar } from "react-chartjs-2";
import { useGrants, useLookups, useStore } from "../store";
import { dashboardNumbers, needsAttention, statusCounts, type Attention } from "../lib/stats";
import { STATUSES, STATUS_LABEL } from "../lib/model";
import { addDays, daysBetween, daysUntil, displayText, fmtDate, fmtMoney, fromISO, MONTH_NAMES, relDays, toISO } from "../lib/util";
import { cssVar, dataColor, themeChartOptions } from "../lib/charts";
import { ClientLabel, Empty, statusColor } from "../components/ui";
import { QuickAdd } from "../components/QuickAdd";
import { documentOwner, expiryState } from "../lib/documents";

const ATT_ICON: Record<Attention["kind"], [string, string]> = {
  due: ["!", "var(--danger)"],
  stale: ["✎", "var(--warn)"],
  decision: ["?", "var(--ev-decision)"],
  report: ["▤", "var(--ev-report)"],
  noreports: ["+", "var(--st-awarded)"],
};

export function Dashboard() {
  const grants = useGrants();
  const open = useStore((s) => s.openDrawer);
  const settings = useStore((s) => s.data!.settings);
  const { funderName } = useLookups();
  const [adding, setAdding] = useState(false);
  const n = dashboardNumbers(grants);
  const att = needsAttention(grants);
  const clientFilter = useStore((s) => s.clientFilter);
  const allDocs = useStore((s) => s.data!.documents);
  const docAtt = allDocs.filter((d) => (!clientFilter || documentOwner(d) === clientFilter) && ["expired", "soon"].includes(expiryState(d)));
  const counts = statusCounts(grants);
  const today = new Date();
  const hour = today.getHours();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}</h1>
          <div className="sub">{today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>
          + New opportunity
        </button>
      </div>

      <div className="stats">
        <Stat v={String(n.active)} k="Active applications" />
        <Stat v={String(n.deadlines30)} k="Deadlines in 30 days" />
        <Stat v={fmtMoney(n.requested, settings.currency, true)} k={`Requested in ${today.getFullYear()}`} />
        <Stat v={fmtMoney(n.awarded, settings.currency, true)} k={`Awarded in ${today.getFullYear()}`} />
        <Stat v={n.winRate === null ? "—" : `${Math.round(n.winRate * 100)}%`} k="Win rate" />
      </div>

      {grants.length === 0 ? (
        <Empty title="Nothing here yet">
          <p>Add an opportunity you're looking at, or bring in your existing tracker from the Import tab.</p>
          <button className="btn primary" onClick={() => setAdding(true)}>+ New opportunity</button>
        </Empty>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <h2>
              Next 90 days <span className="grow" />
              <span className="legend">
                {(["researching", "planning", "drafting", "submitted"] as const).map((s) => (
                  <span key={s}>
                    <i style={{ ["--c" as string]: statusColor(s) }} />
                    {STATUS_LABEL[s]}
                  </span>
                ))}
                <span>
                  <i style={{ ["--c" as string]: "var(--ev-report)" }} />
                  Report due
                </span>
              </span>
            </h2>
            <Timeline />
          </div>

          <div className="grid cols-2">
            <div className="panel">
              <h2>Needs attention</h2>
              {att.length === 0 && docAtt.length === 0 ? (
                <p className="muted">All caught up.</p>
              ) : (
                <div>
                  {docAtt.map((d) => {
                    const n = daysUntil(d.fm.expires);
                    return (
                      <div key={d.path} className="att" onClick={() => open({ kind: "document", id: d.path })}>
                        <span className="ic" style={{ ["--c" as string]: "var(--warn)" }}>⚿</span>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="ellipsis" style={{ fontWeight: 550 }}>
                            {d.fm.title} <ClientLabel slug={documentOwner(d)} />
                          </div>
                          <div className="small soft">{n !== null && n < 0 ? `Expired ${relDays(n)}` : `Expires ${relDays(n)}`}. Get a new one.</div>
                        </div>
                        <span className="small muted ellipsis" style={{ maxWidth: 140 }}>{displayText(d.fm.type)}</span>
                      </div>
                    );
                  })}
                  {att.slice(0, 12).map((a, i) => (
                    <div key={i} className="att" onClick={() => open({ kind: "grant", id: a.grant.folder })}>
                      <span className="ic" style={{ ["--c" as string]: ATT_ICON[a.kind][1] }}>
                        {ATT_ICON[a.kind][0]}
                      </span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="ellipsis" style={{ fontWeight: 550 }}>
                          {a.grant.fm.title} <ClientLabel slug={a.grant.fm.client} />
                        </div>
                        <div className="small soft">{a.text}</div>
                      </div>
                      <span className="small muted ellipsis" style={{ maxWidth: 140 }}>
                        {funderName(a.grant.fm.funder)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="panel">
              <h2>Pipeline</h2>
              <div className="chart-box" style={{ height: 260 }}>
                <Bar
                  data={{
                    labels: STATUSES.map((s) => STATUS_LABEL[s]),
                    datasets: [
                      {
                        data: STATUSES.map((s) => counts[s]),
                        backgroundColor: STATUSES.map((s) => dataColor(`st-${s}`, settings.dataColors)),
                        borderRadius: 4,
                        maxBarThickness: 36,
                      },
                    ],
                  }}
                  options={{ ...themeChartOptions(), plugins: { legend: { display: false } }, scales: { ...themeChartOptions().scales, y: { ...themeChartOptions().scales.y, ticks: { precision: 0, color: cssVar("--muted") } } } }}
                />
              </div>
            </div>
          </div>
        </>
      )}
      {adding && <QuickAdd onClose={() => setAdding(false)} />}
    </div>
  );
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

function Timeline() {
  const grants = useGrants();
  const open = useStore((s) => s.openDrawer);
  const today = new Date();
  const start = toISO(today);
  const end = toISO(addDays(today, 90));
  type P = { date: string; color: string; title: string; folder: string; status?: string };
  const pts: P[] = [];
  for (const g of grants) {
    if (g.fm.deadline && g.fm.deadline >= start && g.fm.deadline <= end && !["awarded", "declined", "withdrawn"].includes(g.fm.status))
      pts.push({ date: g.fm.deadline, color: statusColor(g.fm.status), title: `${g.fm.title} · ${fmtDate(g.fm.deadline)}`, folder: g.folder, status: g.fm.status });
    for (const r of g.fm.reports)
      if (!r.submitted_on && r.due >= start && r.due <= end)
        pts.push({ date: r.due, color: "var(--ev-report)", title: `${r.title}: ${g.fm.title} · ${fmtDate(r.due)}`, folder: g.folder });
  }
  // Stack dots that land close together.
  pts.sort((a, b) => a.date.localeCompare(b.date));
  const lanes: number[] = [];
  const placed = pts.map((p) => {
    const x = (daysBetween(today, fromISO(p.date)!) / 90) * 100;
    let lane = 0;
    while (lanes[lane] !== undefined && x - lanes[lane] < 2.2) lane++;
    lanes[lane] = x;
    return { ...p, x, lane };
  });
  const ticks: { x: number; label: string }[] = [];
  for (let i = 0; i <= 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i + 1, 1);
    const x = (daysBetween(today, d) / 90) * 100;
    if (x <= 100) ticks.push({ x, label: MONTH_NAMES[d.getMonth()].slice(0, 3) });
  }
  if (!pts.length) return <p className="muted">No deadlines in the next 90 days.</p>;
  return (
    <div className="timeline">
      <div className="axis" />
      <div className="today" style={{ left: 0 }}>
        <span>Today</span>
      </div>
      {ticks.map((t) => (
        <div key={t.label} className="tick" style={{ left: `${t.x}%` }}>
          {t.label}
        </div>
      ))}
      {placed.map((p, i) => (
        <div
          key={i}
          className="dot"
          title={p.title}
          style={{ left: `${Math.max(0.8, Math.min(99.2, p.x))}%`, top: 56 - p.lane * 17, ["--c" as string]: p.color }}
          onClick={() => open({ kind: "grant", id: p.folder })}
        />
      ))}
    </div>
  );
}

