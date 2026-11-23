// Materials: everything that goes with an application. Library answers, work samples and documents
// are linked by path (so editing them in the Library updates them here); files uploaded straight to the
// application are copied into grants/<folder>/attachments/.
import { useEffect, useMemo, useState } from "react";
import { useLookups, useStore } from "../store";
import type { Grant } from "../lib/model";
import { ME } from "../lib/model";
import { itemOwner, itemsForClient, searchLibrary } from "../lib/library";
import { recordSampleUsedIn, removeSampleUsedIn, sampleCaption, samplesForClient, searchSamples, previewMime, SAMPLE_EXTENSIONS, SAMPLE_KIND_LABEL } from "../lib/samples";
import { DOC_EXTENSIONS, documentFilePath, documentOwner } from "../lib/documents";
import { listAttachments, recordUsedIn, removeUsedIn } from "../lib/vault";
import { copyToClipboard, droppedFiles, errorText, openVaultFile, pickFiles, type PickedFile } from "../lib/platform";
import { displayText, wordCount } from "../lib/util";
import { MenuButton, Modal } from "./ui";
import { SampleThumb } from "./samples";
import { ExpiryText } from "../screens/Documents";

const ATTACH_EXTENSIONS = [...new Set([...SAMPLE_EXTENSIONS, ...DOC_EXTENSIONS, "key", "ppt", "pptx"])];

type Kind = "answers" | "samples" | "documents";

