import { describe, expect, it } from "vitest";
import { parseFeed, matchesFilter, itemToGrant } from "../src/lib/feeds";
import { MemoryFS } from "../src/lib/fs/memory";
import { loadVault, initVault, createGrant, saveGrant, normalizeGrant } from "../src/lib/vault";
import { createSample, setSampleFile } from "../src/lib/samples";
import { reviewDocumentXml } from "../src/lib/reviewExport";
import { createDocument } from "../src/lib/documents";

describe("feeds from real-world formats", () => {
  it("Grants.gov style: HTML escaped in description, no CDATA", () => {
    const xml = `<rss version="2.0"><channel><title>Grants.gov New Opportunities by Category</title><item><title>FY27 Our Town</title><link>https://www.grants.gov/search-results-detail/1</link><description>&lt;table&gt;&lt;tr&gt;&lt;td&gt;Category: Arts&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;Close Date: Aug 01, 2027&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</description><pubDate>Tue, 10 Nov 2026 00:00:00 EST</pubDate><guid>https://www.grants.gov/search-results-detail/1</guid></item></channel></rss>`;
    const { items } = parseFeed(xml, "g");
    expect(items[0].summary).not.toMatch(/[<>]/);
    expect(matchesFilter(items[0], "arts")).toBe(true);
    expect(items[0].date).not.toBe("");
    expect(itemToGrant(items[0], "G").deadline).toBe("2027-08-01");
  });
  it("WordPress: channel image title, atom:link, comments, CDATA category", () => {
    const xml = `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>ArtDeadline</title><atom:link href="https://artdeadline.com/feed/" rel="self" type="application/rss+xml" /><link>https://artdeadline.com</link><image><title>ArtDeadline logo</title><url>x</url></image>
    <item><title>Fellowship &#8211; $10,000</title><link>https://artdeadline.com/ops/fellowship/</link><comments>https://artdeadline.com/ops/fellowship/#respond</comments><dc:creator><![CDATA[admin]]></dc:creator><pubDate>Fri, 20 Nov 2026 15:00:00 +0000</pubDate><category><![CDATA[Grants]]></category><guid isPermaLink="false">https://artdeadline.com/?p=123</guid><description><![CDATA[Deadline: January 5, 2027 [&#8230;]]]></description></item></channel></rss>`;
    const { title, items } = parseFeed(xml, "a");
    expect(title).toBe("ArtDeadline");
    expect(items[0].title).toBe("Fellowship – $10,000");
    expect(items[0].link).toBe("https://artdeadline.com/ops/fellowship/");
    expect(items[0].summary).toContain("…");
  });
  it("Blogger RSS", () => {
    const xml = `<?xml version='1.0' encoding='UTF-8'?><rss xmlns:atom='http://www.w3.org/2005/Atom' xmlns:openSearch='http://a9.com/-/spec/opensearchrss/1.0/' version='2.0'><channel><atom:id>tag:blogger.com,1999:blog-1</atom:id><lastBuildDate>Sun, 22 Nov 2026</lastBuildDate><title>NYCPlaywrights</title><item><guid isPermaLink='false'>tag:blogger.com,1999:blog-1.post-9</guid><pubDate>Sat, 21 Nov 2026 14:00:00 +0000</pubDate><atom:updated>2026-11-21T09:00:00.000-05:00</atom:updated><title>The Something Theatre Call for Submissions</title><description>&lt;p&gt;Deadline December 31, 2026.&lt;/p&gt;</description><link>https://www.nycplaywrights.org/2026/11/something.html</link><author>noreply@blogger.com (NYCP)</author></item></channel></rss>`;
    const { items } = parseFeed(xml, "n");
    expect(items[0].link).toBe("https://www.nycplaywrights.org/2026/11/something.html");
    expect(items[0].summary).toBe("Deadline December 31, 2026.");
  });
  it("Atom: link without rel, html content", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>X</title><link href="https://x.org/" rel="self"/><entry><title>A</title><link href="https://x.org/a"/><updated>2026-11-01T00:00:00Z</updated><content type="html">&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;</content></entry></feed>`;
    const { items } = parseFeed(xml, "x");
    expect(items[0].link).toBe("https://x.org/a");
    expect(items[0].summary).toBe("Hi & bye");
  });
  it("RSS 1.0 (RDF)", () => {
    const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>R</title></channel><item rdf:about="https://r.org/1"><title>One</title><link>https://r.org/1</link><dc:date>2026-10-10T00:00:00Z</dc:date></item></rdf:RDF>`;
    const { items } = parseFeed(xml, "r");
    expect(items[0]).toMatchObject({ title: "One", link: "https://r.org/1" });
    expect(items[0].date).toBe("2026-10-10T00:00:00.000Z");
  });
  it("filter words with regex characters", () => {
    expect(matchesFilter({ id: "", feedId: "", title: "C++ coding residency", link: "", date: "", summary: "", categories: [] }, "c++")).toBe(true);
  });
});

describe("vault edge cases", () => {
  it("old vault without samples/ or documents/ loads, saves and renames", async () => {
    const fs = new MemoryFS({ "grants/2027-01-x-y/grant.md": "---\ntitle: Y\nfunder: x\ndeadline: 2027-01-10\nwork_samples: me/a.md\n---\n", "clients/me.md": "---\nname: Me\n---\n" }, false);
    const d = await loadVault(fs);
    expect(d.samples).toEqual([]);
    expect(d.documents).toEqual([]);
    expect(d.grants[0].fm.work_samples).toEqual(["me/a.md"]);
    const g = await saveGrant(fs, { ...d.grants[0], fm: { ...d.grants[0].fm, deadline: "2027-03-01" } });
    expect(g.folder.startsWith("2027-03")).toBe(true);
  });
  it("sample with no extension, replacing a missing file", async () => {
    const fs = new MemoryFS({}, false);
    await initVault(fs);
    const s = await createSample(fs, "me", { title: "Raw", file: { name: "README", copyTo: (p) => fs.writeBytes(p, new Uint8Array([1])) } });
    expect(s.fm.file).toBe("raw");
    await fs.remove("samples/me/raw");
    const t = await setSampleFile(fs, s, { name: "x.png", copyTo: (p) => fs.writeBytes(p, new Uint8Array([2])) }, async () => { throw new Error("should not trash a missing file"); });
    expect(t.fm.file).toBe("raw.png");
    expect(t.fm.kind).toBe("image");
    const loaded = await loadVault(fs);
    expect(loaded.samples).toHaveLength(1); // the media file isn't read as a sample
  });
  it("document with .txt next to its .md isn't confused", async () => {
    const fs = new MemoryFS({}, false);
    await initVault(fs);
    await createDocument(fs, "me", { title: "Notes", file: { name: "notes.txt", copyTo: (p) => fs.writeText(p, "hi") } });
    expect((await loadVault(fs)).documents).toHaveLength(1);
  });
  it("review export: characters limit, CRLF, blank bullet", () => {
    const g = { folder: "f", fm: normalizeGrant({ title: "T" }, "f"), body: "", lastEdited: 0 };
    const xml = reviewDocumentXml({ grant: g, clientName: "", funderName: "", questions: [{ number: "1", title: "Short (100 characters)", limit: 10, limitUnit: "characters", draft: "d", text: "Hello there world\r\n\r\n- \r\n- b" }], samples: [], budget: null });
    // Counted like the in-app meter: the draft as saved, trimmed.
    expect(xml).toContain("over the limit");
    expect(xml).not.toContain("\r");
  });
});
