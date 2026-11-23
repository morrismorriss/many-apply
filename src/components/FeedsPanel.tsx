import { useEffect, useMemo, useRef, useState } from "react";
import { useLookups, useStore } from "../store";
import { useFeeds } from "../lib/feedStore";
import { DEFAULT_FEEDS, FEED_MAX_AGE_DAYS, itemToGrant, matchesFilter, type FeedItem, type FeedSource } from "../lib/feeds";
import { errorText, openExternal } from "../lib/platform";
import { defaultGrantBody, setBodySection } from "../lib/vault";
import { fmtDate, slugify } from "../lib/util";
import { confirmAction } from "./dialogs";
import { ClientMultiSelect } from "./ui";
import { ME } from "../lib/model";

/** Items from turned-on feeds that pass their keyword filter and haven't been hidden. */
export function visibleFeedItems(items: FeedItem[], feeds: FeedSource[], hidden: Set<string>): FeedItem[] {
  const byId = new Map(feeds.map((f) => [f.id, f]));
  return items.filter((i) => {
    const f = byId.get(i.feedId);
    return !!f && f.enabled && !hidden.has(i.id) && matchesFilter(i, f.match);
  });
}

/** Count of items published since the panel was last opened, for the sidebar badge. */
export function useNewFeedCount(): number {
  const feeds = useStore((s) => s.data?.settings.feeds);
  const { items, hidden, seenAt } = useFeeds();
  return useMemo(
    () => (feeds ? visibleFeedItems(items, feeds, hidden).filter((i) => i.date && Date.parse(i.date) > seenAt).length : 0),
    [items, feeds, hidden, seenAt],
  );
}

