import { useMemo, useState } from "react";
import { useLookups, useStore } from "../store";
import { createLibraryItem, moveLibraryItem } from "../lib/vault";
import { searchLibrary } from "../lib/library";
import { askText } from "../components/dialogs";
import { Empty, Tags } from "../components/ui";
import { slugify } from "../lib/util";

export function Library() {
  const data = useStore((s) => s.data!);
  const clientFilter = useStore((s) => s.clientFilter);
  const mutate = useStore((s) => s.mutate);
  const open = useStore((s) => s.openDrawer);
  const toast = useStore((s) => s.toast);
  const { clientName } = useLookups();
  const [folder, setFolder] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const roots = ["shared", ...data.clients.map((c) => c.slug)].filter((r) => !clientFilter || r === clientFilter || r === "shared");
  const folders = data.libraryFolders.filter((f) => roots.includes(f.split("/")[0]));
  const visibleItems = data.library.filter((i) => roots.includes(i.path.split("/")[0]));
  const inFolder = folder ? visibleItems.filter((i) => i.path.startsWith(folder + "/")) : visibleItems;
  const items = searchLibrary(inFolder, q).filter((i) => !tag || i.fm.tags.includes(tag));
  const tags = [...new Set(visibleItems.flatMap((i) => i.fm.tags))].sort();

  const children = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of folders) {
      const parent = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
      m.set(parent, [...(m.get(parent) ?? []), f]);
    }
    return m;
  }, [folders]);

  const label = (f: string) => {
    const base = f.split("/").pop()!;
    if (!f.includes("/")) return base === "shared" ? "Shared" : clientName(base);
    return base.replace(/-/g, " ");
  };
  const count = (f: string) => visibleItems.filter((i) => i.path.startsWith(f + "/")).length;

  const drop = async (target: string) => {
    if (!dragging) return;
    const from = dragging;
    setDragging(null);
    setDropOn(null);
    if (from.slice(0, from.lastIndexOf("/")) === target) return;
    const dest = await mutate((fs) => moveLibraryItem(fs, from, target));
    toast(`Moved to ${label(target)}`);
    if (useStore.getState().drawer?.id === from) open({ kind: "library", id: dest });
  };

  const renderNode = (f: string, depth: number): React.ReactNode => {
    const kids = (children.get(f) ?? []).sort();
    const isCollapsed = collapsed.has(f);
    return (
      <div key={f}>
        <div
          className={`tree-node${folder === f ? " active" : ""}${dropOn === f ? " drop" : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => setFolder(f)}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            setDropOn(f);
          }}
          onDragLeave={() => setDropOn((d) => (d === f ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            void drop(f);
          }}
        >
          <span
            className="caret"
            onClick={(e) => {
              e.stopPropagation();
              const next = new Set(collapsed);
              if (isCollapsed) next.delete(f);
              else next.add(f);
              setCollapsed(next);
            }}
          >
            {kids.length ? (isCollapsed ? "▸" : "▾") : ""}
          </span>
          <span className="ellipsis">{label(f)}</span>
          <span className="n">{count(f) || ""}</span>
        </div>
        {!isCollapsed && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const newItem = async () => {
    const target = folder || clientFilter || "shared";
    const title = await askText("New answer", { placeholder: "Artist bio (short)", message: `Saved in ${label(target)}.` });
    if (!title) return;
    const item = await mutate((fs) => createLibraryItem(fs, target, title));
    open({ kind: "library", id: item.path });
  };
  const newFolder = async () => {
    const parent = folder || clientFilter || "shared";
    const name = await askText("New folder", { placeholder: "Bios", message: `Inside ${label(parent)}.` });
    if (!name) return;
    await mutate((fs) => fs.mkdir(`library/${parent}/${slugify(name)}`));
    setFolder(`${parent}/${slugify(name)}`);
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Library</h1>
          <div className="sub">Reusable answers. Each client has a folder, plus Shared for writing that works for anyone.</div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={newFolder}>New folder</button>
        <button className="btn primary" onClick={newItem}>+ New answer</button>
      </div>
      <div className="lib">
        <div className="tree panel" style={{ padding: 8 }}>
          <div className={`tree-node${folder === "" ? " active" : ""}`} onClick={() => setFolder("")}>
            <span className="caret" />
            All
            <span className="n">{visibleItems.length}</span>
          </div>
          {(children.get("") ?? [])
            .sort((a, b) => (a === "shared" ? -1 : b === "shared" ? 1 : a === "me" ? -1 : b === "me" ? 1 : a.localeCompare(b)))
            .map((f) => renderNode(f, 0))}
          <p className="muted small" style={{ padding: "8px 6px 0" }}>Drag an answer onto a folder to move it.</p>
        </div>
        <div>
          <div className="toolbar">
            <input className="input" style={{ width: 240 }} placeholder="Search answers" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="select" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All tags</option>
              {tags.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          {items.length === 0 ? (
            <Empty title="No answers here">
              <p>Save bios, project descriptions, impact statements and budget narratives here to reuse them.</p>
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Folder</th>
                    <th>Tags</th>
                    <th className="r">Words</th>
                    <th className="r">Used in</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr
                      key={i.path}
                      className="click"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", i.path);
                        setDragging(i.path);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropOn(null);
                      }}
                      onClick={() => open({ kind: "library", id: i.path })}
                    >
                      <td style={{ fontWeight: 550 }}>{i.fm.title}</td>
                      <td className="soft small">{i.path.split("/").slice(0, -1).map((p, n) => (n === 0 ? label(p) : p)).join(" / ")}</td>
                      <td><Tags tags={i.fm.tags} /></td>
                      <td className="r num">{i.fm.word_count}</td>
                      <td className="r num">{i.fm.used_in.length || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
