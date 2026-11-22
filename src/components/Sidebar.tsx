import { useStore, useGrants, type ScreenId } from "../store";
import { useEffect } from "react";
import { TimerChip } from "./ui";
import { useNewFeedCount } from "./FeedsPanel";
import { useFeeds } from "../lib/feedStore";

const NAV: { id: ScreenId; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "◧" },
  { id: "research", label: "Research", icon: "⌕" },
  { id: "pipeline", label: "Pipeline", icon: "▥" },
  { id: "calendar", label: "Calendar", icon: "▦" },
  { id: "library", label: "Library", icon: "❏" },
  { id: "documents", label: "Documents", icon: "⚿" },
  { id: "funders", label: "Funders", icon: "⌂" },
  { id: "clients", label: "Clients", icon: "☺" },
  { id: "giving", label: "Individual Giving", icon: "♡" },
  { id: "reports", label: "Reports", icon: "▤" },
  { id: "import", label: "Import", icon: "⇪" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const route = useStore((s) => s.route);
  const go = useStore((s) => s.go);
  const clients = useStore((s) => s.data?.clients ?? []);
  const filter = useStore((s) => s.clientFilter);
  const setFilter = useStore((s) => s.setClientFilter);
  const root = useStore((s) => s.fs?.root);
  const grants = useGrants();
  const counts: Partial<Record<ScreenId, number>> = {
    research: grants.filter((g) => g.fm.status === "researching").length,
    pipeline: grants.filter((g) => ["planning", "drafting", "submitted"].includes(g.fm.status)).length,
  };
  const drawer = useStore((s) => s.drawer);
  const openDrawer = useStore((s) => s.openDrawer);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const feeds = useStore((s) => s.data?.settings.feeds);
  const newFeedItems = useNewFeedCount();
  const feedsOpen = drawer?.kind === "feeds";
  // A different vault has its own feed list: forget the last one's items.
  useEffect(() => {
    useFeeds.getState().reset();
  }, [root]);
  // Load feeds once per vault, a few seconds after it opens, so the badge can show new items.
  useEffect(() => {
    if (!feeds || useFeeds.getState().loadedAt || useFeeds.getState().loading) return;
    const t = setTimeout(() => void useFeeds.getState().refresh(feeds), 3000);
    return () => clearTimeout(t);
  }, [root, feeds]);
  const current = route.screen === "draft" || route.screen === "budget" ? "pipeline" : route.screen;

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        Many Apply
      </div>
      <select
        className="select"
        aria-label="Client"
        style={{ marginBottom: 10 }}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.fm.name}
          </option>
        ))}
      </select>
      {NAV.map((n) => (
        <button key={n.id} className={`nav-item${current === n.id ? " active" : ""}`} onClick={() => go({ screen: n.id })}>
          <span className="icon" aria-hidden>
            {n.icon}
          </span>
          {n.label}
          {counts[n.id] ? <span className="count">{counts[n.id]}</span> : null}
        </button>
      ))}
      <button
        className={`nav-item${feedsOpen ? " active" : ""}`}
        aria-expanded={feedsOpen}
        title="New grants and open calls from RSS feeds"
        onClick={() => (feedsOpen ? closeDrawer() : openDrawer({ kind: "feeds", id: "all" }))}
      >
        <span className="icon" aria-hidden>
          ◉
        </span>
        Opportunity feeds
        {newFeedItems ? <span className="count new">{newFeedItems}</span> : null}
      </button>
      <TimerChip />
      <div className="sidebar-foot" title={root}>
        {root}
      </div>
    </nav>
  );
}
