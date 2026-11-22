import { Fragment, useEffect, useMemo, useState } from "react";
import { useLookups, useStore } from "../store";
import {
  autoMapping,
  buildPreview,
  distinctStatusValues,
  EXTRA,
  exportGrantsCsv,
  guessStatus,
  IMPORT_FIELDS,
  listImports,
  NOTES,
  readCsv,
  runImport,
  SKIP,
  starterTemplateCsv,
  undoImport,
  type ImportLog,
  type Mapping,
  type ParsedCsv,
} from "../lib/csvImport";
import { pickFile, saveFile } from "../lib/platform";
import { STATUSES, STATUS_LABEL, type Status } from "../lib/model";
import { askText, confirmAction } from "../components/dialogs";
import { InlineText, StatusPill } from "../components/ui";
import { fmtDate, fmtMoney } from "../lib/util";

const FIELD_OPTIONS = [
  ...IMPORT_FIELDS.filter((f) => !f.key.startsWith("report_")).map((f) => ({ key: f.key, label: f.label })),
  { key: "report_1_title", label: "Report 1 title" },
  { key: "report_1_due", label: "Report 1 due" },
  { key: "report_2_title", label: "Report 2 title" },
  { key: "report_2_due", label: "Report 2 due" },
  { key: "report_3_title", label: "Report 3 title" },
  { key: "report_3_due", label: "Report 3 due" },
];

export function ImportScreen() {
  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Import</h1>
          <div className="sub">Bring your history from Notion, Google Sheets, Excel or Airtable, so Reports have something to show.</div>
        </div>
      </div>
      <div className="import">
        <Guide />
        <Importer />
      </div>
    </div>
  );
}

