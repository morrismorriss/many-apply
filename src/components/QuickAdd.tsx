import { useMemo, useState } from "react";
import { useStore } from "../store";
import { ClientMultiSelect, FunderSelect, Modal, TagInput, useAllTags } from "./ui";
import { findAmounts, findDates, findUrl } from "../lib/extract";
import { GRANT_TYPES, ME, STATUSES, STATUS_LABEL, type GrantFM, type Status } from "../lib/model";
import { defaultGrantBody, setBodySection } from "../lib/vault";
import { fmtDate, fmtMoney } from "../lib/util";

export function QuickAdd({ onClose, status = "researching" }: { onClose: () => void; status?: Status }) {
  const addGrant = useStore((s) => s.addGrant);
  const open = useStore((s) => s.openDrawer);
  const clientFilter = useStore((s) => s.clientFilter);
  const toast = useStore((s) => s.toast);
  const tagsAll = useAllTags();
  const [f, setF] = useState({
    title: "",
    funder: "",
    url: "",
    deadline: "",
    amount: "",
    max: "",
    type: "grant" as GrantFM["type"],
    tags: [] as string[],
    clients: [clientFilter || ME],
    status,
  });
  const [paste, setPaste] = useState("");
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const dates = useMemo(() => (paste ? findDates(paste) : []), [paste]);
  const amounts = useMemo(() => (paste ? findAmounts(paste) : []), [paste]);
  const pastedUrl = useMemo(() => (paste ? findUrl(paste) : null), [paste]);

  const submit = async () => {
    if (!f.title.trim()) return;
    const body = paste.trim() ? setBodySection(defaultGrantBody(), "Eligibility", paste.trim()) : defaultGrantBody();
    // One opportunity per client: each is its own application, with its own status, drafts and amounts.
    let first: Awaited<ReturnType<typeof addGrant>> | null = null;
    for (const client of f.clients) {
      const g = await addGrant(
        {
          title: f.title.trim(),
          funder: f.funder,
          url: f.url.trim(),
          deadline: f.deadline,
          amount_requested: f.amount ? Number(f.amount.replace(/[^0-9.]/g, "")) : null,
          max_award: f.max ? Number(f.max.replace(/[^0-9.]/g, "")) : null,
          type: f.type,
          tags: f.tags,
          client,
          status: f.status,
        },
        body,
      );
      first ??= g;
    }
    if (f.clients.length > 1) toast(`Added for ${f.clients.length} clients`, "ok");
    onClose();
    if (first) open({ kind: "grant", id: first.folder });
  };

  return (
    <Modal
      title="New opportunity"
      width={720}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!f.title.trim()} onClick={submit}>Add</button>
        </>
      }
    >
      <div className="grid cols-2" style={{ gap: 20 }}>
        <div className="stack">
          <label className="field">
            Title
            <input className="input" autoFocus value={f.title} placeholder="Project Grant 2027" onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} />
          </label>
          <label className="field">
            Funder
            <FunderSelect className="select" value={f.funder} onChange={(funder) => set({ funder })} />
          </label>
          <label className="field">
            URL
            <input className="input" value={f.url} placeholder="https://" onChange={(e) => set({ url: e.target.value })} />
          </label>
          <div className="row">
            <label className="field grow">
              Deadline
              <input className="input" type="date" value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} />
            </label>
            <label className="field grow">
              Type
              <select className="select" value={f.type} onChange={(e) => set({ type: e.target.value as GrantFM["type"] })}>
                {GRANT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <div className="row">
            <label className="field grow">
              Amount to request
              <input className="input" inputMode="decimal" value={f.amount} placeholder="$" onChange={(e) => set({ amount: e.target.value })} />
            </label>
            <label className="field grow">
              Max award
              <input className="input" inputMode="decimal" value={f.max} placeholder="$" onChange={(e) => set({ max: e.target.value })} />
            </label>
          </div>
          <label className="field">
            Tags
            <div className="input" style={{ padding: 2 }}>
              <TagInput value={f.tags} suggestions={tagsAll} onSave={(tags) => set({ tags })} />
            </div>
          </label>
          <div className="field">
            For
            <ClientMultiSelect value={f.clients} label="Add who it's for" onChange={(clients) => set({ clients })} />
          </div>
          <div className="row">
            <label className="field grow">
              Status
              <select className="select" value={f.status} onChange={(e) => set({ status: e.target.value as Status })}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="stack">
          <label className="field">
            Paste text from the funder's page (optional)
            <textarea
              className="textarea"
              style={{ minHeight: 160 }}
              value={paste}
              placeholder="Paste guidelines here. Many Apply will spot dates and dollar amounts. It's saved under Eligibility."
              onChange={(e) => setPaste(e.target.value)}
            />
          </label>
          {(dates.length > 0 || amounts.length > 0 || pastedUrl) && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">Suggestions. Click to use.</span>
              {pastedUrl && !f.url && (
                <button className="btn small" style={{ justifyContent: "flex-start" }} onClick={() => set({ url: pastedUrl })}>
                  Link: <span className="ellipsis">{pastedUrl}</span>
                </button>
              )}
              {dates.slice(0, 5).map((d) => (
                <button
                  key={d.iso}
                  className="btn small"
                  title={d.context}
                  style={{ justifyContent: "flex-start", borderColor: f.deadline === d.iso ? "var(--accent)" : undefined }}
                  onClick={() => set({ deadline: d.iso })}
                >
                  {d.label === "deadline" ? "Deadline" : d.label === "decision" ? "Decision date" : "Date"}: {fmtDate(d.iso, { year: true })}
                  <span className="muted ellipsis" style={{ fontWeight: 400 }}>“{d.text}”</span>
                </button>
              ))}
              {amounts.slice(0, 4).map((a) => (
                <button
                  key={a.value}
                  className="btn small"
                  title={a.context}
                  style={{ justifyContent: "flex-start" }}
                  onClick={() => (a.label === "max_award" ? set({ max: String(a.value), amount: f.amount || String(a.value) }) : set({ amount: String(a.value) }))}
                >
                  {a.label === "max_award" ? "Max award" : "Amount"}: {fmtMoney(a.value)}
                  <span className="muted ellipsis" style={{ fontWeight: 400 }}>“{a.context}”</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
