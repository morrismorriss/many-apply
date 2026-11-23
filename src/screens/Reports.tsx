import { useState } from "react";
import { Bar } from "react-chartjs-2";
import { useLookups, useStore } from "../store";
import { isFor } from "../lib/model";
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
import { donorsFor } from "../lib/donors";
import { copyToClipboard, saveFile } from "../lib/platform";
import {
  READINESS_COLUMNS,
  documentReadiness,
  expiringDocuments,
  givingReport,
  yearReview,
  yearReviewText,
  type ReadinessState,
} from "../lib/reportStats";
import { fmtDate, fmtMinutes, relDays, daysUntil } from "../lib/util";
import type { ReactNode } from "react";
import { cssVar, dataColor, themeChartOptions } from "../lib/charts";
import { fmtMoney, MONTH_NAMES } from "../lib/util";

/** Every report panel, in the order they appear. */
export const REPORTS = [
  { id: "year", title: "Year in review" },
  { id: "requested-awarded", title: "Requested vs. awarded" },
  { id: "turnaround", title: "Average turnaround and by client" },
  { id: "win-type", title: "Win rate by type" },
  { id: "win-funder-type", title: "Win rate by funder type" },
  { id: "by-funder", title: "Funding by funder" },
  { id: "deadlines", title: "Deadlines by month" },
  { id: "giving", title: "Individual giving" },
  { id: "documents", title: "Document readiness" },
] as const;
type ReportId = (typeof REPORTS)[number]["id"];

function ReportPanel({ id, title, wide, actions, children }: { id: ReportId; title: ReactNode; wide?: boolean; actions?: ReactNode; children: ReactNode }) {
  const update = useStore((s) => s.updateSettings);
  return (
    <div className={`panel${wide ? " span-2" : ""}`}>
      <h2 className="report-h">
        <span className="grow">{title}</span>
        {actions}
        <button
          className="icon-btn report-hide"
          title="Hide this report (turn it back on from Choose reports)"
          aria-label={`Hide ${REPORTS.find((r) => r.id === id)?.title}`}
          onClick={() => void update((x) => ({ ...x, hiddenReports: [...new Set([...x.hiddenReports, id])] }))}
        >
          ×
        </button>
      </h2>
      {children}
    </div>
  );
}