function Guide() {
  const [showFields, setShowFields] = useState(false);
  return (
    <div className="panel guide">
      <h2>How to import</h2>
      <ol>
        <li>
          <b>Export your tracker as a CSV.</b>
          <span className="soft small">
            <b style={{ display: "inline" }}>Notion:</b> ••• menu → Export → Markdown & CSV, then unzip and use the .csv.
            <br />
            <b style={{ display: "inline" }}>Google Sheets:</b> File → Download → Comma-separated values (.csv).
            <br />
            <b style={{ display: "inline" }}>Excel:</b> File → Save As → CSV UTF-8.
            <br />
            <b style={{ display: "inline" }}>Airtable:</b> view menu (▾ next to the view name) → Download CSV.
          </span>
        </li>
        <li>
          <b>Check your columns.</b>
          <span className="soft small">
            You need a title column. Everything else is optional.{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); void saveFile("many-apply-template.csv", starterTemplateCsv(), "text/csv"); }}>
              Download the starter template
            </a>{" "}
            to see the ideal format, or to start fresh in a spreadsheet.
          </span>
        </li>
        <li>
          <b>Match columns to fields.</b>
          <span className="soft small">
            Each of your columns gets a dropdown. Common names are matched for you.{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setShowFields(!showFields); }}>
              {showFields ? "Hide" : "Show"} the field reference
            </a>
          </span>
        </li>
        <li>
          <b>Match your status words.</b>
          <span className="soft small">
            Your labels (like "In progress", "Sent", "Won", "Rejected") get matched to Many Apply's seven statuses. Blank means Researching.
          </span>
        </li>
        <li>
          <b>Preview, then import.</b>
          <span className="soft small">Nothing is written until you confirm. Imports can be undone.</span>
        </li>
      </ol>
      {showFields && (
        <table className="table small" style={{ marginTop: 8 }}>
          <thead>
            <tr><th>Field</th><th>Accepts</th><th>Example</th></tr>
          </thead>
          <tbody>
            {IMPORT_FIELDS.map((f) => (
              <tr key={f.key}>
                <td>
                  <code>{f.key}</code>
                  {f.required && <span className="danger-text"> *</span>}
                  <div className="muted">{f.meaning}</div>
                </td>
                <td className="soft">{f.formats}</td>
                <td className="soft">{f.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Importer() {
  const data = useStore((s) => s.data!);
  const fs = useStore((s) => s.fs!);
  const mutate = useStore((s) => s.mutate);
  const updateSettings = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const go = useStore((s) => s.go);
  const { funderName, clientName } = useLookups();
  // `lines` holds each remaining row's original spreadsheet row number, so
  // labels stay meaningful after rows are removed.
  const [file, setFile] = useState<{ name: string; csv: ParsedCsv; lines: number[]; total: number } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [shown, setShown] = useState(50);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [result, setResult] = useState<ImportLog | null>(null);
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshLogs = () => void listImports(fs).then(setLogs);
  useEffect(refreshLogs, [fs]);

  const load = (name: string, text: string) => {
    const csv = readCsv(text);
    if (!csv.headers.length) {
      toast("That file doesn't look like a CSV with a header row.", "error");
      return;
    }
    // Pick a saved preset whose columns all exist in this file.
    const preset = data.settings.importPresets.find((p) => Object.keys(p.columns).every((h) => csv.headers.includes(h)));
    setFile({ name, csv, lines: csv.rows.map((_, i) => i + 2), total: csv.rows.length });
    setMapping(autoMapping(csv, preset));
    setResult(null);
    setEditing(null);
    setShown(50);
    if (preset) toast(`Using saved mapping "${preset.name}"`);
  };

  const preview = useMemo(() => (file && mapping ? buildPreview(file.csv, mapping, data.grants) : []), [file, mapping, data.grants]);
  const statusValues = useMemo(() => (file && mapping ? distinctStatusValues(file.csv, mapping) : []), [file, mapping]);
  const hasTitle = mapping && Object.values(mapping.columns).includes("title");
  const dupes = preview.filter((p) => p.duplicateOf).length;
  const errors = preview.filter((p) => p.error).length;
  const warnings = preview.filter((p) => p.warnings.length).length;

  const setCol = (h: string, field: string) => {
    if (!mapping || !file) return;
    const columns = { ...mapping.columns };
    // Each Many Apply field maps from one column only.
    if (field && field !== EXTRA && field !== NOTES) for (const k of Object.keys(columns)) if (columns[k] === field) columns[k] = SKIP;
    columns[h] = field;
    const statuses = { ...mapping.statuses };
    for (const v of distinctStatusValues(file.csv, { columns })) if (!(v in statuses)) statuses[v] = guessStatus(v);
    setMapping({ ...mapping, columns, statuses });
  };

  const removeRow = (i: number) => {
    if (!file) return;
    setFile({ ...file, csv: { ...file.csv, rows: file.csv.rows.filter((_, j) => j !== i) }, lines: file.lines.filter((_, j) => j !== i) });
    setEditing((e) => (e === null || e === i ? null : e > i ? e - 1 : e));
  };

  const editCell = (i: number, header: string, value: string) => {
    if (!file || !mapping) return;
    const rows = file.csv.rows.map((r, j) => (j === i ? { ...r, [header]: value } : r));
    const csv = { ...file.csv, rows };
    setFile({ ...file, csv });
    // A new status word needs a match too.
    const statuses = { ...mapping.statuses };
    let changed = false;
    for (const v of distinctStatusValues(csv, mapping)) if (!(v in statuses)) { statuses[v] = guessStatus(v); changed = true; }
    if (changed) setMapping({ ...mapping, statuses });
  };

  const doImport = async () => {
    if (!file || !mapping) return;
    setBusy(true);
    try {
      const log = await mutate((fs) => runImport(fs, preview, mapping, file.name, file.lines));
      setResult(log);
      refreshLogs();
      const name = await askText("Save this mapping?", {
        message: "Re-importing an updated export from the same tracker will take one click.",
        placeholder: "My Notion tracker",
        okLabel: "Save preset",
      });
      if (name) {
        await updateSettings((s) => ({
          ...s,
          importPresets: [
            ...s.importPresets.filter((p) => p.name !== name),
            { name, columns: mapping.columns, statuses: mapping.statuses, dateOrder: mapping.dateOrder },
          ],
        }));
        toast(`Saved "${name}"`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      {!file && (
        <div
          className={`drop-zone${over ? " over" : ""}`}
          onDragEnter={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setOver(true);
          }}
          onDragLeave={(e) => {
            // Moving over the zone's own children fires dragleave too.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (!f) return;
            if (!/\.(csv|tsv|txt)$/i.test(f.name)) {
              toast("Drop a .csv file (or .tsv / .txt).", "error");
              return;
            }
            load(f.name, await f.text());
          }}
          onClick={async () => {
            const f = await pickFile(["csv", "tsv", "txt"]);
            if (f) load(f.name, f.text);
          }}
        >
          <div style={{ fontSize: 28 }}>⇪</div>
          <div style={{ fontWeight: 550, color: "var(--text)" }}>Drop a CSV file here, or click to browse</div>
          <div className="small">UTF-8, with or without Excel's byte-order mark. Commas or semicolons.</div>
        </div>
      )}

      {result && (
        <div className="panel">
          <h2>Done</h2>
          <p>
            <b>{result.created.length} imported</b>
            {result.merged.length ? `, ${result.merged.length} merged` : ""}, {result.skipped.length} skipped.
            {result.createdFunders.length ? ` ${result.createdFunders.length} new funders.` : ""}
            {result.createdClients.length ? ` ${result.createdClients.length} new clients.` : ""}
          </p>
          {result.skipped.length > 0 && (
            <details>
              <summary className="small">Skipped rows</summary>
              <ul className="small">
                {result.skipped.map((s) => (
                  <li key={s.row}>
                    Row {s.row}: {s.title || <i>untitled</i>} ({s.reason})
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => go({ screen: "pipeline" })}>View Pipeline</button>
            <button className="btn" onClick={() => { setFile(null); setMapping(null); setResult(null); }}>Import another file</button>
          </div>
        </div>
      )}

      {file && mapping && !result && (
        <>
          <div className="panel">
            <h2>
              {file.name} <span className="muted small" style={{ fontWeight: 400 }}>{file.csv.rows.length} rows{file.total > file.csv.rows.length ? ` (${file.total - file.csv.rows.length} removed)` : ""} · {file.csv.delimiter === ";" ? "semicolons" : file.csv.delimiter === "\t" ? "tabs" : "commas"}</span>
              <span className="grow" />
              {data.settings.importPresets.length > 0 && (
                <select
                  className="select"
                  style={{ width: "auto" }}
                  value=""
                  onChange={(e) => {
                    const p = data.settings.importPresets.find((x) => x.name === e.target.value);
                    if (p) setMapping(autoMapping(file.csv, p));
                  }}
                >
                  <option value="">Use a saved mapping…</option>
                  {data.settings.importPresets.map((p) => <option key={p.name}>{p.name}</option>)}
                </select>
              )}
              <button className="btn small ghost" onClick={() => { setFile(null); setMapping(null); }}>Cancel</button>
            </h2>
            <h3 style={{ marginBottom: 8 }}>Match columns</h3>
            <table className="table">
              <thead>
                <tr><th>Your column</th><th>Sample</th><th>Many Apply field</th></tr>
              </thead>
              <tbody>
                {file.csv.headers.map((h) => (
                  <tr key={h}>
                    <td style={{ fontWeight: 550 }}>{h}</td>
                    <td className="muted small ellipsis" style={{ maxWidth: 220 }}>
                      {file.csv.rows.map((r) => r[h]).find((v) => v?.trim()) ?? ""}
                    </td>
                    <td style={{ width: 240 }}>
                      <select className="select" value={mapping.columns[h] ?? ""} onChange={(e) => setCol(h, e.target.value)}>
                        <option value="">Skip this column</option>
                        <option value={EXTRA}>Keep as an extra field</option>
                        <option value={NOTES}>Add to notes</option>
                        <optgroup label="Fields">
                          {FIELD_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </optgroup>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!hasTitle && <p className="danger-text small">Choose which column is the title.</p>}
            <div className="row small" style={{ marginTop: 12 }}>
              <span className="soft">Dates like 2/1/2027 mean</span>
              <div className="seg">
                <button className={mapping.dateOrder === "us" ? "on" : ""} onClick={() => setMapping({ ...mapping, dateOrder: "us" })}>Feb 1 (US)</button>
                <button className={mapping.dateOrder === "dayfirst" ? "on" : ""} onClick={() => setMapping({ ...mapping, dateOrder: "dayfirst" })}>Jan 2 (day first)</button>
              </div>
            </div>
          </div>

          {statusValues.length > 0 && (
            <div className="panel">
              <h2>Match status words</h2>
              <table className="table">
                <tbody>
                  {statusValues.map((v) => (
                    <tr key={v}>
                      <td>{v || <i className="muted">(blank)</i>}</td>
                      <td style={{ width: 240 }}>
                        <select
                          className="select"
                          value={mapping.statuses[v] ?? guessStatus(v)}
                          onChange={(e) => setMapping({ ...mapping, statuses: { ...mapping.statuses, [v]: e.target.value as Status } })}
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel">
            <h2>Review rows <span className="muted small" style={{ fontWeight: 400 }}>edit or remove rows before importing. Your original file isn't changed.</span></h2>
            <div className="row wrap small" style={{ marginBottom: 10 }}>
              {errors > 0 && <span className="danger-text">{errors} without a title (will be skipped)</span>}
              {warnings > 0 && <span className="warn-text">{warnings} with warnings</span>}
              {dupes > 0 && (
                <span className="row">
                  <span className="warn-text">{dupes} look like grants you already have.</span>
                  <div className="seg">
                    <button className={mapping.duplicate === "skip" ? "on" : ""} onClick={() => setMapping({ ...mapping, duplicate: "skip" })}>Skip them</button>
                    <button className={mapping.duplicate === "merge" ? "on" : ""} onClick={() => setMapping({ ...mapping, duplicate: "merge" })}>Merge into existing</button>
                  </div>
                </span>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table small">
                <thead>
                  <tr><th>Row</th><th>Title</th><th>Funder</th><th>Deadline</th><th className="r">Amount</th><th>Status</th><th>Notes</th><th /></tr>
                </thead>
                <tbody>
                  {preview.slice(0, shown).map((p) => (
                    <Fragment key={file.lines[p.index]}>
                    <tr style={p.error ? { opacity: 0.55 } : undefined}>
                      <td className="muted">{file.lines[p.index]}</td>
                      <td style={{ fontWeight: 550 }}>{p.fm.title ?? <span className="danger-text">Missing</span>}</td>
                      <td>{p.funderName ?? ""}</td>
                      <td>{p.fm.deadline ? fmtDate(p.fm.deadline, { year: true }) : ""}</td>
                      <td className="r num">{p.fm.amount_requested != null ? fmtMoney(p.fm.amount_requested) : ""}</td>
                      <td>{p.fm.status && <StatusPill status={p.fm.status} />}</td>
                      <td className="small">
                        {p.error && <div className="danger-text">{p.error}</div>}
                        {p.duplicateOf && <div className="warn-text">Duplicate · will {mapping.duplicate}</div>}
                        {p.warnings.map((w, i) => <div key={i} className="warn-text">{w}</div>)}
                      </td>
                      <td className="r" style={{ whiteSpace: "nowrap" }}>
                        <button className="btn small ghost" onClick={() => setEditing(editing === p.index ? null : p.index)}>
                          {editing === p.index ? "Done" : "Edit"}
                        </button>
                        <button className="icon-btn" title="Remove this row from the import" onClick={() => removeRow(p.index)}>×</button>
                      </td>
                    </tr>
                    {editing === p.index && (
                      <tr className="edit-rows">
                        <td />
                        <td colSpan={7}>
                          <div className="props" style={{ margin: "4px 0 10px" }}>
                            {file.csv.headers.map((h) => (
                              <Fragment key={h}>
                                <div className="k">{h}</div>
                                <div className="v">
                                  <InlineText value={file.csv.rows[p.index]?.[h] ?? ""} placeholder="Empty" onSave={(v) => editCell(p.index, h, v)} />
                                </div>
                              </Fragment>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.length > shown && (
              <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => setShown(shown + 100)}>
                Show more ({preview.length - shown} more rows)
              </button>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <span className="grow muted small">
                Writes one folder per row in grants/. A log is saved in .manyapply/imports/ so you can undo.
              </span>
              <button className="btn primary" disabled={!hasTitle || busy} onClick={doImport}>
                Import {preview.length - errors - (mapping.duplicate === "skip" ? dupes : 0)} rows
              </button>
            </div>
          </div>
        </>
      )}

      {logs.length > 0 && (
        <div className="panel">
          <h2>Past imports</h2>
          <table className="table small">
            <tbody>
              {logs.slice(0, 8).map((l, i) => (
                <tr key={l.id}>
                  <td>{l.file}</td>
                  <td className="muted">{fmtDate(l.date, { year: true })}</td>
                  <td>{l.created.length} created{l.merged.length ? `, ${l.merged.length} merged` : ""}</td>
                  <td className="r">
                    {i === 0 && (
                      <button
                        className="btn small"
                        onClick={async () => {
                          if (!(await confirmAction("Undo this import?", `The ${l.created.length} applications it created go to the trash, and merged ones get their old text back.`, { okLabel: "Undo import" }))) return;
                          await mutate((fs) => undoImport(fs, l));
                          refreshLogs();
                          setResult(null);
                          toast("Import undone");
                        }}
                      >
                        Undo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h2>Export</h2>
        <p className="soft small" style={{ marginTop: 0 }}>All your applications as a CSV in the template format. You're never locked in.</p>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              const p = await saveFile("many-apply-export.csv", exportGrantsCsv(data.grants, funderName, clientName), "text/csv");
              if (p) toast(`Exported ${data.grants.length} applications`);
            }}
          >
            Export all applications
          </button>
          <button className="btn ghost" onClick={() => saveFile("many-apply-template.csv", starterTemplateCsv(), "text/csv")}>
            Download starter template
          </button>
        </div>
      </div>
    </div>
  );
}
