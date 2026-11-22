import { useStore } from "../store";
import { InlineSelect, InlineText, MenuButton, TagInput } from "./ui";
import { confirmAction } from "./dialogs";
import { SamplePreview, useAddSamples } from "./samples";
import { trash } from "../lib/vault";
import {
  SAMPLE_KINDS,
  SAMPLE_KIND_LABEL,
  duplicateSample,
  kindForUrl,
  previewMime,
  sampleCaption,
  sampleFilePath,
  samplePaths,
  type WorkSample,
} from "../lib/samples";
import { copyToClipboard, errorText, openExternal, openVaultFile } from "../lib/platform";

export function SampleDrawer({ path }: { path: string }) {
  const s = useStore((st) => st.data?.samples.find((x) => x.path === path));
  const samples = useStore((st) => st.data?.samples);
  const clients = useStore((st) => st.data?.clients ?? []);
  const grants = useStore((st) => st.data?.grants ?? []);
  const fs = useStore((st) => st.fs);
  const save = useStore((st) => st.saveSample);
  const mutate = useStore((st) => st.mutate);
  const open = useStore((st) => st.openDrawer);
  const close = useStore((st) => st.closeDrawer);
  const toast = useStore((st) => st.toast);
  const add = useAddSamples();
  if (!s) return <p className="muted">This work sample isn't in the vault any more.</p>;
  const allTags = [...new Set((samples ?? []).flatMap((x) => x.fm.tags))];
  const owner = path.split("/")[0];
  const set = (patch: Partial<WorkSample["fm"]>) => save({ ...s, fm: { ...s.fm, ...patch } });
  const file = sampleFilePath(s);
  const visual = s.fm.kind === "image" || s.fm.kind === "document";

  return (
    <div>
      <InlineText className="drawer-title" value={s.fm.title} onSave={(title) => title && set({ title })} />
      <div className="row small muted" style={{ marginTop: 4 }}>
        <span className="ellipsis">samples/{path}</span>
      </div>

      <section>
        <SamplePreview s={s} />
        <div className="row wrap" style={{ marginTop: 8 }}>
          {file && fs && (
            <button
              className="btn small"
              onClick={() => openVaultFile(fs, file, previewMime(s.fm.file)).catch((e) => toast(`Couldn't open it: ${errorText(e)}`, "error"))}
            >
              Open file
            </button>
          )}
          {s.fm.url && (
            <button className="btn small" onClick={() => void openExternal(s.fm.url).catch(() => {})}>
              Open link ↗
            </button>
          )}
          <button className="btn small ghost" onClick={() => void add.replace(s)}>
            {s.fm.file ? "Replace file…" : "Upload a file…"}
          </button>
          <span className="grow" />
          <button
            className="btn small ghost"
            title="Copy the caption for an application's work sample list"
            onClick={async () => {
              const text = [sampleCaption(s), s.body.trim(), s.fm.url].filter(Boolean).join("\n");
              await copyToClipboard(text);
              toast("Copied caption");
            }}
          >
            Copy caption
          </button>
        </div>
      </section>

      <section>
        <div className="props">
          <div className="k">Kind</div>
          <div className="v">
            <InlineSelect value={s.fm.kind} options={SAMPLE_KINDS} labels={SAMPLE_KIND_LABEL} onSave={(kind) => set({ kind })} />
          </div>
          <div className="k">Year</div>
          <div className="v">
            <InlineText value={s.fm.year} placeholder="2026" onSave={(year) => set({ year: year.trim() })} />
          </div>
          <div className="k">Medium</div>
          <div className="v">
            <InlineText
              value={s.fm.medium}
              placeholder={s.fm.kind === "audio" ? "String quartet, recorded live" : s.fm.kind === "video" ? "Documentation of performance" : "Oil on canvas"}
              onSave={(medium) => set({ medium })}
            />
          </div>
          {visual ? (
            <>
              <div className="k">Dimensions</div>
              <div className="v">
                <InlineText value={s.fm.dimensions} placeholder="24 x 36 in." onSave={(dimensions) => set({ dimensions })} />
              </div>
            </>
          ) : (
            <>
              <div className="k">Running time</div>
              <div className="v">
                <InlineText value={s.fm.duration} placeholder="3:20" onSave={(duration) => set({ duration })} />
              </div>
            </>
          )}
          <div className="k">Credits</div>
          <div className="v">
            <InlineText value={s.fm.credits} placeholder="Photo: Jane Doe. Performers: …" onSave={(credits) => set({ credits })} />
          </div>
          <div className="k">Link</div>
          <div className="v">
            <InlineText
              value={s.fm.url}
              placeholder="Paste a Vimeo, YouTube, SoundCloud or portfolio link"
              onSave={(url) => {
                const u = url.trim();
                const href = u && !/^https?:\/\//i.test(u) ? `https://${u}` : u;
                set(!s.fm.file && href ? { url: href, kind: kindForUrl(href) === "link" ? s.fm.kind : kindForUrl(href) } : { url: href });
              }}
            />
          </div>
          <div className="k">File</div>
          <div className="v">
            <span className="small ellipsis" style={{ padding: "4px 9px" }}>{s.fm.file || <span className="muted">None (link only)</span>}</span>
          </div>
          <div className="k">Tags</div>
          <div className="v">
            <TagInput value={s.fm.tags} suggestions={allTags} onSave={(tags) => set({ tags })} />
          </div>
        </div>
      </section>

      <section>
        <h3>Description</h3>
        <textarea
          className="textarea"
          style={{ minHeight: 120 }}
          placeholder="What this is and why it's a good sample. Many applications ask for a sentence or two per sample."
          defaultValue={s.body}
          key={s.path + s.body.length}
          onBlur={(e) => e.target.value !== s.body && save({ ...s, body: e.target.value })}
        />
      </section>

      <section>
        <h3>Sent with</h3>
        {s.fm.used_in.length === 0 ? (
          <p className="muted small">Not sent with an application yet. Add it from an application's Work samples section.</p>
        ) : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {s.fm.used_in.map((f) => {
              const g = grants.find((x) => x.folder === f);
              return (
                <li key={f}>
                  {g ? (
                    <a href="#" onClick={(e) => { e.preventDefault(); open({ kind: "grant", id: f }); }}>
                      {g.fm.title}
                    </a>
                  ) : (
                    <span className="muted">{f}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="row">
        <MenuButton
          label="Duplicate to…"
          className="btn small"
          items={[{ slug: "shared", name: "Shared" }, ...clients.map((c) => ({ slug: c.slug, name: c.fm.name }))]
            .filter((c) => c.slug !== owner)
            .map((c) => ({
              label: c.name,
              run: async () => {
                const copy = await mutate((f) => duplicateSample(f, s, c.slug));
                toast(`Copied to ${c.name}`, "ok", { label: "Open", run: () => open({ kind: "sample", id: copy.path }) });
              },
            }))}
        />
        <span className="grow" />
        <button
          className="btn small danger"
          onClick={async () => {
            if (!(await confirmAction("Move this work sample to trash?", "The sample and its file go to .manyapply/trash/ in your vault.", { okLabel: "Move to trash", danger: true }))) return;
            await mutate(async (f) => {
              for (const p of samplePaths(s)) if (await f.exists(p)) await trash(f, p);
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