export function FeedsPanel() {
  const settings = useStore((s) => s.data!.settings);
  const grants = useStore((s) => s.data!.grants);
  const updateSettings = useStore((s) => s.updateSettings);
  const addGrant = useStore((s) => s.addGrant);
  const openDrawer = useStore((s) => s.openDrawer);
  const toast = useStore((s) => s.toast);
  const { items, errors, loading, loadedAt, seenAt, hidden, demo, refresh, markSeen, hide, unhideAll } = useFeeds();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("");
  const [managing, setManaging] = useState(false);
  const [seenBefore] = useState(seenAt);
  const feeds = settings.feeds;
  const savingRef = useRef(new Set<string>());
  const clientFilter = useStore((s) => s.clientFilter);
  const hasClients = useStore((s) => (s.data?.clients.length ?? 0) > 1);
  const { clientName } = useLookups();
  // Who saved items are for: the sidebar's client, until changed here.
  const [saveFor, setSaveFor] = useState<string[]>([clientFilter || ME]);
  useEffect(() => setSaveFor([clientFilter || ME]), [clientFilter]);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!loadedAt && !loading) void refresh(feeds);
    // Mark as seen when the panel closes, so "new" stays visible while it's open.
    return () => markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId = new Map(feeds.map((f) => [f.id, f]));
  const savedUrls = new Map(grants.filter((g) => g.fm.url).map((g) => [g.fm.url, g.folder]));
  const ql = q.trim().toLowerCase();
  const list = visibleFeedItems(items, feeds, hidden).filter(
    (i) => (!only || i.feedId === only) && (!ql || i.title.toLowerCase().includes(ql) || i.summary.toLowerCase().includes(ql)),
  );
  const hiddenCount = items.filter((i) => hidden.has(i.id)).length;

  const save = async (i: FeedItem) => {
    // Saving writes files and reloads the vault, which can take a moment: ignore repeat clicks
    // (the ref stops a second click that lands before React re-renders the button).
    if (savingRef.current.has(i.id) || (i.link && savedUrls.has(i.link))) return;
    savingRef.current.add(i.id);
    setSaving(new Set(savingRef.current));
    try {
      const f = byId.get(i.feedId);
      const g = itemToGrant(i, f?.name ?? "a feed");
      const created = await addGrant(
        { title: g.title, url: g.url, deadline: g.deadline, max_award: g.max_award, status: "researching", clients: saveFor },
        setBodySection(defaultGrantBody(), "Eligibility", g.eligibility),
      );
      toast(hasClients ? `Saved to Research for ${saveFor.map(clientName).join(", ")}` : "Saved to Research", "ok", { label: "Open", run: () => openDrawer({ kind: "grant", id: created.folder }) });
    } catch (e) {
      toast(`Couldn't save it: ${errorText(e)}`, "error");
      savingRef.current.delete(i.id);
    } finally {
      setSaving(new Set(savingRef.current));
    }
  };

  const setFeeds = (next: FeedSource[]) => updateSettings((s) => ({ ...s, feeds: next }));
  const patchFeed = (id: string, patch: Partial<FeedSource>) => setFeeds(feeds.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h1>Opportunity feeds</h1>
        </div>
        <span className="grow" />
        <button className="btn small" disabled={loading} onClick={() => void refresh(feeds)}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button
          className={`btn small${managing ? " primary" : ""}`}
          onClick={() => {
            if (managing) void refresh(feeds);
            setManaging(!managing);
          }}
        >
          {managing ? "Done" : "Manage feeds"}
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        New grants and open calls from the feeds you choose. Feeds are only read: nothing about you is sent, and nothing is saved until you
        click Save to Research. To keep things light, items older than {FEED_MAX_AGE_DAYS} days or past their deadline drop off by
        themselves; anything you save stays in Research.
      </p>

      {demo && !managing && (
        <div className="callout small" style={{ marginBottom: 8 }}>
          These are sample items. Browsers block web pages from reading most feeds, so real feeds load in the desktop app.
        </div>
      )}
      {managing ? (
        <ManageFeeds feeds={feeds} errors={errors} onPatch={patchFeed} onSet={setFeeds} onRefresh={() => void refresh(feeds)} />
      ) : (
        <>
          <div className="row" style={{ margin: "12px 0" }}>
            <input className="input grow" placeholder="Search feeds" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="select" style={{ width: "auto", maxWidth: 170 }} aria-label="Feed" value={only} onChange={(e) => setOnly(e.target.value)}>
              <option value="">All feeds</option>
              {feeds.filter((f) => f.enabled).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {hasClients && (
            <div className="row small" style={{ margin: "-4px 0 12px" }}>
              <span className="soft">Save to Research for</span>
              <ClientMultiSelect value={saveFor} label="Add who to save for" onChange={setSaveFor} />
            </div>
          )}
          {Object.entries(errors).filter(([id]) => byId.get(id)?.enabled).map(([id, msg]) => (
            <div key={id} className="callout warn small" style={{ marginBottom: 8 }}>
              <strong>{byId.get(id)?.name}:</strong> {msg}{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setManaging(true); }}>Edit feed</a>
            </div>
          ))}
          {feeds.every((f) => !f.enabled) ? (
            <p className="muted">All feeds are turned off. Open Manage feeds to turn some on or add your own.</p>
          ) : list.length === 0 && !loading ? (
            <p className="muted">{items.length ? "Nothing matches." : "No items yet."}</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {list.slice(0, 150).map((i) => {
                const isNew = !!i.date && Date.parse(i.date) > seenBefore;
                const saved = i.link ? savedUrls.get(i.link) : undefined;
                return (
                  <div key={i.feedId + i.id} className="panel feed-item">
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <a
                        href="#"
                        className="grow feed-title"
                        onClick={(e) => { e.preventDefault(); if (i.link) void openExternal(i.link).catch(() => {}); }}
                        title={i.link}
                      >
                        {i.title}
                      </a>
                      {isNew && <span className="new-pill">New</span>}
                    </div>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      {byId.get(i.feedId)?.name}
                      {i.date && ` · ${fmtDate(i.date.slice(0, 10), { year: true })}`}
                    </div>
                    {i.summary && (
                      <>
                        <p className={`soft feed-summary${expanded.has(i.feedId + i.id) ? " open" : ""}`}>{i.summary}</p>
                        {i.summary.length > 480 && (
                          <button
                            className="btn small ghost"
                            style={{ marginLeft: -8 }}
                            onClick={() => {
                              const k = i.feedId + i.id;
                              const next = new Set(expanded);
                              if (next.has(k)) next.delete(k);
                              else next.add(k);
                              setExpanded(next);
                            }}
                          >
                            {expanded.has(i.feedId + i.id) ? "Show less" : "Show more"}
                          </button>
                        )}
                      </>
                    )}
                    <div className="row" style={{ marginTop: 6 }}>
                      {saved ? (
                        <button className="btn small ghost" onClick={() => openDrawer({ kind: "grant", id: saved })}>In Research ✓</button>
                      ) : (
                        <button className="btn small" disabled={saving.has(i.id)} onClick={() => void save(i)}>
                          {saving.has(i.id) ? "Saving…" : "Save to Research"}
                        </button>
                      )}
                      <span className="grow" />
                      <button className="btn small ghost" title="Hide this item" onClick={() => hide(i.id)}>Hide</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {hiddenCount > 0 && (
            <p className="muted small" style={{ marginTop: 12 }}>
              {hiddenCount} hidden.{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); unhideAll(); }}>Show them again</a>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ManageFeeds({ feeds, errors, onPatch, onSet, onRefresh }: {
  feeds: FeedSource[];
  errors: Record<string, string>;
  onPatch: (id: string, patch: Partial<FeedSource>) => void;
  onSet: (next: FeedSource[]) => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const add = () => {
    const u = url.trim();
    if (!u) return;
    const href = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    const base = slugify(name || href.replace(/^https?:\/\//, "")) || "feed";
    let id = base;
    let n = 2;
    while (feeds.some((f) => f.id === id)) id = `${base}-${n++}`;
    onSet([...feeds, { id, name: name.trim() || href.replace(/^https?:\/\//, "").split("/")[0], url: href, enabled: true, match: "" }]);
    setName("");
    setUrl("");
    setTimeout(onRefresh, 300);
  };
  return (
    <div className="stack" style={{ gap: 10, marginTop: 12 }}>
      {feeds.map((f) => (
        <div key={f.id} className="panel" style={{ padding: "10px 12px" }}>
          <div className="row">
            <label className="check" title={f.enabled ? "Turn off" : "Turn on"}>
              <input type="checkbox" aria-label={`Show ${f.name}`} checked={f.enabled} onChange={(e) => onPatch(f.id, { enabled: e.target.checked })} />
            </label>
            <input
                className="inline grow"
                style={{ fontWeight: 550, minWidth: 0 }}
                defaultValue={f.name}
                aria-label="Feed name"
                onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && onPatch(f.id, { name: e.target.value.trim() })}
              />
            {f.builtin ? (
              <button
                className="btn small ghost"
                title="Put back the suggested link and filter"
                onClick={() => {
                  const d = DEFAULT_FEEDS.find((x) => x.id === f.id);
                  if (d) onPatch(f.id, { url: d.url, match: d.match, name: d.name });
                }}
              >
                Reset
              </button>
            ) : (
              <button
                className="icon-btn"
                title="Remove this feed"
                onClick={async () => (await confirmAction(`Remove ${f.name}?`)) && onSet(feeds.filter((x) => x.id !== f.id))}
              >
                ×
              </button>
            )}
          </div>
          <label className="field small" style={{ marginTop: 6 }}>
            Feed link
            <input
              className="input"
              defaultValue={f.url}
              key={f.url}
              onBlur={(e) => e.target.value.trim() !== f.url && onPatch(f.id, { url: e.target.value.trim() })}
            />
          </label>
          <label className="field small" style={{ marginTop: 6 }}>
            Only show items mentioning (optional, comma-separated)
            <input
              className="input"
              defaultValue={f.match}
              key={f.match}
              placeholder="theater, playwright, residency"
              onBlur={(e) => e.target.value !== f.match && onPatch(f.id, { match: e.target.value })}
            />
          </label>
          {errors[f.id] && f.enabled && <p className="small warn-text" style={{ margin: "6px 0 0" }}>{errors[f.id]}</p>}
        </div>
      ))}
      <div className="panel" style={{ padding: "10px 12px" }}>
        <strong className="small">Add your own feed</strong>
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          <input className="input" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="input"
            placeholder="https://example.org/feed/"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <div className="row">
            <span className="muted small grow">Most blogs and listing sites have one. On WordPress sites try adding /feed/ to the address.</span>
            <button className="btn small primary" disabled={!url.trim()} onClick={add}>Add feed</button>
          </div>
        </div>
      </div>
    </div>
  );
}
