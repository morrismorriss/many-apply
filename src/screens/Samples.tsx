import { useState } from "react";
import { useLookups, useStore } from "../store";
import { Empty, MenuButton, Tags } from "../components/ui";
import { SampleThumb, useAddSamples } from "../components/samples";
import { SAMPLE_KINDS, SAMPLE_KIND_LABEL, sampleOwner, searchSamples, type SampleKind } from "../lib/samples";
import type { ReactNode } from "react";

/** Library → Work samples: images, video, audio, documents and links, per client plus Shared. */
export function SamplesView({ tabs }: { tabs: ReactNode }) {
  const data = useStore((s) => s.data!);
  const clientFilter = useStore((s) => s.clientFilter);
  const open = useStore((s) => s.openDrawer);
  const { clientName } = useLookups();
  const add = useAddSamples();
  const [owner, setOwner] = useState<string>("");
  const [kind, setKind] = useState<SampleKind | "">("");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [over, setOver] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");

  const roots = ["shared", ...data.clients.map((c) => c.slug)].filter((r) => !clientFilter || r === clientFilter || r === "shared");
  const visible = data.samples.filter((s) => roots.includes(sampleOwner(s)));
  const items = searchSamples(visible, q).filter(
    (s) => (!owner || sampleOwner(s) === owner) && (!kind || s.fm.kind === kind) && (!tag || s.fm.tags.includes(tag)),
  );
  const tags = [...new Set(visible.flatMap((s) => s.fm.tags))].sort();
  const ownerLabel = (o: string) => (o === "shared" ? "Shared" : clientName(o));
  const target = owner || clientFilter || "me";

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Library</h1>
          <div className="sub">Images, video, audio and documents you send with applications.</div>
        </div>
        <span className="spacer" />
        <MenuButton
          label="+ Add sample"
          className="btn primary"
          items={[
            { label: "Upload files…", run: () => void add.pick(target) },
            { label: "Insert a link…", run: () => void add.link(target) },
          ]}
        />
      </div>

      <div className="lib-tabs">{tabs}</div>
      <div className="toolbar">
        <input className="input" style={{ width: 220 }} placeholder="Search samples" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" aria-label="Folder" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">All folders</option>
          {roots.map((r) => <option key={r} value={r}>{ownerLabel(r)}</option>)}
        </select>
        <select className="select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as SampleKind | "")}>
          <option value="">All kinds</option>
          {SAMPLE_KINDS.map((k) => <option key={k} value={k}>{SAMPLE_KIND_LABEL[k]}</option>)}
        </select>
        <select className="select" aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="spacer" />
        <div className="seg">
          <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")}>Grid</button>
          <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
        </div>
      </div>

      <div
        className={`sample-drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) void add.drop(target, e.dataTransfer.files);
        }}
      >
        {items.length === 0 ? (
          <Empty title={visible.length ? "No samples match" : "No work samples yet"}>
            <p>
              Upload images, video, audio or PDFs (or drop them here), or insert a link to Vimeo, YouTube, SoundCloud, Flickr or a portfolio page. Files are copied into{" "}
              <code>samples/{target}/</code> in your vault.
            </p>
          </Empty>
        ) : view === "grid" ? (
          <div className="sample-grid">
            {items.map((s) => (
              <button key={s.path} className="sample-card" onClick={() => open({ kind: "sample", id: s.path })}>
                <SampleThumb s={s} />
                <div className="sample-body">
                  <div className="title ellipsis">{s.fm.title}</div>
                  <div className="muted small ellipsis">
                    {[SAMPLE_KIND_LABEL[s.fm.kind], s.fm.year, s.fm.medium].filter(Boolean).join(" · ")}
                  </div>
                  <div className="muted small">
                    {ownerLabel(sampleOwner(s))}
                    {s.fm.used_in.length > 0 && ` · sent ${s.fm.used_in.length}×`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Kind</th>
                  <th>Year</th>
                  <th>Medium</th>
                  <th>Folder</th>
                  <th>Tags</th>
                  <th className="r">Sent with</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.path} className="click" onClick={() => open({ kind: "sample", id: s.path })}>
                    <td style={{ fontWeight: 550 }}>{s.fm.title}</td>
                    <td className="soft small">{SAMPLE_KIND_LABEL[s.fm.kind]}</td>
                    <td className="num small">{s.fm.year}</td>
                    <td className="soft small">{s.fm.medium}</td>
                    <td className="soft small">{ownerLabel(sampleOwner(s))}</td>
                    <td><Tags tags={s.fm.tags} /></td>
                    <td className="r num">{s.fm.used_in.length || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items.length > 0 && <p className="muted small" style={{ marginTop: 10 }}>Drop files anywhere here to add them to {ownerLabel(target)}.</p>}
      </div>
    </div>
  );
}
