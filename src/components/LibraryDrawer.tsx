import { useStore } from "../store";
import { InlineText, MenuButton, TagInput } from "./ui";
import { confirmAction } from "./dialogs";
import { createLibraryItem, trash } from "../lib/vault";
import { wordCount } from "../lib/util";

export function LibraryDrawer({ path }: { path: string }) {
  const item = useStore((s) => s.data?.library.find((i) => i.path === path));
  const clients = useStore((s) => s.data?.clients ?? []);
  const library = useStore((s) => s.data?.library);
  const allTags = [...new Set((library ?? []).flatMap((i) => i.fm.tags))];
  const grants = useStore((s) => s.data?.grants ?? []);
  const save = useStore((s) => s.saveLibrary);
  const mutate = useStore((s) => s.mutate);
  const open = useStore((s) => s.openDrawer);
  const close = useStore((s) => s.closeDrawer);
  const toast = useStore((s) => s.toast);
  if (!item) return <p className="muted">This item isn't in the Library any more.</p>;
  const owner = path.split("/")[0];

  return (
    <div>
      <InlineText className="drawer-title" value={item.fm.title} onSave={(title) => title && save({ ...item, fm: { ...item.fm, title } })} />
      <div className="row small muted" style={{ marginTop: 4 }}>
        <span>library/{path}</span>
        <span className="grow" />
        <span className="num">{wordCount(item.body)} words</span>
      </div>
      <section>
        <div className="props">
          <div className="k">Tags</div>
          <div className="v">
            <TagInput value={item.fm.tags} suggestions={allTags} onSave={(tags) => save({ ...item, fm: { ...item.fm, tags } })} />
          </div>
        </div>
      </section>
      <section>
        <h3>Text</h3>
        <textarea
          className="textarea"
          style={{ minHeight: 260, fontFamily: "var(--font-serif)", fontSize: 15.5, lineHeight: 1.65 }}
          defaultValue={item.body}
          key={item.path + item.body.length}
          onBlur={(e) => e.target.value !== item.body && save({ ...item, body: e.target.value })}
        />
      </section>
      <section>
        <h3>Used in</h3>
        {item.fm.used_in.length === 0 ? (
          <p className="muted small">Not used yet.</p>
        ) : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {item.fm.used_in.map((f) => {
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
                const copy = await mutate((fs) => createLibraryItem(fs, c.slug, item.fm.title, item.body, item.fm.tags));
                toast(`Copied to ${c.name}`, "ok", { label: "Open", run: () => open({ kind: "library", id: copy.path }) });
              },
            }))}
        />
        <span className="grow" />
        <button
          className="btn small danger"
          onClick={async () => {
            if (!(await confirmAction("Move this answer to trash?", "It goes to .manyapply/trash/ in your vault.", { okLabel: "Move to trash", danger: true }))) return;
            await mutate((fs) => trash(fs, `library/${path}`));
            close();
          }}
        >
          Delete
        </button>
      </section>
    </div>
  );
}