export function Reports() {
  const all = useStore((s) => s.data!.grants);
  const dataColors = useStore((s) => s.data!.settings.dataColors);
  const clients = useStore((s) => s.data!.clients);
  const clientFilter = useStore((s) => s.clientFilter);
  const go = useStore((s) => s.go);
  const toast = useStore((s) => s.toast);
  const { funderName, funder, clientName } = useLookups();
  const [f, setF] = useState({ year: "", tag: "", project: "", client: "" });
  const hidden = useStore((s) => s.data!.settings.hiddenReports);
  const update = useStore((s) => s.updateSettings);
  const [choosing, setChoosing] = useState(false);
  const show = (id: ReportId) => !hidden.includes(id);
  const setShown = (id: string, on: boolean) =>
    void update((x) => ({ ...x, hiddenReports: on ? x.hiddenReports.filter((h) => h !== id) : [...new Set([...x.hiddenReports, id])] }));
  const shownCount = REPORTS.filter((r) => show(r.id)).length;
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
      const gs = grants.filter((g) => isFor(g.fm, c.slug));
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
        <button className="btn" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
          Choose reports ({shownCount} of {REPORTS.length})
        </button>
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

      {choosing && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <strong className="grow">Show these reports</strong>
            <button className="btn small ghost" onClick={() => void update((x) => ({ ...x, hiddenReports: [] }))}>Show all</button>
            <button className="btn small ghost" onClick={() => setChoosing(false)}>Done</button>
          </div>
          <div className="report-choices">
            {REPORTS.map((r) => (
              <label key={r.id} className="check">
                <input type="checkbox" checked={show(r.id)} onChange={(e) => setShown(r.id, e.target.checked)} />
                {r.title}
              </label>
            ))}
          </div>
        </div>
      )}

      {all.length < 10 && (
        <div className="callout" style={{ marginBottom: 16 }}>
          <b>Reports get useful with history.</b> You have {all.length} application{all.length === 1 ? "" : "s"}. Import past applications from a
          spreadsheet or Notion to see real trends.{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); go({ screen: "import" }); }}>Go to Import →</a>
        </div>
      )}

      <div className="grid cols-2">
        {show("year") && <YearInReview grants={grants} client={client} />}
        {show("requested-awarded") && <ReportPanel id="requested-awarded" title="Requested vs. awarded">
          <div className="chart-box">
            <Bar
              data={{
                labels: ry.map((r) => String(r.year)),
                datasets: [
                  { label: "Requested", data: ry.map((r) => r.requested), backgroundColor: dataColor("st-planning", dataColors), borderRadius: 4, maxBarThickness: 32 },
                  { label: "Awarded", data: ry.map((r) => r.awarded), backgroundColor: dataColor("st-awarded", dataColors), borderRadius: 4, maxBarThickness: 32 },
                ],
              }}
              options={{ ...opts, scales: { ...opts.scales, y: moneyTicks } }}
            />
          </div>
        </ReportPanel>}
        {show("turnaround") && <ReportPanel id="turnaround" title="Average turnaround">
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
        </ReportPanel>}
        {show("win-type") && <ReportPanel id="win-type" title="Win rate by type">
          <div className="chart-box">
            <Bar
              data={{
                labels: byType.map((r) => `${r.label} (${r.decided})`),
                datasets: [{ label: "Win rate", data: byType.map((r) => Math.round(r.rate * 100)), backgroundColor: dataColor("st-submitted", dataColors), borderRadius: 4, maxBarThickness: 36 }],
              }}
              options={{ ...opts, plugins: { legend: { display: false } }, scales: { ...opts.scales, y: pctTicks } }}
            />
          </div>
        </ReportPanel>}
        {show("win-funder-type") && <ReportPanel id="win-funder-type" title="Win rate by funder type">
          <div className="chart-box">
            <Bar
              data={{
                labels: byFunderType.map((r) => `${r.label} (${r.decided})`),
                datasets: [{ label: "Win rate", data: byFunderType.map((r) => Math.round(r.rate * 100)), backgroundColor: dataColor("st-submitted", dataColors), borderRadius: 4, maxBarThickness: 36 }],
              }}
              options={{ ...opts, plugins: { legend: { display: false } }, scales: { ...opts.scales, y: pctTicks } }}
            />
          </div>
        </ReportPanel>}
        {show("by-funder") && <ReportPanel id="by-funder" title="Funding by funder">
          <div className="chart-box" style={{ height: Math.max(160, byFunder.length * 32 + 40) }}>
            <Bar
              data={{
                labels: byFunder.map((r) => r.label),
                datasets: [{ label: "Awarded", data: byFunder.map((r) => r.amount), backgroundColor: dataColor("st-awarded", dataColors), borderRadius: 4, maxBarThickness: 22 }],
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
        </ReportPanel>}
        {show("deadlines") && <ReportPanel id="deadlines" title="Deadlines by month">
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
                      style={{ background: n ? `color-mix(in srgb, var(--st-awarded) ${15 + (n / heatMax) * 70}%, transparent)` : "var(--hover)" }}
                    >
                      {n || ""}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </ReportPanel>}
        {show("giving") && <GivingPanel client={client} />}
        {show("documents") && <ReadinessPanel client={client} />}
      </div>
      {shownCount === 0 && (
        <div className="panel" style={{ textAlign: "center", padding: 32 }}>
          <p className="soft">All reports are hidden.</p>
          <button className="btn" onClick={() => setChoosing(true)}>Choose reports</button>
        </div>
      )}
    </div>
  );
}

