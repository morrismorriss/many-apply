import { useEffect, useMemo, useRef, useState } from "react";
import { markWrite, useLookups, useStore } from "../store";
import { ClientSelect, MenuButton, Modal } from "../components/ui";
import { askText, confirmAction } from "../components/dialogs";
import {
  CV_SECTIONS,
  addAwardBack,
  applySuggestions,
  awardEntry,
  leftOffAwards,
  removeEntry,
  syncAwards,
  buildCvDocx,
  cvMarkdown,
  cvPath,
  cvSuggestions,
  cvText,
  readCv,
  sortEntries,
  writeCv,
  type Cv,
  type CvSuggestion,
} from "../lib/cv";
import { createLibraryItem, writeLibrary } from "../lib/vault";
import { copyToClipboard, errorText, saveFile } from "../lib/platform";
import { ME } from "../lib/model";
import { slugify } from "../lib/util";

export function CvBuilder() {
  const fs = useStore((s) => s.fs!);
  const clientFilter = useStore((s) => s.clientFilter);
  const clients = useStore((s) => s.data!.clients);
  const toast = useStore((s) => s.toast);
  const mutate = useStore((s) => s.mutate);
  const open = useStore((s) => s.openDrawer);
  const library = useStore((s) => s.data!.library);
  const { clientName, funderName } = useLookups();
  const grants = useStore((s) => s.data!.grants);
  const funders = useStore((s) => s.data!.funders);
  const [client, setClient] = useState(clientFilter || ME);
  const [cv, setCvState] = useState<Cv | null>(null);
  const [filling, setFilling] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Cv | null>(null);

  useEffect(() => {
    if (clientFilter) setClient(clientFilter);
  }, [clientFilter]);

  const flush = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    markWrite();
    await writeCv(fs, next).catch((e) => toast(`Couldn't save the CV: ${errorText(e)}`, "error"));
  };

  useEffect(() => {
    let live = true;
    setCvState(null);
    const name = clients.find((c) => c.slug === client)?.fm.name ?? clientName(client);
    void readCv(fs, client, name).then((c) => live && setCvState(c));
    return () => {
      live = false;
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs, client]);

  const setCv = (next: Cv) => {
    setCvState(next);
    pending.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), 600);
  };

  // Awarded applications go on the CV by themselves: when it opens, and whenever an award changes.
  const loadedFor = cv?.client ?? null;
  useEffect(() => {
    if (!cv) return;
    const next = syncAwards(cv, grants, funderName);
    if (next !== cv) setCv(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedFor, grants, funders]);

  if (!cv) return <div className="page"><p className="muted">Loading…</p></div>;

  const setSection = (i: number, patch: Partial<Cv["sections"][number]>) =>
    setCv({ ...cv, sections: cv.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveSection = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= cv.sections.length) return;
    const next = [...cv.sections];
    [next[i], next[j]] = [next[j], next[i]];
    setCv({ ...cv, sections: next });
  };
  const missing = CV_SECTIONS.filter((t) => !cv.sections.some((s) => s.title.toLowerCase() === t.toLowerCase()));

  const saveToLibrary = async () => {
    await flush();
    const md = cvMarkdown(cv);
    const path = `${client}/cv.md`;
    const existing = library.find((i) => i.path === path);
    const item = await mutate(async (v) => {
      if (existing) {
        const next = { ...existing, body: md };
        await writeLibrary(v, next);
        return next;
      }
      return createLibraryItem(v, client, "CV", md, ["cv"]);
    });
    toast(existing ? "Updated the CV in the Library" : "Saved to the Library. Attach it to applications from their Materials.", "ok", {
      label: "Open",
      run: () => open({ kind: "library", id: item.path }),
    });
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>CV</h1>
          <div className="sub">An artist CV for each client, filled in from what Many Apply already knows. Saved as <code>{cvPath(client)}</code>.</div>
        </div>
        <span className="spacer" />
        <ClientSelect className="select" style={{ width: "auto", maxWidth: 200 }} value={client} onChange={(c) => { void flush(); setClient(c); }} />
        <button className="btn" onClick={() => setFilling(true)} title="Awarded applications are added by themselves">Add work samples…</button>
        <MenuButton
          label="Export"
          className="btn primary"
          items={[
            {
              label: "Word document (.docx)…",
              run: async () => {
                try {
                  const p = await saveFile(`${slugify(cv.name) || "cv"}-cv.docx`, await buildCvDocx(cv), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
                  if (p) toast("CV saved");
                } catch (e) {
                  toast(`Couldn't save it: ${errorText(e)}`, "error");
                }
              },
            },
            { label: "Copy as plain text", run: async () => { await copyToClipboard(cvText(cv)); toast("Copied the CV"); } },
            { label: "Save a copy to the Library", run: () => void saveToLibrary() },
          ]}
        />
      </div>

      <div className="cv-layout">
        <div className="stack" style={{ gap: 14 }}>
          <div className="panel">
            <h2>Contact</h2>
            <div className="cv-contact">
              <label className="field">Name<input className="input" value={cv.name} onChange={(e) => setCv({ ...cv, name: e.target.value })} /></label>
              <label className="field">Location<input className="input" placeholder="Pittsburgh, PA" value={cv.location} onChange={(e) => setCv({ ...cv, location: e.target.value })} /></label>
              <label className="field">Email<input className="input" value={cv.email} onChange={(e) => setCv({ ...cv, email: e.target.value })} /></label>
              <label className="field">Phone<input className="input" value={cv.phone} onChange={(e) => setCv({ ...cv, phone: e.target.value })} /></label>
              <label className="field">Website<input className="input" value={cv.website} onChange={(e) => setCv({ ...cv, website: e.target.value })} /></label>
            </div>
          </div>

          {cv.sections.map((s, i) => (
            <div key={i} className="panel">
              <div className="row" style={{ marginBottom: 8 }}>
                <input
                  className="input cv-section-title grow"
                  aria-label="Section title"
                  value={s.title}
                  onChange={(e) => setSection(i, { title: e.target.value })}
                />
                <button className="btn small ghost" title="Sort newest first" disabled={s.entries.length < 2} onClick={() => setSection(i, { entries: sortEntries(s.entries) })}>
                  Sort by year
                </button>
                <button className="icon-btn" title="Move section up" disabled={i === 0} onClick={() => moveSection(i, -1)}>↑</button>
                <button className="icon-btn" title="Move section down" disabled={i === cv.sections.length - 1} onClick={() => moveSection(i, 1)}>↓</button>
                <button
                  className="icon-btn"
                  title="Remove section"
                  onClick={async () => {
                    if (s.entries.some((e) => e.text.trim()) && !(await confirmAction(`Remove ${s.title}?`, "Its entries are removed from this CV. Awards in it go to \"Left off this CV\", where you can add them back.", { okLabel: "Remove", danger: true }))) return;
                    // Remember its awards as left off, so they don't come straight back in a new section.
                    const folders = s.entries.flatMap((e) => (e.source?.startsWith("grant:") ? [e.source.slice(6)] : []));
                    setCv({ ...cv, leftOff: [...new Set([...cv.leftOff, ...folders])], sections: cv.sections.filter((_, j) => j !== i) });
                  }}
                >
                  ×
                </button>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {s.entries.map((e, k) => (
                  <div key={k} className="row">
                    <input
                      className="input"
                      style={{ width: 110 }}
                      placeholder="Year"
                      aria-label="Year"
                      value={e.year}
                      onChange={(ev) => setSection(i, { entries: s.entries.map((x, n) => (n === k ? { ...x, year: ev.target.value } : x)) })}
                    />
                    <input
                      className="input grow"
                      placeholder="What, where. *Italics* for titles of works."
                      aria-label="Entry"
                      value={e.text}
                      onChange={(ev) => setSection(i, { entries: s.entries.map((x, n) => (n === k ? { ...x, text: ev.target.value } : x)) })}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") setSection(i, { entries: [...s.entries.slice(0, k + 1), { year: e.year, text: "" }, ...s.entries.slice(k + 1)] });
                      }}
                    />
                    <button
                      className="icon-btn"
                      title="Move up"
                      disabled={k === 0}
                      onClick={() => {
                        const next = [...s.entries];
                        [next[k - 1], next[k]] = [next[k], next[k - 1]];
                        setSection(i, { entries: next });
                      }}
                    >
                      ↑
                    </button>
                    {e.source && (
                      <span className="cv-auto" title="Added from an awarded application. Remove it and it stays off this CV until you add it back.">
                        Awarded
                      </span>
                    )}
                    <button className="icon-btn" title="Remove" onClick={() => setCv(removeEntry(cv, i, k))}>×</button>
                  </div>
                ))}
                <div>
                  <button className="btn small ghost" onClick={() => setSection(i, { entries: [...s.entries, { year: String(new Date().getFullYear()), text: "" }] })}>
                    + Add entry
                  </button>
                  {s.entries.length === 0 && <span className="muted small"> Empty sections are left out when you export.</span>}
                </div>
              </div>
            </div>
          ))}

          <LeftOff cv={cv} onAddBack={(folder) => setCv(addAwardBack(cv, folder, grants, funderName))} />

          <div>
            <MenuButton
              label="+ Add section"
              className="btn"
              items={[
                ...missing.map((t) => ({ label: t, run: () => setCv({ ...cv, sections: [...cv.sections, { title: t, entries: [] }] }) })),
                {
                  label: <span className="muted">Your own heading…</span>,
                  run: async () => {
                    const t = await askText("New section", { placeholder: "Collections" });
                    if (t?.trim()) setCv({ ...cv, sections: [...cv.sections, { title: t.trim(), entries: [] }] });
                  },
                },
              ]}
            />
          </div>
        </div>

        <CvPreview cv={cv} />
      </div>

      {filling && <FillDialog cv={cv} onApply={(next) => setCv(next)} onClose={() => setFilling(false)} />}
    </div>
  );
}

