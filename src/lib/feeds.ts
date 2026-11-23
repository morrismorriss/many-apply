// Opportunity feeds: RSS and Atom feeds of grants and open calls, shown in a sidebar panel.
// Feeds are only read. Nothing about you is sent anywhere, and nothing is saved until you click
// "Save to Research". The parser is a small hand-written one so it runs the same in the app and in tests.
import { findAmounts, findDates } from "./extract";

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** Only show items mentioning one of these words (comma-separated). Empty shows everything. */
  match: string;
  /** One of the feeds Many Apply suggests. They can be turned off but not deleted. */
  builtin?: boolean;
}

export const DEFAULT_FEEDS: FeedSource[] = [
  {
    id: "artdeadline",
    name: "ArtDeadline: grants",
    url: "https://artdeadline.com/ops-type/type-grants/feed/",
    enabled: true,
    match: "",
    builtin: true,
  },
  {
    id: "nycplaywrights",
    name: "NYC Playwrights: calls for submissions",
    url: "https://www.nycplaywrights.org/feeds/posts/default?alt=rss",
    enabled: true,
    match: "",
    builtin: true,
  },
];

/** Built-in feeds that were removed (Grants.gov's RSS stopped working). Dropped from saved settings. */
const RETIRED_FEEDS = ["grants-gov"];
const GRANTS_GOV_URL = "https://www.grants.gov/rss/GG_NewOppByCategory.xml";

/** Settings saved before feeds existed get the defaults; built-in feeds added later are appended. */
export function mergeFeeds(saved: FeedSource[] | undefined): FeedSource[] {
  if (!Array.isArray(saved)) return DEFAULT_FEEDS.map((f) => ({ ...f }));
  const out = saved.filter((f) => f && typeof f.url === "string").map((f) => ({ ...f, match: f.match ?? "", enabled: f.enabled !== false }));
  for (const d of DEFAULT_FEEDS) if (!out.some((f) => f.id === d.id)) out.push({ ...d });
  // Feeds Many Apply used to suggest but no longer works with. Ones the user added stay.
  return out.filter((f) => !(RETIRED_FEEDS.includes(f.id) && (f.builtin || f.url === GRANTS_GOV_URL)));
}

export interface FeedItem {
  /** Stable id: the guid or link. */
  id: string;
  feedId: string;
  title: string;
  link: string;
  /** ISO date-time, or "" if the feed doesn't give one. */
  date: string;
  /** Plain text, HTML removed. */
  summary: string;
  categories: string[];
}

// ---------------------------------------------------------------- parsing

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The text inside an element, with CDATA unwrapped. Returns "" if missing. */
function tagText(xml: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(`<${name.replace(":", "\\:")}(?:\\s[^>]*)?>([\\s\\S]*?)</${name.replace(":", "\\:")}>`, "i");
    const m = re.exec(xml);
    if (m) return unwrap(m[1]);
  }
  return "";
}

function unwrap(s: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return cdata ? cdata[1] : decodeEntities(s);
}

/** HTML to readable plain text. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toIso(s: string): string {
  if (!s.trim()) return "";
  const d = new Date(s.trim());
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Parse RSS 2.0, RSS 1.0 (RDF) or Atom. Unknown formats give no items, never an exception. */
export function parseFeed(xml: string, feedId: string): { title: string; items: FeedItem[] } {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = isAtom ? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) : xml.match(/<item[\s>][\s\S]*?<\/item>/gi);
  const head = xml.slice(0, xml.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i) >>> 0);
  const title = htmlToText(tagText(head, ["title"]));
  const items: FeedItem[] = [];
  for (const b of blocks ?? []) {
    let link = "";
    if (isAtom) {
      const alt = /<link\b[^>]*rel=["']alternate["'][^>]*>/i.exec(b) ?? /<link\b(?![^>]*rel=["'](?:self|edit|replies)["'])[^>]*>/i.exec(b);
      link = alt ? decodeEntities(/href=["']([^"']+)["']/i.exec(alt[0])?.[1] ?? "") : "";
    } else {
      link = tagText(b, ["link"]).trim();
      if (!link) link = decodeEntities(/<link\b[^>]*href=["']([^"']+)["']/i.exec(b)?.[1] ?? "");
    }
    const guid = tagText(b, ["guid", "id"]).trim();
    const summaryHtml = tagText(b, ["content:encoded", "description", "summary", "content"]);
    const categories = [...b.matchAll(/<category\b([^>]*)(?:\/>|>([\s\S]*?)<\/category>)/gi)]
      .map((m) => (m[2] ? unwrap(m[2]) : decodeEntities(/term=["']([^"']+)["']/i.exec(m[1])?.[1] ?? "")).trim())
      .filter(Boolean);
    const itemTitle = htmlToText(tagText(b, ["title"])) || "(untitled)";
    items.push({
      id: guid || link || `${feedId}:${itemTitle}`,
      feedId,
      title: itemTitle,
      link: link.trim(),
      date: toIso(tagText(b, ["pubDate", "published", "updated", "dc:date"])),
      summary: htmlToText(summaryHtml).slice(0, 4000),
      categories,
    });
  }
  return { title, items };
}

/** Whether an item passes a feed's keyword filter. */
export function matchesFilter(item: FeedItem, match: string): boolean {
  const words = match
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (!words.length) return true;
  const hay = `${item.title}\n${item.summary}\n${item.categories.join(" ")}`.toLowerCase();
  return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(hay));
}

/** What "Save to Research" pre-fills: the deadline and amount it can spot, and the summary as eligibility notes. */
export function itemToGrant(item: FeedItem, feedName: string) {
  const text = `${item.title}\n${item.summary}`;
  const today = new Date().toISOString().slice(0, 10);
  const dates = findDates(text).filter((d) => d.iso >= today);
  const deadline = dates.find((d) => d.label === "deadline") ?? dates[0];
  const amounts = findAmounts(text);
  const max = amounts.find((a) => a.label === "max_award");
  return {
    title: item.title.slice(0, 140),
    url: item.link,
    deadline: deadline?.iso ?? "",
    max_award: max ? max.value : amounts.length ? Math.max(...amounts.map((a) => a.value)) : null,
    eligibility: [item.summary.slice(0, 2000), `From ${feedName}.`].filter(Boolean).join("\n\n"),
  };
}