export function Materials({ g }: { g: Grant }) {
  const data = useStore((s) => s.data!);
  const fs = useStore((s) => s.fs);
  const update = useStore((s) => s.updateGrant);
  const mutate = useStore((s) => s.mutate);
  const open = useStore((s) => s.openDrawer);
  const toast = useStore((s) => s.toast);
  const trashPaths = useStore((s) => s.trashPaths);
  const [picker, setPicker] = useState<Kind | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [filesVersion, setFilesVersion] = useState(0);
  const [over, setOver] = useState(false);
  const f = g.fm;

  useEffect(() => {
    if (fs) void listAttachments(fs, g.folder).then(setFiles).catch(() => setFiles([]));
  }, [fs, g.folder, filesVersion, data]);

  const set = (patch: Partial<Grant["fm"]>) => update(g.folder, (x) => ({ ...x, fm: { ...x.fm, ...patch } }));

  const attach = async (picked: PickedFile[]) => {
    if (!picked.length) return;
    try {
      await mutate(async (v) => {
        await v.mkdir(`grants/${g.folder}/attachments`);
        for (const p of picked) {
          const dot = p.name.lastIndexOf(".");
          const stem = dot > 0 ? p.name.slice(0, dot) : p.name;
          const ext = dot > 0 ? p.name.slice(dot) : "";
          let name = p.name;
          for (let i = 2; await v.exists(`grants/${g.folder}/attachments/${name}`); i++) name = `${stem}-${i}${ext}`;
          await p.copyTo(v, `grants/${g.folder}/attachments/${name}`);
        }
      });
      setFilesVersion((n) => n + 1);
      toast(picked.length === 1 ? `Attached ${picked[0].name}` : `Attached ${picked.length} files`);
    } catch (e) {
      toast(`Couldn't attach that: ${errorText(e)}`, "error");
    }
  };

  const remove = async (kind: Kind, path: string) => {
    if (kind === "answers") {
      await set({ library_items: f.library_items.filter((p) => p !== path) });
      const item = data.library.find((i) => i.path === path);
      if (item) await mutate((v) => removeUsedIn(v, item, g.folder));
    } else if (kind === "samples") {
      await set({ work_samples: f.work_samples.filter((p) => p !== path) });
      const s = data.samples.find((x) => x.path === path);
      if (s) await mutate((v) => removeSampleUsedIn(v, s, g.folder));
    } else {
      await set({ documents: f.documents.filter((p) => p !== path) });
    }
  };

  const moveSample = (i: number, d: -1 | 1) => {
    const next = [...f.work_samples];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void set({ work_samples: next });
  };

  const total = f.library_items.length + f.work_samples.length + f.documents.length + files.length;

  return (
    <section
      className={over ? "drop-over" : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void attach(droppedFiles(e.dataTransfer.files));
      }}
    >
      <h3>
        Materials <span className="spacer" />
        {f.work_samples.length > 0 && (
          <button
            className="btn small ghost"
            title="Copy a numbered list of captions, for the application's work sample list"
            onClick={async () => {
              const lines = f.work_samples.map((p, i) => {
                const s = data.samples.find((x) => x.path === p);
                return s ? `${i + 1}. ${[sampleCaption(s), s.body.trim(), s.fm.url].filter(Boolean).join(" ")}` : "";
              });
              await copyToClipboard(lines.filter(Boolean).join("\n"));
              toast("Copied sample list");
            }}
          >
            Copy sample list
          </button>
        )}
        <MenuButton
          label="+ Add"
          className="btn small ghost"
          items={[
            { label: "Answer from the Library…", run: () => setPicker("answers") },
            { label: "Work sample (image, video, audio…)…", run: () => setPicker("samples") },
            { label: "Document (W-9, 501(c)(3) letter…)…", run: () => setPicker("documents") },
            { label: "Upload a file from your computer…", run: async () => attach(await pickFiles(ATTACH_EXTENSIONS, "Attach files")) },
          ]}
        />
      </h3>

      {total === 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          Add answers, work samples and documents from the Library, or drop files here, so everything this application needs is in one place
          and you know exactly what this funder saw.
        </p>
      )}

      {f.library_items.length > 0 && (
        <Group title="Answers">
          {f.library_items.map((p) => {
            const item = data.library.find((i) => i.path === p);
            return (
              <Row key={p} onRemove={() => void remove("answers", p)} missing={!item ? p : undefined}>
                {item && (
                  <>
                    <a href="#" className="grow ellipsis" onClick={(e) => { e.preventDefault(); open({ kind: "library", id: p }); }}>
                      {item.fm.title}
                    </a>
                    <span className="muted small num">{wordCount(item.body)} words</span>
                    <button className="btn small ghost" onClick={async () => { await copyToClipboard(item.body.trim()); toast("Copied"); }}>
                      Copy
                    </button>
                  </>
                )}
              </Row>
            );
          })}
        </Group>
      )}

      {f.work_samples.length > 0 && (
        <Group title="Work samples">
          {f.work_samples.map((p, i) => {
            const s = data.samples.find((x) => x.path === p);
            return (
              <Row key={p} onRemove={() => void remove("samples", p)} missing={!s ? p : undefined}>
                <span className="muted num">{i + 1}.</span>
                {s && (
                  <>
                    <div style={{ width: 44 }}><SampleThumb s={s} size={36} /></div>
                    <a href="#" className="grow ellipsis" onClick={(e) => { e.preventDefault(); open({ kind: "sample", id: p }); }}>
                      {sampleCaption(s)}
                    </a>
                  </>
                )}
                <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => moveSample(i, -1)}>↑</button>
                <button className="icon-btn" title="Move down" disabled={i === f.work_samples.length - 1} onClick={() => moveSample(i, 1)}>↓</button>
              </Row>
            );
          })}
        </Group>
      )}

      {f.documents.length > 0 && (
        <Group title="Documents">
          {f.documents.map((p) => {
            const d = data.documents.find((x) => x.path === p);
            const file = d ? documentFilePath(d) : "";
            return (
              <Row key={p} onRemove={() => void remove("documents", p)} missing={!d ? p : undefined}>
                {d && (
                  <>
                    <a href="#" className="grow ellipsis" onClick={(e) => { e.preventDefault(); open({ kind: "document", id: p }); }}>
                      {d.fm.title}
                    </a>
                    <span className="small"><ExpiryText d={d} /></span>
                    {file && fs && (
                      <button className="btn small ghost" onClick={() => openVaultFile(fs, file, previewMime(d.fm.file)).catch((e) => toast(`Couldn't open it: ${errorText(e)}`, "error"))}>
                        Open
                      </button>
                    )}
                  </>
                )}
              </Row>
            );
          })}
        </Group>
      )}

      {files.length > 0 && (
        <Group title="Files">
          {files.map((name) => {
            const path = `grants/${g.folder}/attachments/${name}`;
            return (
              <Row
                key={name}
                onRemove={() => {
                  setFiles((xs) => xs.filter((x) => x !== name));
                  void trashPaths([path], (d) => d).then(() => setFilesVersion((n) => n + 1));
                }}
              >
                <span className="grow ellipsis small">{name}</span>
                {fs && (
                  <button className="btn small ghost" onClick={() => openVaultFile(fs, path, previewMime(name)).catch((e) => toast(`Couldn't open it: ${errorText(e)}`, "error"))}>
                    Open
                  </button>
                )}
              </Row>
            );
          })}
        </Group>
      )}

      {total > 0 && <p className="muted small" style={{ margin: "8px 0 0" }}>Drop files here to attach them. They're copied into <code>grants/{g.folder}/attachments/</code>.</p>}

      {picker && <Picker g={g} initial={picker} onClose={() => setPicker(null)} />}
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="small soft" style={{ fontWeight: 550, margin: "4px 0 6px" }}>{title}</div>
      <div className="stack" style={{ gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({ children, onRemove, missing }: { children?: React.ReactNode; onRemove: () => void; missing?: string }) {
  return (
    <div className="panel row" style={{ padding: "6px 10px" }}>
      {missing ? <span className="grow muted small ellipsis" title="This was moved or deleted">{missing} (missing)</span> : children}
      <button className="icon-btn" title="Remove from this application" onClick={onRemove}>×</button>
    </div>
  );
}

/** Choose Library answers, work samples or documents to add. Only this client's (and Shared), never another client's. */
function Picker({ g, initial, onClose }: { g: Grant; initial: Kind; onClose: () => void }) {
  const data = useStore((s) => s.data!);
  const update = useStore((s) => s.updateGrant);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const { clientName } = useLookups();
  const [kind, setKind] = useState<Kind>(initial);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const client = g.fm.client || ME;
  const owner = (o: string) => (o === "shared" ? "Shared" : clientName(o));

  const rows = useMemo(() => {
    if (kind === "answers")
      return searchLibrary(itemsForClient(data.library, client), q)
        .filter((i) => !g.fm.library_items.includes(i.path))
        .map((i) => ({ path: i.path, title: i.fm.title, sub: `${owner(itemOwner(i))} · ${wordCount(i.body)} words` }));
    if (kind === "samples")
      return searchSamples(samplesForClient(data.samples, client), q)
        .filter((s) => !g.fm.work_samples.includes(s.path))
        .map((s) => ({ path: s.path, title: s.fm.title, sub: [SAMPLE_KIND_LABEL[s.fm.kind], s.fm.year, owner(s.path.split("/")[0])].filter(Boolean).join(" · ") }));
    const ql = q.trim().toLowerCase();
    return data.documents
      .filter((d) => documentOwner(d) === client && !g.fm.documents.includes(d.path))
      .filter((d) => !ql || d.fm.title.toLowerCase().includes(ql) || d.fm.type.toLowerCase().includes(ql))
      .map((d) => ({ path: d.path, title: d.fm.title, sub: displayText(d.fm.type) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, q, data, g.fm, client]);

  const switchKind = (k: Kind) => {
    setKind(k);
    setChosen(new Set());
  };

  const add = async () => {
    const paths = [...chosen];
    try {
      if (kind === "answers") {
        await update(g.folder, (x) => ({ ...x, fm: { ...x.fm, library_items: [...x.fm.library_items, ...paths] } }));
        await mutate(async (v) => {
          for (const p of paths) {
            const item = data.library.find((i) => i.path === p);
            if (item) await recordUsedIn(v, item, g.folder);
          }
        });
      } else if (kind === "samples") {
        await update(g.folder, (x) => ({ ...x, fm: { ...x.fm, work_samples: [...x.fm.work_samples, ...paths] } }));
        await mutate(async (v) => {
          for (const p of paths) {
            const s = data.samples.find((x) => x.path === p);
            if (s) await recordSampleUsedIn(v, s, g.folder);
          }
        });
      } else {
        await update(g.folder, (x) => ({ ...x, fm: { ...x.fm, documents: [...x.fm.documents, ...paths] } }));
      }
      toast(`Added ${paths.length} to this application`);
      onClose();
    } catch (e) {
      toast(`Couldn't add them: ${errorText(e)}`, "error");
    }
  };

  const label: Record<Kind, string> = { answers: "Answers", samples: "Work samples", documents: "Documents" };

  return (
    <Modal
      title="Add from the Library"
      width={620}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!chosen.size} onClick={() => void add()}>
            Add {chosen.size || ""}
          </button>
        </>
      }
    >
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <div className="seg" role="tablist">
          {(["answers", "samples", "documents"] as Kind[]).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => switchKind(k)}>
              {label[k]}
            </button>
          ))}
        </div>
        <input className="input grow" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="stack" style={{ gap: 4, maxHeight: 340, overflow: "auto" }}>
        {rows.length === 0 ? (
          <p className="muted small">
            {kind === "documents"
              ? `No other documents for ${clientName(client)}. Add them in Documents.`
              : `Nothing else in ${clientName(client)}'s folder or Shared${q ? " matches" : ""}.`}
          </p>
        ) : (
          rows.map((r) => (
            <label key={r.path} className="check" style={{ padding: "6px 4px", alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={chosen.has(r.path)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(r.path);
                  else next.delete(r.path);
                  setChosen(next);
                }}
              />
              <span>
                <span style={{ fontWeight: 550 }}>{r.title}</span>
                <br />
                <span className="muted small">{r.sub}</span>
              </span>
            </label>
          ))
        )}
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Shows {clientName(client)}'s folder and Shared, never another client's. Items stay in the Library; edits there show up here.
      </p>
    </Modal>
  );
}