function Big({ v, k, onClick }: { v: string; k: string; onClick?: () => void }) {
  return (
    <div className="stat" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

function YearInReview({ grants, client }: { grants: import("../lib/model").Grant[]; client: string }) {
  const donors = donorsFor(useStore((s) => s.data!.donors), client);
  const currency = useStore((s) => s.data!.settings.currency);
  const toast = useStore((s) => s.toast);
  const { funderName, clientName } = useLookups();
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear, ...grants.map(grantYear).filter((y): y is number => !!y)])].sort((a, b) => b - a);
  const [year, setYear] = useState(thisYear);
  const r = yearReview(grants, donors, year, client);
  const m = (n: number) => fmtMoney(n, currency, true);
  const who = client ? clientName(client) : "All clients";
  return (
    <ReportPanel
      id="year"
      wide
      title={<>Year in review <span className="muted small" style={{ fontWeight: 400 }}>· {who}</span></>}
      actions={
        <>
          <select className="select" aria-label="Year" style={{ width: "auto" }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            className="btn small ghost"
            title="Copy a short summary, for a board report or newsletter"
            onClick={async () => {
              await copyToClipboard(yearReviewText(r, who, funderName, currency));
              toast("Copied the summary");
            }}
          >
            Copy summary
          </button>
        </>
      }
    >
      <div className="stats" style={{ marginBottom: 12 }}>
        <Big v={String(r.submitted)} k={`Sent in ${year}`} />
        <Big v={m(r.requested)} k="Requested" />
        <Big v={`${r.awarded} · ${m(r.awardedTotal)}`} k="Awarded" />
        <Big v={r.winRate === null ? "—" : `${Math.round(r.winRate * 100)}%`} k={`Win rate (${r.awarded + r.declined} decided)`} />
        <Big v={String(r.pending)} k="Still waiting" />
      </div>
      <div className="grid cols-3" style={{ gap: 16 }}>
        <div>
          <h3 className="small soft">Top funders</h3>
          {r.topFunders.length ? (
            <table className="table"><tbody>
              {r.topFunders.map((t) => <tr key={t.slug}><td>{funderName(t.slug)}</td><td className="r num">{fmtMoney(t.amount, currency)}</td></tr>)}
            </tbody></table>
          ) : <p className="muted small">No awards decided in {year}.</p>}
        </div>
        <div>
          <h3 className="small soft">New funders applied to</h3>
          {r.newFunders.length ? <p className="small" style={{ margin: 0 }}>{r.newFunders.map(funderName).join(", ")}</p> : <p className="muted small">None.</p>}
        </div>
        <div>
          <h3 className="small soft">Also</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{r.minutes ? `${fmtMinutes(r.minutes)} logged on applications` : "No time logged"}</li>
            <li>{r.reportsDue} funder report{r.reportsDue === 1 ? "" : "s"} due</li>
            <li>
              {r.gifts.count ? `${fmtMoney(r.gifts.total, currency)} in individual gifts from ${r.gifts.donors} donor${r.gifts.donors === 1 ? "" : "s"}` : "No individual gifts logged"}
            </li>
          </ul>
        </div>
      </div>
    </ReportPanel>
  );
}

function GivingPanel({ client }: { client: string }) {
  const { clientName } = useLookups();
  const donors = donorsFor(useStore((s) => s.data!.donors), client);
  const currency = useStore((s) => s.data!.settings.currency);
  const dataColors = useStore((s) => s.data!.settings.dataColors);
  const open = useStore((s) => s.openDrawer);
  const go = useStore((s) => s.go);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const r = givingReport(donors, year, undefined, client);
  const opts = themeChartOptions();
  const years = [...new Set([thisYear, ...donors.flatMap((d) => d.fm.gifts.map((g) => Number(g.date.slice(0, 4))).filter(Boolean))])].sort((a, b) => b - a);
  return (
    <ReportPanel
      id="giving"
      wide
      title={<>Individual giving <span className="muted small" style={{ fontWeight: 400 }}>· {client ? clientName(client) : "All clients"}</span></>}
      actions={
        <select className="select" aria-label="Year" style={{ width: "auto" }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      }
    >
      {donors.length === 0 ? (
        <p className="muted">
          {client ? `No donors for ${clientName(client)} yet.` : "No donors yet."} <a href="#" onClick={(e) => { e.preventDefault(); go({ screen: "giving" }); }}>Add or import donors →</a>
        </p>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 12 }}>
            <Big v={fmtMoney(r.total, currency, true)} k={`Raised in ${year}`} />
            <Big v={String(r.donors)} k={`Donors (${r.newDonors} new, ${r.returningDonors} returning)`} />
            <Big v={r.retention === null ? "—" : `${Math.round(r.retention * 100)}%`} k={`Kept from ${year - 1}`} />
            <Big v={r.averageGift === null ? "—" : fmtMoney(Math.round(r.averageGift), currency, true)} k="Average gift" />
            <Big v={String(r.unthanked.count)} k="Gifts not yet thanked" onClick={() => go({ screen: "giving" })} />
          </div>
          <div className="grid cols-3" style={{ gap: 16 }}>
            <div>
              <h3 className="small soft">Last five years</h3>
              <div className="chart-box" style={{ height: 180 }}>
                <Bar
                  data={{
                    labels: r.byYear.map((y) => String(y.year)),
                    datasets: [{ label: "Raised", data: r.byYear.map((y) => y.total), backgroundColor: dataColor("st-awarded", dataColors), borderRadius: 4, maxBarThickness: 28 }],
                  }}
                  options={{ ...opts, plugins: { legend: { display: false } }, scales: { ...opts.scales, y: { ...opts.scales.y, ticks: { color: cssVar("--muted"), callback: (v: string | number) => fmtMoney(Number(v), currency, true) } } } }}
                />
              </div>
            </div>
            <div>
              <h3 className="small soft">Top donors in {year}</h3>
              {r.topDonors.length ? (
                <table className="table"><tbody>
                  {r.topDonors.map((d) => (
                    <tr key={d.slug} className="click" onClick={() => open({ kind: "donor", id: d.slug })}>
                      <td>{d.name}</td><td className="r num">{fmtMoney(d.total, currency)}</td>
                    </tr>
                  ))}
                </tbody></table>
              ) : <p className="muted small">No gifts in {year}.</p>}
            </div>
            <div>
              <h3 className="small soft">How they gave</h3>
              {r.byMethod.length ? (
                <table className="table"><tbody>
                  {r.byMethod.map((x) => <tr key={x.method}><td>{x.method}</td><td className="r num muted">{x.count}</td><td className="r num">{fmtMoney(x.total, currency)}</td></tr>)}
                </tbody></table>
              ) : <p className="muted small">—</p>}
              {r.lapsed > 0 && <p className="small warn-text" style={{ marginTop: 8 }}>{r.lapsed} donor{r.lapsed === 1 ? " hasn't" : "s haven't"} given in 18 months.</p>}
            </div>
          </div>
        </>
      )}
    </ReportPanel>
  );
}

