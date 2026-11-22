import { useStore } from "../store";
import { InlineDate, InlineText, TagInput } from "./ui";
import { confirmAction } from "./dialogs";
import { trash } from "../lib/vault";
import { DOC_EXTENSIONS, DOC_TYPES, documentFilePath, documentPaths, setDocumentFile, type VaultDocument } from "../lib/documents";
import { previewMime } from "../lib/samples";
import { errorText, openVaultFile, pickFiles } from "../lib/platform";
import { ExpiryText } from "../screens/Documents";
import { displayText } from "../lib/util";

export function DocumentDrawer({ path }: { path: string }) {
  const d = useStore((s) => s.data?.documents.find((x) => x.path === path));
  const all = useStore((s) => s.data?.documents);
  const fs = useStore((s) => s.fs);
  const save = useStore((s) => s.saveDocument);
  const mutate = useStore((s) => s.mutate);
  const close = useStore((s) => s.closeDrawer);
  const toast = useStore((s) => s.toast);
  if (!d) return <p className="muted">This document isn't in the vault any more.</p>;
  const set = (patch: Partial<VaultDocument["fm"]>) => save({ ...d, fm: { ...d.fm, ...patch } });
  const file = documentFilePath(d);
  const allTags = [...new Set((all ?? []).flatMap((x) => x.fm.tags))];
  const types = [...new Set([...DOC_TYPES, d.fm.type])];

  const upload = async () => {
    const [f] = await pickFiles(DOC_EXTENSIONS, d.fm.file ? "Replace file" : "Upload a file");
    if (!f) return;
    try {
      await mutate((v) => setDocumentFile(v, d, { name: f.name, copyTo: (dest) => f.copyTo(v, dest) }, (p) => trash(v, p)));
      toast(d.fm.file ? "Replaced the file. The old one is in trash." : "Uploaded");
    } catch (e) {
      toast(`Couldn't add that file: ${errorText(e)}`, "error");
    }
  };

  return (
    <div>
      <InlineText className="drawer-title" value={d.fm.title} onSave={(title) => title && set({ title })} />
      <div className="row small muted" style={{ marginTop: 4 }}>
        <span className="ellipsis">documents/{path}</span>
      </div>

      <section className="row wrap">
        {file && fs && (
          <button className="btn small" onClick={() => openVaultFile(fs, file, previewMime(d.fm.file)).catch((e) => toast(`Couldn't open it: ${errorText(e)}`, "error"))}>
            Open file
          </button>
        )}
        <button className="btn small ghost" onClick={() => void upload()}>
          {d.fm.file ? "Replace file…" : "Upload a file…"}
        </button>
        <span className="grow" />
        <span className="small"><ExpiryText d={d} /></span>
      </section>

      <section>
        <div className="props">
          <div className="k">Type</div>
          <div className="v">
            <select className="select inline" value={d.fm.type} onChange={(e) => set({ type: e.target.value })}>
              {types.map((t) => <option key={t} value={t}>{displayText(t)}</option>)}
            </select>
          </div>
          <div className="k">Issued</div>
          <div className="v">
            <InlineDate value={d.fm.issued} onSave={(issued) => set({ issued })} />
          </div>
          <div className="k">Expires</div>
          <div className="v">
            <InlineDate value={d.fm.expires} onSave={(expires) => set({ expires })} />
          </div>
          <div className="k">File</div>
          <div className="v">
            <span className="small ellipsis" style={{ padding: "4px 9px" }}>{d.fm.file || <span className="muted">None yet</span>}</span>
          </div>
          <div className="k">Tags</div>
          <div className="v">
            <TagInput value={d.fm.tags} suggestions={allTags} onSave={(tags) => set({ tags })} />
          </div>
        </div>
        <p className="muted small">Add an expiry date for insurance certificates, W-9s and letters of good standing, and it shows on the Dashboard before it runs out.</p>
      </section>

      <section>
        <h3>Notes</h3>
        <textarea
          className="textarea"
          style={{ minHeight: 120 }}
          placeholder="Who signed it, where the original is, what it covers. Avoid typing full ID or account numbers here."
          defaultValue={d.body}
          key={d.path + d.body.length}
          onBlur={(e) => e.target.value !== d.body && save({ ...d, body: e.target.value })}
        />
      </section>

      <section className="row">
        <span className="grow" />
        <button
          className="btn small danger"
          onClick={async () => {
            if (!(await confirmAction("Move this document to trash?", "The document and its file go to .manyapply/trash/ in your vault. Empty that folder to remove it for good.", { okLabel: "Move to trash", danger: true }))) return;
            await mutate(async (v) => {
              for (const p of documentPaths(d)) if (await v.exists(p)) await trash(v, p);
            });
            close();
          }}
        >
          Delete
        </button>
      </section>
    </div>
  );
}
