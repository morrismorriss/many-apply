import { useEffect, useMemo, useRef, useState } from "react";
import { useLookups, useStore } from "../store";
import { createLibraryItem, parseQuestions, readDraft, recordUsedIn } from "../lib/vault";
import { itemsForClient, searchLibrary, suggestFor } from "../lib/library";
import { debounce, fmtMoney, wordCount } from "../lib/util";
import { Modal, WordMeter } from "../components/ui";
import { askText } from "../components/dialogs";
import type { LibraryItem } from "../lib/model";

export function DraftEditor({ folder, draft }: { folder: string; draft: string }) {
  const fs = useStore((s) => s.fs!);
  const g = useStore((s) => s.data?.grants.find((x) => x.folder === folder));
  const library = useStore((s) => s.data!.library);
  const go = useStore((s) => s.go);
  const openDrawer = useStore((s) => s.openDrawer);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const { client } = useLookups();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [showLib, setShowLib] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const path = `grants/${folder}/${draft}`;

  const q = useMemo(() => (g ? parseQuestions(g.body).find((x) => x.draft === draft) : undefined), [g, draft]);

  useEffect(() => {
    void readDraft(fs, folder, draft).then(setText);
  }, [fs, folder, draft]);

  const save = useMemo(
    () =>
      debounce(async (t: string) => {
        await fs.writeText(path, t);
        setSaved(true);
      }, 600),
    [fs, path],
  );

  // Flush on unmount
  const latest = useRef<string | null>(null);
  latest.current = text;
  useEffect(
    () => () => {
      if (latest.current !== null) void fs.writeText(path, latest.current).then(() => useStore.getState().reload());
    },
    [fs, path],
  );

  if (!g) return <div className="page"><p className="muted">This application isn't in the vault.</p></div>;
  const words = text ? wordCount(text) : 0;
  const chars = text ? text.trim().length : 0;
  const unit = q?.limitUnit ?? "words";

  const insertAtCursor = (snippet: string) => {
    const el = ref.current;
    const t = text ?? "";
    const start = el?.selectionStart ?? t.length;
    const end = el?.selectionEnd ?? t.length;
    const before = t.slice(0, start);
    const pad = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const next = before + pad + snippet.trim() + "\n" + t.slice(end);
    setText(next);
    setSaved(false);
    save(next);
    setTimeout(() => {
      el?.focus();
      const pos = (before + pad + snippet.trim() + "\n").length;
      el?.setSelectionRange(pos, pos);
    }, 0);
  };

  const insertLibrary = async (item: LibraryItem) => {
    insertAtCursor(item.body);
    setShowLib(false);
    await mutate((fs) => recordUsedIn(fs, item, folder));
    toast(`Inserted "${item.fm.title}"`);
  };

  const c = client(g.fm.client);
  const fields: [string, string][] = c
    ? ([
        ["Name", c.fm.name],
        ["Mission", c.fm.mission],
        ["Website", c.fm.website],
        ["Contact person", c.fm.contact_person],
        ["Contact email", c.fm.contact_email],
        ["Fiscal sponsor", c.fm.fiscal_sponsor],
        ["Annual budget", c.fm.annual_budget !== null ? fmtMoney(c.fm.annual_budget) : ""],
        ["Fiscal year start", c.fm.fiscal_year_start],
      ] as [string, string][]).filter(([, v]) => v)
    : [];

  return (
    <div>
      <div className="editor-top">
        <button className="btn ghost small" onClick={() => { go({ screen: "pipeline" }); openDrawer({ kind: "grant", id: folder }); }}>
          ← {g.fm.title}
        </button>
        <span className="grow" />
        <span className="muted small">{saved ? "Saved" : "Saving…"}</span>
        <button className="btn small" onClick={() => setShowFields(!showFields)} disabled={!fields.length} title={fields.length ? "" : "Fill in the client profile first"}>
          Insert field ▾
        </button>
        <button className="btn small" onClick={() => setShowLib(true)}>Insert from Library</button>
        <button
          className="btn small ghost"
          title="Save this text as a reusable Library answer"
          onClick={async () => {
            const title = await askText("Save to Library", { initial: q?.title ?? "", message: `Saved in ${c?.fm.name ?? "your"} folder.` });
            if (!title || !text) return;
            const item = await mutate((fs) => createLibraryItem(fs, g.fm.client, title, text));
            await mutate((fs) => recordUsedIn(fs, item, folder));
            toast("Saved to Library");
          }}
        >
          Save to Library
        </button>
      </div>
      {showFields && (
        <div className="menu" style={{ right: 24, top: 52, position: "fixed" }}>
          {fields.map(([k, v]) => (
            <button key={k} onClick={() => { insertAtCursor(v); setShowFields(false); }}>
              <div style={{ fontWeight: 550 }}>{k}</div>
              <div className="muted small ellipsis" style={{ maxWidth: 260 }}>{v}</div>
            </button>
          ))}
        </div>
      )}
      <div className="editor-wrap">
        <div className="muted small" style={{ marginBottom: 4 }}>
          {q ? `Question ${q.number}` : draft}
        </div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 600, marginBottom: 14 }}>{q?.title ?? draft.replace(/^drafts\//, "")}</h1>
        <div style={{ marginBottom: 20, maxWidth: 320 }}>
          <WordMeter count={unit === "characters" ? chars : words} limit={q?.limit ?? null} unit={unit} />
          <div className="muted small num" style={{ marginTop: 4 }}>
            {words.toLocaleString()} words · {chars.toLocaleString()} characters
          </div>
        </div>
        {text === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <textarea
            ref={ref}
            className="editor"
            autoFocus
            value={text}
            placeholder="Start writing…"
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
              save(e.target.value);
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.max(el.scrollHeight, window.innerHeight * 0.6) + "px";
            }}
          />
        )}
      </div>
      {showLib && <LibraryPicker client={g.fm.client} question={q?.title ?? ""} items={library} onPick={insertLibrary} onClose={() => setShowLib(false)} />}
    </div>
  );
}

function LibraryPicker({ client, question, items, onPick, onClose }: {
  client: string;
  question: string;
  items: LibraryItem[];
  onPick: (i: LibraryItem) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const allowed = itemsForClient(items, client);
  const sugs = q ? [] : suggestFor(question, items, client, 3).map((s) => s.item);
  const list = searchLibrary(allowed, q).filter((i) => !sugs.includes(i));
  const row = (i: LibraryItem, hint?: string) => (
    <button key={i.path} className="card" style={{ textAlign: "left", width: "100%", marginBottom: 6 }} onClick={() => onPick(i)}>
      <div className="row">
        <span className="title grow">{i.fm.title}</span>
        {hint && <span className="label" style={{ ["--c" as string]: "var(--accent)" }}>{hint}</span>}
        <span className="muted small">{i.fm.word_count} words</span>
      </div>
      <div className="muted small" style={{ marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {i.body.slice(0, 220)}
      </div>
    </button>
  );
  return (
    <Modal title="Insert from Library" onClose={onClose} width={620}>
      <input className="input" autoFocus placeholder="Search this client's folder and Shared" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {sugs.map((i) => row(i, "Suggested"))}
      {list.map((i) => row(i))}
      {!sugs.length && !list.length && <p className="muted">Nothing matches. Only this client's folder and Shared are searched.</p>}
    </Modal>
  );
}
