import { useEffect, useMemo, useState } from "react";
import { useLookups, useStore } from "../store";
import { askText, confirmAction } from "../components/dialogs";
import { ClientSelect, MenuButton, Modal } from "../components/ui";
import { readCsv, type ParsedCsv } from "../lib/csvImport";
import {
  DONOR_FIELDS,
  DONOR_SKIP,
  applyDonorImport,
  autoDonorMapping,
  donorDatesAmbiguous,
  planDonorImport,
  listDonorImports,
  saveDonorImportLog,
  undoDonorImportLog,
  type DonorImportLog,
} from "../lib/donorImport";
import type { DateOrder } from "../lib/extract";
import { errorText, pickFile, saveFile } from "../lib/platform";
import { donorsCsv, giftsCsv } from "../lib/donorExport";
import { DONOR_STAGES, DONOR_STAGE_LABEL, donorsFor, giftsFor, looksLapsed, summarize, writeDonor, type DonorStage } from "../lib/donors";
import { ME } from "../lib/model";
import { fmtDate, fmtMoney, slugify, todayISO } from "../lib/util";

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
  const allDonors = useStore((s) => s.data!.donors);
  const clientFilter = useStore((s) => s.clientFilter);
  const clients = useStore((s) => s.data!.clients);
  const { clientName } = useLookups();
  const donors = useMemo(() => donorsFor(allDonors, clientFilter), [allDonors, clientFilter]);
  const showGaveTo = !clientFilter && clients.length > 1;
  const currency = useStore((s) => s.data!.settings.currency);
  const open = useStore((s) => s.openDrawer);
  const addDonor = useStore((s) => s.addDonor);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"" | DonorStage | "followup" | "unthanked">("");
  const [sort, setSort] = useState<Sort>("followup");
  const toast = useStore((s) => s.toast);
  const [csv, setCsv] = useState<(ParsedCsv & { name: string }) | null>(null);
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const mutate = useStore((s) => s.mutate);
  const today = todayISO();
  const year = new Date().getFullYear();

  // With a client chosen in the sidebar, totals count only gifts to that client.
  const rows = useMemo(() => donors.map((d) => ({ d, s: summarize(d, year, clientFilter) })), [donors, year, clientFilter]);

  const totals = useMemo(() => {
    const giftsThisYear = rows.flatMap((r) => giftsFor(r.d, clientFilter).filter((g) => g.date.startsWith(String(year))));
    const raised = giftsThisYear.reduce((s, g) => s + g.amount, 0);
    const givers = rows.filter((r) => r.s.thisYear > 0).length;
    return {
      raised,
      givers,
      avg: giftsThisYear.length ? raised / giftsThisYear.length : null,
      due: rows.filter((r) => r.d.fm.next_followup && r.d.fm.next_followup <= today).length,
      unthanked: rows.reduce((n, r) => n + r.s.unthanked, 0),
    };
  }, [rows, year, today, clientFilter]);

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

  // Bulk "thanked": marks every unthanked gift (to the sidebar's client, if one is chosen) from the selected donors.
  const selected = shown.filter(({ d }) => picked.has(d.slug)).map(({ d }) => d);
  const toThank = selected.reduce((n, d) => n + giftsFor(d, clientFilter).filter((g) => !g.acknowledged).length, 0);
  const markThanked = async () => {
    const before = selected.map((d) => structuredClone(d));
    const marking = new Set(selected.flatMap((d) => giftsFor(d, clientFilter).filter((g) => !g.acknowledged)));
    const n = marking.size;
    await mutate(async (fs) => {
      for (const d of selected) await writeDonor(fs, { ...d, fm: { ...d.fm, gifts: d.fm.gifts.map((g) => (marking.has(g) ? { ...g, acknowledged: true } : g)) } });
    });
    setPicked(new Set());
    toast(`Marked ${n} gift${n === 1 ? "" : "s"} thanked`, "ok", {
      label: "Undo",
      run: async () => {
        await mutate(async (fs) => {
          for (const d of before) await writeDonor(fs, d);
        });
      },
    });
  };

  const add = async () => {
    const name = await askText("New donor", { placeholder: "Full name" });
    if (name?.trim()) open({ kind: "donor", id: await addDonor(name.trim(), clientFilter || ME) });
  };

  const importCsv = async () => {
    const f = await pickFile(["csv", "tsv", "txt"]);
    if (!f) return;
    const parsed = readCsv(f.text);
    if (!parsed.headers.length || !parsed.rows.length) {
      toast("That file has no rows to import.", "warn");
      return;
    }
    setCsv({ ...parsed, name: f.name });
  };

  return (
    <div className="page wide">
      {exporting && <DonorExportDialog initialClient={clientFilter} onClose={() => setExporting(false)} />}
      {csv && <DonorImportDialog csv={csv} initialClient={clientFilter || ME} onClose={() => setCsv(null)} />}
      {history && <ImportHistory onClose={() => setHistory(false)} />}
      <div className="page-head">
        <div>
          <h1>Individual Giving</h1>
          <div className="sub">The people who give to your work: gifts, thank-yous and the next follow-up.</div>
        </div>
        <span className="spacer" />
        <button className="btn" disabled={allDonors.length === 0} onClick={() => setExporting(true)} title="Save donors or gifts as a spreadsheet">
          Export CSV…
        </button>
        <MenuButton
          label="Import ▾"
          className="btn"
          items={[
            { label: "Import a CSV…", run: () => void importCsv() },
            { label: "Past imports and undo…", run: () => setHistory(true) },
          ]}
        />
        <button className="btn primary" onClick={add}>
          + New donor
        </button>
      </div>

      <div className="stats">
        <Stat v={fmtMoney(totals.raised, currency, true)} k={`Raised in ${year}`} />
        <Stat v={String(totals.givers)} k={`Donors in ${year}`} />
        <Stat v={totals.avg === null ? "—" : fmtMoney(Math.round(totals.avg), currency, true)} k="Average gift" />
        <Stat v={String(totals.due)} k="Follow-ups due" onClick={() => setStage("followup")} />
        <Stat v={String(totals.unthanked)} k="Gifts to thank" onClick={() => setStage("unthanked")} />
      </div>

      {donors.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: 40 }}>
          <h2>{clientFilter ? `No donors for ${clientName(clientFilter)} yet` : "No donors yet"}</h2>
          <p className="soft">Add the people who've supported you, log their gifts, and set a date to check in again.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={add}>+ Add your first donor</button>
            <button className="btn" onClick={() => void importCsv()}>Import a CSV…</button>
          </div>
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
            {selected.length > 0 && (
              <>
                <span className="grow" />
                <span className="small soft">{selected.length} selected</span>
                <button
                  className="btn small primary"
                  disabled={toThank === 0}
                  title={toThank ? `Marks ${toThank} gift${toThank === 1 ? "" : "s"} as thanked` : "Every gift from these donors is already marked thanked"}
                  onClick={() => void markThanked()}
                >
                  Mark thanked{toThank ? ` (${toThank})` : ""}
                </button>
                <button className="btn small ghost" onClick={() => setPicked(new Set())}>Clear</button>
              </>
            )}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={shown.length > 0 && shown.every(({ d }) => picked.has(d.slug))}
                      onChange={(e) => setPicked(e.target.checked ? new Set(shown.map(({ d }) => d.slug)) : new Set())}
                    />
                  </th>
                  <th>Name</th>
                  {showGaveTo && <th>Gave to</th>}
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
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${d.fm.name}`}
                          checked={picked.has(d.slug)}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(d.slug);
                            else next.delete(d.slug);
                            setPicked(next);
                          }}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 550 }}>{d.fm.name}</div>
                        {(d.fm.organization || d.fm.email) && <div className="muted small">{d.fm.organization || d.fm.email}</div>}
                      </td>
                      {showGaveTo && <td className="soft small">{d.fm.gave_to.map(clientName).join(", ")}</td>}
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

function DonorImportDialog({ csv, initialClient, onClose }: { csv: ParsedCsv & { name: string }; initialClient: string; onClose: () => void }) {
  const donors = useStore((s) => s.data!.donors);
  const clients = useStore((s) => s.data!.clients);
  const { clientName } = useLookups();
  const [client, setClient] = useState(initialClient);
  const currency = useStore((s) => s.data!.settings.currency);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const [mapping, setMapping] = useState(() => autoDonorMapping(csv.headers));
  const [dateOrder, setDateOrder] = useState<DateOrder>("us");
  const [busy, setBusy] = useState(false);
  const clientList = useMemo(() => clients.map((c) => ({ slug: c.slug, name: c.fm.name })), [clients]);
  const plan = useMemo(
    () => planDonorImport(donors, csv.rows, { mapping, dateOrder, client, clients: clientList }),
    [donors, csv, mapping, dateOrder, client, clientList],
  );
  const ambiguous = useMemo(() => donorDatesAmbiguous(csv.rows, mapping), [csv, mapping]);
  const mapped = new Set(Object.values(mapping));
  const hasPerson = mapped.has("name") || mapped.has("email") || mapped.has("first_name") || mapped.has("last_name");

  const run = async () => {
    setBusy(true);
    try {
      const log = await mutate(async (fs) => saveDonorImportLog(fs, await applyDonorImport(fs, plan), { file: csv.name, client, plan }));
      onClose();
      toast(`Imported: ${plan.created} new, ${plan.updated} updated, ${plan.gifts} gift${plan.gifts === 1 ? "" : "s"}. Undo it any time from Import → Past imports.`, "ok", {
        label: "Undo",
        run: async () => {
          await mutate((fs) => undoDonorImportLog(fs, log));
        },
      });
    } catch (e) {
      toast(`Couldn't import: ${errorText(e)}`, "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Import donors from ${csv.name}`}
      width={720}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !hasPerson || plan.entries.length === 0} onClick={() => void run()}>
            Import
          </button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="soft">These donors gave to</span>
        <ClientSelect className="select" style={{ width: "auto", maxWidth: 260 }} value={client} onChange={setClient} />
      </div>
      <p className="soft small" style={{ marginTop: 0 }}>
        One row can be a person, a gift, or both. Rows with the same email (or the same name, if there's no email) are merged, and so are
        donors you already have: they keep one file, and {clientName(client)} is added to who they give to. Details you've already filled in
        are never overwritten. A "Gave to" column, if your file has one, sends each row to the clients it names (separate several with ;).
      </p>
      <div className="table-wrap" style={{ maxHeight: 320, overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Column in your file</th>
              <th>First row</th>
              <th>Goes to</th>
            </tr>
          </thead>
          <tbody>
            {csv.headers.map((h) => (
              <tr key={h}>
                <td style={{ fontWeight: 550 }}>{h}</td>
                <td className="soft small ellipsis" style={{ maxWidth: 200 }}>{csv.rows.find((r) => r[h]?.trim())?.[h] ?? ""}</td>
                <td>
                  <select className="select" aria-label={`Field for ${h}`} value={mapping[h] ?? DONOR_SKIP} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                    <option value={DONOR_SKIP}>Don't import</option>
                    {DONOR_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ambiguous && (
        <div className="row small" style={{ marginTop: 10 }}>
          <span className="soft">Dates like 3/4/2026 mean</span>
          <select className="select" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as DateOrder)}>
            <option value="us">March 4 (month first)</option>
            <option value="dayfirst">3 April (day first)</option>
          </select>
        </div>
      )}
      <div className="callout small" style={{ marginTop: 12 }}>
        {!hasPerson ? (
          <span className="warn-text">Choose which column has the name or the email.</span>
        ) : (
          <>
            <strong>{plan.created}</strong> new donor{plan.created === 1 ? "" : "s"}, <strong>{plan.updated}</strong> updated,{" "}
            <strong>{plan.gifts}</strong> gift{plan.gifts === 1 ? "" : "s"} logged
            {plan.gifts > 0 && <> ({fmtMoney(plan.giftTotal, currency)})</>}.
            {plan.duplicateGifts > 0 && <> {plan.duplicateGifts} gift{plan.duplicateGifts === 1 ? " is" : "s are"} already logged and will be skipped.</>}
            {plan.skippedRows > 0 && <> {plan.skippedRows} row{plan.skippedRows === 1 ? " has" : "s have"} no name or email and will be skipped.</>}
            {plan.badRows.length > 0 && (
              <div className="warn-text" style={{ marginTop: 4 }}>
                Couldn't read the date or amount on row{plan.badRows.length === 1 ? "" : "s"} {plan.badRows.slice(0, 8).join(", ")}
                {plan.badRows.length > 8 ? "…" : ""}. Those gifts will be skipped.
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function DonorExportDialog({ initialClient, onClose }: { initialClient: string; onClose: () => void }) {
  const all = useStore((s) => s.data!.donors);
  const clients = useStore((s) => s.data!.clients);
  const toast = useStore((s) => s.toast);
  const { clientName } = useLookups();
  const [who, setWho] = useState(initialClient);
  const [kind, setKind] = useState<"donors" | "gifts">("donors");
  const donors = donorsFor(all, who);
  const gifts = donors.reduce((n, d) => n + d.fm.gifts.length, 0);
  const count = kind === "donors" ? donors.length : gifts;

  const run = async () => {
    const text = kind === "donors" ? donorsCsv(donors, clientName, undefined, who) : giftsCsv(donors, clientName, who);
    const name = `${kind}-${who ? slugify(clientName(who)) : "all-clients"}-${todayISO()}.csv`;
    try {
      const p = await saveFile(name, text, "text/csv");
      if (p) {
        toast(`Exported ${count} ${kind === "donors" ? (count === 1 ? "donor" : "donors") : count === 1 ? "gift" : "gifts"}`);
        onClose();
      }
    } catch (e) {
      toast(`Couldn't export: ${errorText(e)}`, "error");
    }
  };

  return (
    <Modal
      title="Export Individual Giving"
      width={520}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={count === 0} onClick={() => void run()}>Export {count}</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <label className="field" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="soft small">Whose donors</span>
          <select className="select" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.fm.name} ({donorsFor(all, c.slug).length})
              </option>
            ))}
          </select>
        </label>
        <div>
          <div className="soft small" style={{ marginBottom: 6 }}>What to export</div>
          <label className="check" style={{ marginBottom: 6 }}>
            <input type="radio" name="kind" checked={kind === "donors"} onChange={() => setKind("donors")} />
            <span>
              <strong>Donors</strong>, one row per person: contact details, who they gave to, stage, lifetime and this year's giving, last gift,
              next follow-up and notes.
            </span>
          </label>
          <label className="check">
            <input type="radio" name="kind" checked={kind === "gifts"} onChange={() => setKind("gifts")} />
            <span>
              <strong>Gifts</strong>, one row per gift: date, donor, amount, method, note and whether it's been thanked. Good for your accountant or
              a year-end tally.
            </span>
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {donors.length} donor{donors.length === 1 ? "" : "s"}, {gifts} gift{gifts === 1 ? "" : "s"}. The file opens in Excel, Numbers or Google
          Sheets, and Many Apply's CSV import reads it back.
        </p>
      </div>
    </Modal>
  );
}

function ImportHistory({ onClose }: { onClose: () => void }) {
  const fs = useStore((s) => s.fs!);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const { clientName } = useLookups();
  const [logs, setLogs] = useState<DonorImportLog[] | null>(null);
  const load = () => void listDonorImports(fs).then(setLogs).catch(() => setLogs([]));
  useEffect(load, [fs]);

  const undo = async (log: DonorImportLog) => {
    const ok = await confirmAction(
      `Undo the import of ${log.file}?`,
      `${log.createdCount} donor${log.createdCount === 1 ? "" : "s"} it added go to trash, and ${log.updatedCount} it updated go back to how they were before it. Changes made to those donors since the import are lost.`,
      { okLabel: "Undo import", danger: true },
    );
    if (!ok) return;
    try {
      await mutate((v) => undoDonorImportLog(v, log));
      toast(`Undid the import of ${log.file}`);
      load();
    } catch (e) {
      toast(`Couldn't undo it: ${errorText(e)}`, "error");
    }
  };

  return (
    <Modal title="Past donor imports" width={620} onClose={onClose} actions={<button className="btn" onClick={onClose}>Done</button>}>
      {logs === null ? (
        <p className="muted">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="muted">No donor imports yet.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 380, overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>When</th><th>File</th><th>For</th><th className="r">Added</th><th className="r">Updated</th><th className="r">Gifts</th><th /></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>{new Date(l.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="small ellipsis" style={{ maxWidth: 160 }}>{l.file}</td>
                  <td className="small soft">{clientName(l.client)}</td>
                  <td className="r num">{l.createdCount}</td>
                  <td className="r num">{l.updatedCount}</td>
                  <td className="r num">{l.gifts}</td>
                  <td className="r">
                    {l.undone ? <span className="muted small">Undone</span> : <button className="btn small" onClick={() => void undo(l)}>Undo</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ marginBottom: 0 }}>Kept in <code>.manyapply/imports/</code> in your vault.</p>
    </Modal>
  );
}
