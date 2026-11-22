import { useState } from "react";
import { Bar } from "react-chartjs-2";
import { useLookups, useStore } from "../store";
import {
  deadlineHeatmap,
  filterForReports,
  fundingByFunder,
  grantYear,
  requestedVsAwardedByYear,
  turnaround,
  winRate,
  winRateBy,
} from "../lib/stats";
import { exportGrantsCsv } from "../lib/csvImport";
import { saveFile } from "../lib/platform";
import { cssVar, themeChartOptions } from "../lib/charts";
import { fmtMoney, MONTH_NAMES } from "../lib/util";

export function Reports() {
  const all = useStore((s) => s.data!.grants);
  const clients = useStore((s) => s.data!.clients);
  const clientFilter = useStore((s) => s.clientFilter);
  const go = useStore((s) => s.go);
  const toast = useStore((s) => s.toast);
  const { funderName, funder, clientName } = useLookups();
  const [f, setF] = useState({ year: "", tag: "", project: "", client: "" });
  const client = clientFilter || f.client;
  const grants = filterForReports(all, { ...f, client });

  const years = [...new Set(all.map(grantYear).filter(Boolean))].sort().reverse() as number[];
  const tags = [...new Set(all.flatMap((g) => g.fm.tags))].sort();
  const projects = [...new Set(all.map((g) => g.fm.project).filter(Boolean))].sort();

  const ry = requestedVsAwardedByYear(grants);
  const byType = winRateBy(grants, (g) => g.fm.type);
  const byFunderType = winRateBy(grants, (g) => funder(g.fm.funder)?.fm.funder_type ?? "");
  const byFunder = fundingByFunder(grants, funderName).slice(0, 10);
  const heat = deadlineHeatmap(grants);
  const heatMax = Math.max(1, ...heat.flatMap((h) => h.months));
  const ta = turnaround(grants);
  const wr = winRate(grants);
  const opts = themeChartOptions();
  const moneyTicks = { ...opts.scales.y, ticks: { color: cssVar("--muted"), callback: (v: string | number) => fmtMoney(Number(v), "USD", true) } };
  const pctTicks = { ...opts.scales.y, max: 100, ticks: { color: cssVar("--muted"), callback: (v: string | number) => `${v}%` } };

  const exportCsv = async () => {
    const p = await saveFile(`many-apply-report${client ? "-" + client : ""}.csv`, exportGrantsCsv(grants, funderName, clientName), "text/csv");
    if (p) toast(`Exported ${grants.length} applications`);
  };

  const byClient = clients
    .map((c) => {
      const gs = grants.filter((g) => g.fm.client === c.slug);
      return {
        c,
        n: gs.length,
        requested: gs.filter((g) => ["submitted", "awarded", "declined"].includes(g.fm.status)).reduce((s, g) => s + (g.fm.amount_requested ?? 0), 0),
        awarded: gs.filter((g) => g.fm.status === "awarded").reduce((s, g) => s + (g.fm.amount_awarded ?? 0), 0),
        rate: winRate(gs),
      };
    })
    .filter((r) => r.n);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="sub">{grants.length} applications · win rate {wr === null ? "—" : `${Math.round(wr * 100)}%`}</div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="toolbar">
        <select className="select" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}>
          <option value="">All years</option>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <select className="select" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}>
          <option value="">All tags</option>
          {tags.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="select" value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        {!clientFilter && clients.length > 1 && (
          <select className="select" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.slug} value={c.slug}>{c.fm.name}</option>)}
          </select>
        )}
      </div>

      {all.length < 10 && (
        <div className="callout" style={{ marginBottom: 16 }}>
          <b>Reports get useful with history.</b> You have {all.length} application{all.length === 1 ? "" : "s"}. Import past applications from a
          spreadsheet or Notion to see real trends.{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); go({ screen: "import" }); }}>Go to Import →</a>
        </div>
      )}

      <div className="grid cols-2">
        <div className="panel">
          <h2>Requested vs. awarded</h2>
          <div className="chart-box">
            <Bar
              data={{
                labels: ry.map((r) => String(r.year)),
                datasets: [
                  { label: "Requested", data: ry.map((r) => r.requested), backgroundColor: cssVar("--st-planning"), borderRadius: 4, maxBarThickness: 32 },
                  { label: "Awarded", data: ry.map((r) => r.awarded), backgroundColor: cssVar("--st-awarded"), borderRadius: 4, maxBarThickness: 32 },
                ],
              }}
              options={{ ...opts, scales: { ...opts.scales, y: moneyTicks } }}
            />
          </div>
        </div>
        <div className="panel">
          <h2>
            Average turnaround
          </h2>
          <div style={{ fontSize: 40, fontWeight: 650, letterSpacing: "-0.02em" }} className="num">
            {ta.avg === null ? "—" : `${ta.avg} days`}
          </div>
          <p className="muted">
            From submission to decision, across {ta.count} decided application{ta.count === 1 ? "" : "s"}. Based on <code>submitted_on</code>,{" "}
            <code>decision_on</code> and the status history.
          </p>
          <h3 style={{ marginTop: 18, marginBottom: 8 }}>By client</h3>
          <table className="table">
            <tbody>
              {byClient.map((r) => (
                <tr key={r.c.slug}>
                  <td><span className="label" style={{ ["--c" as string]: r.c.fm.color }}>{r.c.fm.name}</span></td>
                  <td className="r num">{fmtMoney(r.requested, "USD", true)} req.</td>
                  <td className="r num">{fmtMoney(r.awarded, "USD", true)} won</td>
                  <td className="r num">{r.rate === null ? "—" : `${Math.round(r.rate * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Win rate by type</h2>
          <div className="chart-box">
            <Bar
              data={{
                labels: byType.map((r) => `${r.label} (${r.decided})`),
                datasets: [{ label: "Win rate", data: byType.map((r) => Math.round(r.rate * 100)), backgroundColor: cssVar("--accent"), borderRadius: 4, maxBarThickness: 36 }],
              }}
              options={{ ...opts, plugins: { legend: { display: false } }, scales: { ...opts.scales, y: pctTicks } }}
            />
          </div>
        </div>
        <div className="panel">
          <h2>Win rate by funder type</h2>
          <div className="chart-box">
            <Bar
              data={{
                labels: byFunderType.map((r) => `${r.label} (${r.decided})`),
                datasets: [{ label: "Win rate", data: byFunderType.map((r) => Math.round(r.rate * 100)), backgroundColor: cssVar("--st-submitted"), borderRadius: 4, maxBarThickness: 36 }],
              }}
              options={{ ...opts, plugins: { legend: { display: false } }, scales: { ...opts.scales, y: pctTicks } }}
            />
          </div>
        </div>
        <div className="panel">
          <h2>Funding by funder</h2>
          <div className="chart-box" style={{ height: Math.max(160, byFunder.length * 32 + 40) }}>
            <Bar
              data={{
                labels: byFunder.map((r) => r.label),
                datasets: [{ label: "Awarded", data: byFunder.map((r) => r.amount), backgroundColor: cssVar("--st-awarded"), borderRadius: 4, maxBarThickness: 22 }],
              }}
              options={{
                indexAxis: "y" as const,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ...moneyTicks, grid: { color: cssVar("--border") } },
                  y: { grid: { display: false }, ticks: { color: cssVar("--text-soft") } },
                },
              }}
            />
          </div>
        </div>
        <div className="panel">
          <h2>Deadlines by month</h2>
          {heat.length === 0 ? (
            <p className="muted">No deadlines yet.</p>
          ) : (
            <div className="heat">
              <span />
              {MONTH_NAMES.map((m) => <span key={m} className="h">{m[0]}</span>)}
              {heat.map((row) => (
                <div key={row.year} style={{ display: "contents" }}>
                  <span className="y">{row.year}</span>
                  {row.months.map((n, i) => (
                    <span
                      key={i}
                      className="c"
                      title={`${MONTH_NAMES[i]} ${row.year}: ${n} deadline${n === 1 ? "" : "s"}`}
                      style={{ background: n ? `color-mix(in srgb, var(--accent) ${15 + (n / heatMax) * 70}%, transparent)` : "var(--hover)" }}
                    >
                      {n || ""}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
