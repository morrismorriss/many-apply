import { useMemo, useState } from "react";
import { useStore } from "../store";
import { askText } from "../components/dialogs";
import { DONOR_STAGES, DONOR_STAGE_LABEL, looksLapsed, summarize, type DonorStage } from "../lib/donors";
import { fmtDate, fmtMoney, todayISO } from "../lib/util";

const STAGE_SHADE: Record<DonorStage, string> = {
  prospect: "var(--st-researching)",
  "first-time": "var(--st-planning)",
  active: "var(--st-submitted)",
  major: "var(--st-awarded)",
  lapsed: "var(--st-withdrawn)",
};

export function StagePill({ stage }: { stage: DonorStage }) {
  return (
    <span className="pill" style={{ ["--c" as string]: STAGE_SHADE[stage] }}>
      {DONOR_STAGE_LABEL[stage]}
    </span>
  );
}

type Sort = "name" | "lifetime" | "last" | "followup";

export function Giving() {
  const donors = useStore((s) => s.data!.donors);
  const currency = useStore((s) => s.data!.settings.currency);
  const open = useStore((s) => s.openDrawer);
  const addDonor = useStore((s) => s.addDonor);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"" | DonorStage | "followup" | "unthanked">("");
  const [sort, setSort] = useState<Sort>("followup");
  const today = todayISO();
  const year = new Date().getFullYear();

  const rows = useMemo(() => donors.map((d) => ({ d, s: summarize(d, year) })), [donors, year]);

  const totals = useMemo(() => {
    const giftsThisYear = rows.flatMap((r) => r.d.fm.gifts.filter((g) => g.date.startsWith(String(year))));
    const raised = giftsThisYear.reduce((s, g) => s + g.amount, 0);
    const givers = rows.filter((r) => r.s.thisYear > 0).length;
    return {
      raised,
      givers,
      avg: giftsThisYear.length ? raised / giftsThisYear.length : null,
      due: rows.filter((r) => r.d.fm.next_followup && r.d.fm.next_followup <= today).length,
      unthanked: rows.reduce((n, r) => n + r.s.unthanked, 0),
    };
  }, [rows, year, today]);

  const shown = rows
    .filter(({ d, s }) => {
      if (stage === "followup") return !!d.fm.next_followup && d.fm.next_followup <= today;
      if (stage === "unthanked") return s.unthanked > 0;
      if (stage && d.fm.stage !== stage) return false;
      if (!q.trim()) return true;
      const hay = [d.fm.name, d.fm.email, d.fm.organization, d.fm.tags.join(" "), d.fm.next_step].join(" ").toLowerCase();
      return hay.includes(q.trim().toLowerCase());
    })
    .sort((a, b) => {
      if (sort === "lifetime") return b.s.lifetime - a.s.lifetime;
      if (sort === "last") return (b.s.lastGift?.date ?? "").localeCompare(a.s.lastGift?.date ?? "");
      if (sort === "followup") {
        const fa = a.d.fm.next_followup || "9999";
        const fb = b.d.fm.next_followup || "9999";
        return fa.localeCompare(fb) || a.d.fm.name.localeCompare(b.d.fm.name);
      }
      return a.d.fm.name.localeCompare(b.d.fm.name);
    });

  const add = async () => {
    const name = await askText("New donor", { placeholder: "Full name" });
    if (name?.trim()) open({ kind: "donor", id: await addDonor(name.trim()) });
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Individual Giving</h1>
          <div className="sub">The people who give to your work: gifts, thank-yous and the next follow-up.</div>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={add}>
          + New donor
        </button>
      </div>

      <div className="stats">
        <Stat v={fmtMoney(totals.raised, currency, true)} k={`Raised in ${year}`} />
        <Stat v={String(totals.givers)} k={`Donors in ${year}`} />
        <Stat v={totals.avg === null ? "—" : fmtMoney(totals.avg, currency, true)} k="Average gift" />
        <Stat v={String(totals.due)} k="Follow-ups due" onClick={() => setStage("followup")} />
        <Stat v={String(totals.unthanked)} k="Gifts to thank" onClick={() => setStage("unthanked")} />
      </div>

      {donors.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: 40 }}>
          <h2>No donors yet</h2>
          <p className="soft">Add the people who've supported you, log their gifts, and set a date to check in again.</p>
          <button className="btn primary" onClick={add}>+ Add your first donor</button>
          <p className="muted small" style={{ marginTop: 16 }}>Each donor is a file in donors/ in your vault.</p>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <input className="input" style={{ width: 240 }} placeholder="Search name, email, tag…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="select" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
              <option value="">All donors</option>
              {DONOR_STAGES.map((s) => <option key={s} value={s}>{DONOR_STAGE_LABEL[s]}</option>)}
              <option value="followup">Follow-up due</option>
              <option value="unthanked">Not yet thanked</option>
            </select>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="followup">Sort: next follow-up</option>
              <option value="name">Sort: name</option>
              <option value="lifetime">Sort: lifetime giving</option>
              <option value="last">Sort: most recent gift</option>
            </select>
            <span className="muted small">{shown.length} of {donors.length}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Stage</th>
                  <th className="r">This year</th>
                  <th className="r">Lifetime</th>
                  <th>Last gift</th>
                  <th>Next follow-up</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ d, s }) => {
                  const due = d.fm.next_followup && d.fm.next_followup <= today;
                  return (
                    <tr key={d.slug} className="click" onClick={() => open({ kind: "donor", id: d.slug })}>
                      <td>
                        <div style={{ fontWeight: 550 }}>{d.fm.name}</div>
                        {(d.fm.organization || d.fm.email) && <div className="muted small">{d.fm.organization || d.fm.email}</div>}
                      </td>
                      <td>
                        <StagePill stage={d.fm.stage} />
                        {d.fm.stage !== "lapsed" && looksLapsed(d, today) && <span className="muted small"> · no gift in 18 mo</span>}
                      </td>
                      <td className="r num">{s.thisYear ? fmtMoney(s.thisYear, currency) : <span className="muted">—</span>}</td>
                      <td className="r num">{s.lifetime ? fmtMoney(s.lifetime, currency) : <span className="muted">—</span>}</td>
                      <td className="small">
                        {s.lastGift ? (
                          <>
                            {fmtMoney(s.lastGift.amount, currency)} · {fmtDate(s.lastGift.date, { year: true })}
                            {s.unthanked > 0 && <span className="warn-text"> · thank</span>}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="small">
                        {d.fm.next_followup ? (
                          <span className={due ? "danger-text" : ""}>
                            {fmtDate(d.fm.next_followup, { year: true })}
                            {d.fm.next_step && <span className="soft"> · {d.fm.next_step}</span>}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ v, k, onClick }: { v: string; k: string; onClick?: () => void }) {
  return (
    <div className="stat" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}
