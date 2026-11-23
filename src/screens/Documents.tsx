import { useState } from "react";
import { useLookups, useStore } from "../store";
import { ClientSelect, Empty } from "../components/ui";
import {
  DOC_EXTENSIONS,
  DOC_TYPES,
  SENSITIVE_NOTE,
  createDocument,
  documentOwner,
  expiryState,
  type VaultDocument,
} from "../lib/documents";
import { droppedFiles, errorText, getPref, pickFiles, setPref, type PickedFile } from "../lib/platform";
import { displayText, fmtDate, relDays, daysUntil } from "../lib/util";

const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";

/** Add documents from picked or dropped files. */
export function useAddDocuments() {
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const open = useStore((s) => s.openDrawer);
  const add = async (folder: string, files: PickedFile[]) => {
    const ok = files.filter((f) => DOC_EXTENSIONS.includes(f.name.split(".").pop()?.toLowerCase() ?? ""));
    if (ok.length < files.length) toast(`Skipped ${files.length - ok.length} file${files.length - ok.length === 1 ? "" : "s"} of a type Documents doesn't take.`, "warn");
    if (!ok.length) return;
    try {
      const made = await mutate(async (fs) => {
        const out: VaultDocument[] = [];
        for (const f of ok) out.push(await createDocument(fs, folder, { title: titleFromFile(f.name), file: { name: f.name, copyTo: (d) => f.copyTo(fs, d) } }));
        return out;
      });
      if (made.length === 1) open({ kind: "document", id: made[0].path });
      else toast(`Added ${made.length} documents`);
    } catch (e) {
      toast(`Couldn't add that file: ${errorText(e)}`, "error");
    }
  };
  return {
    pick: async (folder: string) => add(folder, await pickFiles(DOC_EXTENSIONS, "Add documents")),
    drop: async (folder: string, list: FileList) => add(folder, droppedFiles(list)),
  };
}

export function ExpiryText({ d }: { d: VaultDocument }) {
  const st = expiryState(d);
  if (st === "none") return <span className="muted">—</span>;
  const n = daysUntil(d.fm.expires);
  return (
    <span className={st === "expired" ? "danger-text" : st === "soon" ? "warn-text" : ""} title={fmtDate(d.fm.expires, { year: true })}>
      {st === "expired" ? `Expired ${relDays(n)}` : st === "soon" ? `Expires ${relDays(n)}` : fmtDate(d.fm.expires, { year: true })}
    </span>
  );
}

export function Documents({ tabs }: { tabs?: React.ReactNode } = {}) {
  const data = useStore((s) => s.data!);
  const clientFilter = useStore((s) => s.clientFilter);
  const open = useStore((s) => s.openDrawer);
  const { clientName } = useLookups();
  const add = useAddDocuments();
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [over, setOver] = useState(false);
  // Who new documents are for. Follows the sidebar's client filter until changed here.
  const [forPick, setForPick] = useState<{ filter: string; slug: string } | null>(null);
  const [noteHidden, setNoteHidden] = useState(getPref("documentsNoteHidden") === "1");

  const owners = data.clients.map((c) => c.slug).filter((o) => !clientFilter || o === clientFilter);
  const visible = data.documents.filter((d) => owners.includes(documentOwner(d)));
  const ql = q.trim().toLowerCase();
  const items = visible.filter(
    (d) => (!type || d.fm.type === type) && (!ql || d.fm.title.toLowerCase().includes(ql) || d.fm.type.toLowerCase().includes(ql) || d.body.toLowerCase().includes(ql)),
  );
  const target = forPick && forPick.filter === clientFilter && data.clients.some((c) => c.slug === forPick.slug) ? forPick.slug : clientFilter || "me";
  const types = [...new Set([...DOC_TYPES, ...visible.map((d) => d.fm.type)])];
  const attention = visible.filter((d) => ["expired", "soon"].includes(expiryState(d))).length;

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>{tabs ? "Library" : "Documents"}</h1>
          <div className="sub">Contracts, tax forms and legal paperwork that applications ask for again and again.</div>
        </div>
        <span className="spacer" />
        <label className="row small soft" style={{ gap: 6 }}>
          For
          <ClientSelect className="select" style={{ width: "auto", maxWidth: 220 }} value={target} onChange={(slug) => setForPick({ filter: clientFilter, slug })} />
        </label>
        <button className="btn primary" onClick={() => void add.pick(target)}>+ Add documents</button>
      </div>
      {tabs && <div className="lib-tabs">{tabs}</div>}

      {noteHidden ? (
        <p className="small muted" style={{ marginTop: -12 }}>
          ⚠ Sensitive files.{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); setPref("documentsNoteHidden", null); setNoteHidden(false); }}>
            Who can see them?
          </a>
        </p>
      ) : (
        <div className="callout warn small" style={{ marginBottom: 16 }} role="note">
          <strong>Be careful who can see this folder.</strong> {displayText(SENSITIVE_NOTE)}
          <div style={{ marginTop: 8 }}>
            <button className="btn small ghost" onClick={() => { setPref("documentsNoteHidden", "1"); setNoteHidden(true); }}>
              Got it
            </button>
          </div>
        </div>
      )}

      <div className="toolbar">
        <input className="input" style={{ width: 240 }} placeholder="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{displayText(t)}</option>)}
        </select>
        {attention > 0 && <span className="small warn-text">{attention} expired or expiring within 30 days</span>}
      </div>

      <div
        className={`sample-drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) void add.drop(target, e.dataTransfer.files);
        }}
      >
        {items.length === 0 ? (
          <Empty title={visible.length ? "No documents match" : "No documents yet"}>
            <p>
              Add your W-9, 501(c)(3) letter, fiscal sponsor agreement, insurance certificate or contracts, or drop them here. Add an
              expiry date and Many Apply will remind you before it runs out. Files are copied into <code>documents/{target}/</code>.
            </p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  {!clientFilter && <th>For</th>}
                  <th>Issued</th>
                  <th>Expires</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.path} className="click" onClick={() => open({ kind: "document", id: d.path })}>
                    <td style={{ fontWeight: 550 }}>{d.fm.title}</td>
                    <td className="soft small">{displayText(d.fm.type)}</td>
                    {!clientFilter && <td className="soft small">{clientName(documentOwner(d))}</td>}
                    <td className="small num">{d.fm.issued ? fmtDate(d.fm.issued, { year: true }) : ""}</td>
                    <td className="small"><ExpiryText d={d} /></td>
                    <td className="muted small ellipsis" style={{ maxWidth: 200 }}>{d.fm.file || "No file"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items.length > 0 && <p className="muted small" style={{ marginTop: 10 }}>Drop files anywhere here to add them to {clientName(target)}.</p>}
      </div>
    </div>
  );
}
