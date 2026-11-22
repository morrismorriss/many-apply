import type { LibraryItem } from "./model";
import { ME } from "./model";

const STOP = new Set(
  "a an and are as at be by for from has have how in is it its of on or our please provide that the their this to up we what when where which who why will with you your describe tell us words word characters limit max maximum".split(
    " ",
  ),
);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

function stem(w: string) {
  return w.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "") || w;
}

/** Top-level library folder an item lives in (the client slug, or "shared"). */
export function itemOwner(item: LibraryItem): string {
  return item.path.split("/")[0];
}

/** Items a given client may draw on: their own folder, then Shared. Never another client's writing. */
export function itemsForClient(items: LibraryItem[], client: string): LibraryItem[] {
  const own = items.filter((i) => itemOwner(i) === (client || ME));
  const shared = items.filter((i) => itemOwner(i) === "shared");
  return [...own, ...shared];
}

export interface Suggestion {
  item: LibraryItem;
  score: number;
  shared: boolean;
}

/** Simple keyword/tag matching against a question title. No AI. */
export function suggestFor(question: string, items: LibraryItem[], client: string, limit = 4): Suggestion[] {
  const q = new Set(tokens(question));
  if (!q.size) return [];
  const out: Suggestion[] = [];
  for (const item of itemsForClient(items, client)) {
    let score = 0;
    for (const t of item.fm.tags.flatMap((x) => tokens(x))) if (q.has(t)) score += 3;
    for (const t of new Set(tokens(item.fm.title))) if (q.has(t)) score += 2;
    const bodyTokens = new Set(tokens(item.body.slice(0, 2000)));
    for (const t of q) if (bodyTokens.has(t)) score += 0.5;
    const shared = itemOwner(item) === "shared";
    if (score >= 2) out.push({ item, score: score + (shared ? 0 : 0.25), shared });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function searchLibrary(items: LibraryItem[], query: string): LibraryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) => i.fm.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q) || i.fm.tags.some((t) => t.includes(q)),
  );
}