function CvPreview({ cv }: { cv: Cv }) {
  const contact = [cv.location, cv.email, cv.phone, cv.website].map((x) => x.trim()).filter(Boolean).join(" · ");
  const sections = cv.sections.filter((s) => s.entries.some((e) => e.text.trim()));
  return (
    <aside className="cv-paper" aria-label="Preview">
      <div className="cv-name">{cv.name || "Your name"}</div>
      {contact && <div className="cv-contact-line">{contact}</div>}
      {sections.length === 0 && <p className="muted small">Add entries, or mark applications as Awarded, and the CV appears here.</p>}
      {sections.map((s, i) => (
        <div key={i}>
          <div className="cv-h">{s.title}</div>
          {s.entries.filter((e) => e.text.trim()).map((e, k) => (
            <div key={k} className="cv-entry">
              <span className="cv-year">{e.year}</span>
              <span><Inline text={e.text} /></span>
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

/** *italic* and **bold**, as on the exported CV. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\*\*.+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : /^(\*|_).+(\*|_)$/.test(p) ? <em key={i}>{p.slice(1, -1)}</em> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

function FillDialog({ cv, onApply, onClose }: { cv: Cv; onApply: (cv: Cv) => void; onClose: () => void }) {
  const samples = useStore((s) => s.data!.samples);
  const { clientName } = useLookups();
  const suggestions = useMemo(() => cvSuggestions(cv, samples), [cv, samples]);
  const [off, setOff] = useState<Set<number>>(new Set());
  const picks: CvSuggestion[] = suggestions.filter((_, i) => !off.has(i));
  const bySection = new Map<string, { s: CvSuggestion; i: number }[]>();
  suggestions.forEach((s, i) => bySection.set(s.section, [...(bySection.get(s.section) ?? []), { s, i }]));

  return (
    <Modal
      title="Add work samples"
      width={640}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!picks.length}
            onClick={() => {
              onApply(applySuggestions(cv, picks));
              onClose();
            }}
          >
            Add {picks.length || ""}
          </button>
        </>
      }
    >
      <p className="soft small" style={{ marginTop: 0 }}>
        {clientName(cv.client)}'s work samples that aren't on the CV yet, for Selected works. Untick any you'd rather leave off. (Awarded
        applications are added to the CV by themselves.)
      </p>
      {suggestions.length === 0 ? (
        <p className="muted">Every work sample is already on the CV. Add more in Library → Work samples.</p>
      ) : (
        <div className="stack" style={{ gap: 10, maxHeight: 360, overflow: "auto" }}>
          {[...bySection].map(([section, list]) => (
            <div key={section}>
              <div className="small soft" style={{ fontWeight: 550, marginBottom: 4 }}>{section}</div>
              {list.map(({ s, i }) => (
                <label key={i} className="check" style={{ padding: "3px 0" }}>
                  <input
                    type="checkbox"
                    checked={!off.has(i)}
                    onChange={(e) => {
                      const next = new Set(off);
                      if (e.target.checked) next.delete(i);
                      else next.add(i);
                      setOff(next);
                    }}
                  />
                  <span>
                    <span className="muted num">{s.entry.year || "—"}</span> <Inline text={s.entry.text} />
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function LeftOff({ cv, onAddBack }: { cv: Cv; onAddBack: (folder: string) => void }) {
  const grants = useStore((s) => s.data!.grants);
  const { funderName } = useLookups();
  const off = leftOffAwards(cv, grants);
  if (!off.length) return null;
  return (
    <div className="panel">
      <h2>Left off this CV</h2>
      <p className="muted small" style={{ marginTop: 0 }}>Awarded applications you removed. They stay off until you add them back.</p>
      <div className="stack" style={{ gap: 6 }}>
        {off.map((g) => {
          const a = awardEntry(g, funderName);
          return (
            <div key={g.folder} className="row">
              <span className="muted num" style={{ width: 48 }}>{a.entry.year}</span>
              <span className="grow">{a.entry.text}</span>
              <span className="muted small">{a.section}</span>
              <button className="btn small" onClick={() => onAddBack(g.folder)}>Add back</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
