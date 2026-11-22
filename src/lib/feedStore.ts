// Feed items live in memory only: they're fetched when a vault opens and when you press Refresh.
import { create } from "zustand";
import { parseFeed, type FeedItem, type FeedSource } from "./feeds";
import { errorText, fetchFeedText, getPref, isTauri, setPref } from "./platform";

interface FeedState {
  items: FeedItem[];
  errors: Record<string, string>;
  loading: boolean;
  /** Browser preview only: sample items, because browsers block reading most feeds. */
  demo: boolean;
  loadedAt: number;
  /** Items dated after this were published since the panel was last opened. */
  seenAt: number;
  hidden: Set<string>;
  refresh(feeds: FeedSource[]): Promise<void>;
  /** Forget loaded items, e.g. when another vault is opened. */
  reset(): void;
  markSeen(): void;
  hide(id: string): void;
  unhideAll(): void;
}

function loadHidden(): Set<string> {
  try {
    const a = JSON.parse(getPref("feedHidden") ?? "[]");
    return new Set(Array.isArray(a) ? a.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export const useFeeds = create<FeedState>((set, get) => ({
  items: [],
  errors: {},
  loading: false,
  demo: false,
  loadedAt: 0,
  seenAt: Number(getPref("feedsSeenAt") ?? 0) || Date.now() - 7 * 86400000,
  hidden: loadHidden(),

  async refresh(feeds) {
    const on = feeds.filter((f) => f.enabled && f.url.trim());
    if (!isTauri) {
      set({ items: demoFeedItems(), errors: {}, loading: false, loadedAt: Date.now(), demo: true });
      return;
    }
    set({ loading: true });
    const errors: Record<string, string> = {};
    const results = await Promise.all(
      on.map(async (f) => {
        try {
          const { items } = parseFeed(await fetchFeedText(f.url.trim()), f.id);
          if (!items.length) errors[f.id] = "No items found. Check that the link is an RSS or Atom feed.";
          return items;
        } catch (e) {
          errors[f.id] = errorText(e);
          return [];
        }
      }),
    );
    const seen = new Set<string>();
    const items = results
      .flat()
      .filter((i) => (seen.has(i.feedId + i.id) ? false : (seen.add(i.feedId + i.id), true)))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    set({ items, errors, loading: false, loadedAt: Date.now() });
  },
  reset() {
    set({ items: [], errors: {}, loadedAt: 0, demo: false });
  },
  markSeen() {
    const now = Date.now();
    setPref("feedsSeenAt", String(now));
    set({ seenAt: now });
  },
  hide(id) {
    const hidden = new Set(get().hidden);
    hidden.add(id);
    setPref("feedHidden", JSON.stringify([...hidden].slice(-1000)));
    set({ hidden });
  },
  unhideAll() {
    setPref("feedHidden", null);
    set({ hidden: new Set() });
  },
}));

function demoFeedItems(): FeedItem[] {
  const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const soon = (days: number) => new Date(Date.now() + days * 86400000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return [
    { id: "demo-1", feedId: "nycplaywrights", title: "Call for Submissions: Ten-Minute Play Festival", link: "https://example.org/ten-minute", date: ago(1), summary: `Seeking ten-minute plays for a spring festival. No submission fee. Deadline ${soon(30)}. Honorarium $250.`, categories: [] },
    { id: "demo-2", feedId: "artdeadline", title: "Emerging Artist Project Grants", link: "https://example.org/emerging", date: ago(2), summary: `Grants of up to $5,000 for individual artists in any discipline. Applications due ${soon(45)}.`, categories: ["Grants"] },
    { id: "demo-3", feedId: "grants-gov", title: "Grants for Arts Projects", link: "https://example.org/gap", date: ago(5), summary: `National Endowment for the Arts. Category: Arts. Closing date ${soon(80)}.`, categories: ["Arts"] },
    { id: "demo-4", feedId: "grants-gov", title: "Rural Broadband Infrastructure", link: "https://example.org/broadband", date: ago(3), summary: "Category: Community Development.", categories: ["Community Development"] },
    { id: "demo-5", feedId: "nycplaywrights", title: "Playwrights' Residency, Summer Session", link: "https://example.org/residency", date: ago(12), summary: "Four-week residency with housing and a $1,000 stipend.", categories: [] },
  ];
}