const READY_LABEL: Record<ReadinessState, string> = { ok: "✓", soon: "Expiring", expired: "Expired", missing: "Missing" };
const READY_CLASS: Record<ReadinessState, string> = { ok: "ok-text", soon: "warn-text", expired: "danger-text", missing: "muted" };

function ReadinessPanel({ client }: { client: string }) {
  const data = useStore((s) => s.data!);
  const open = useStore((s) => s.openDrawer);
  const go = useStore((s) => s.go);
  const { clientName } = useLookups();
  const clients = data.clients.filter((c) => !client || c.slug === client);
  const rows = documentReadiness(clients, data.documents);
  const expiring = expiringDocuments(data.documents, clients.map((c) => c.slug));
  return (
    <ReportPanel id="documents" wide title="Document readiness">
      <p className="muted small" style={{ marginTop: 0 }}>
        The paperwork funders ask for most. Individual artists usually only need a W-9; organizations and fiscally sponsored projects need more.
        Click a cell to open the document, or <a href="#" onClick={(e) => { e.preventDefault(); go({ screen: "documents" }); }}>add documents</a>.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Client</th>
              {READINESS_COLUMNS.map((c) => <th key={c.label}>{c.label}</th>)}
              <th className="r">Ready</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.client}>
                <td style={{ fontWeight: 550 }}>{clientName(r.client)}</td>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    className={`small ${READY_CLASS[c.state]}${c.doc ? " click" : ""}`}
                    title={c.doc ? `${c.doc.fm.title}${c.doc.fm.expires ? ` · expires ${fmtDate(c.doc.fm.expires, { year: true })}` : ""}` : undefined}
                    onClick={() => c.doc && open({ kind: "document", id: c.doc.path })}
                  >
                    {READY_LABEL[c.state]}
                  </td>
                ))}
                <td className="r num">{r.ready} of {READINESS_COLUMNS.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {expiring.length > 0 && (
        <>
          <h3 className="small soft" style={{ marginTop: 14 }}>Expired or expiring in the next 60 days</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {expiring.map((d) => (
              <li key={d.path}>
                <a href="#" onClick={(e) => { e.preventDefault(); open({ kind: "document", id: d.path }); }}>{d.fm.title}</a>
                <span className="muted"> · {clientName(d.path.split("/")[0])} · {(daysUntil(d.fm.expires) ?? 0) < 0 ? "expired" : "expires"} {relDays(daysUntil(d.fm.expires))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ReportPanel>
  );
}
