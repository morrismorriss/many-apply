import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../src/lib/frontmatter";
import { findAmounts, findDates, parseDate } from "../src/lib/extract";
import { budgetTotals, parseBudgetCsv, stringifyBudgetCsv } from "../src/lib/budget";
import { MemoryFS } from "../src/lib/fs/memory";
import { createGrant, grantFolderName, loadVault, parseQuestions, saveGrant, withStatus, addQuestionToBody, normalizeGrant } from "../src/lib/vault";
const normalizeGrantForTest = (raw: Record<string, unknown>) => normalizeGrant(raw, "x");
import { autoMapping, buildPreview, readCsv, runImport, undoImport, guessStatus } from "../src/lib/csvImport";
import { needsAttention, toICS, calendarEvents, dashboardNumbers } from "../src/lib/stats";
import { sampleVault } from "../src/lib/sample";
import { suggestFor } from "../src/lib/library";

describe("frontmatter", () => {
  it("round-trips the spec's grant format", () => {
    const text = `---
title: Project Grant 2027
client: me
amount_requested: 5000
amount_awarded:
deadline: 2027-02-01
tags: [theater, individual-artist]
reports:
  - {title: Interim report, due: 2027-09-01, submitted_on: , todoist_task_id: , notes: "From award email"}
status_history:
  - {status: researching, date: 2026-11-22}
---

## Eligibility
`;
    const { data, body } = parseFrontmatter<any>(text);
    expect(data.deadline).toBe("2027-02-01");
    expect(data.amount_awarded).toBeNull();
    expect(data.reports[0].notes).toBe("From award email");
    expect(data.reports[0].submitted_on).toBeNull();
    const out = stringifyFrontmatter(data, body);
    expect(out).toContain("amount_awarded:\n");
    expect(out).toContain("  - {title: Interim report, due: 2027-09-01, submitted_on:, todoist_task_id:, notes: From award email}");
    expect(parseFrontmatter<any>(out).data).toEqual(data);
  });
  it("quotes risky strings", () => {
    const out = stringifyFrontmatter({ notes: "a: b, c", t: "yes", u: "https://x.org/a?b=c" }, "");
    expect(parseFrontmatter<any>(out).data).toEqual({ notes: "a: b, c", t: "yes", u: "https://x.org/a?b=c" });
  });
});

describe("pattern matching", () => {
  it("parses the accepted date formats", () => {
    expect(parseDate("2027-02-01")).toBe("2027-02-01");
    expect(parseDate("2/1/2027")).toBe("2027-02-01");
    expect(parseDate("2/1/2027", "dayfirst")).toBe("2027-01-02");
    expect(parseDate("Feb 1 2027")).toBe("2027-02-01");
    expect(parseDate("February 1, 2027")).toBe("2027-02-01");
    expect(parseDate("1 February 2027")).toBe("2027-02-01");
    expect(parseDate("February 1, 2027 10:00 AM")).toBe("2027-02-01");
    expect(parseDate("13/2/2027")).toBe("2027-02-13");
    expect(parseDate("nope")).toBeNull();
  });
  it("finds deadlines and amounts in pasted text", () => {
    const t = "Applications are due February 1, 2027 at 5pm. Awards of up to $5,000 are available. Decisions announced May 15, 2027. Total pool $1.5 million.";
    const ds = findDates(t, new Date(2026, 10, 22));
    expect(ds[0]).toMatchObject({ iso: "2027-02-01", label: "deadline" });
    expect(ds.find((d) => d.iso === "2027-05-15")?.label).toBe("decision");
    const as = findAmounts(t);
    expect(as[0]).toMatchObject({ value: 5000, label: "max_award" });
    expect(as.map((a) => a.value)).toContain(1500000);
    expect(findAmounts("grants of $10k")[0].value).toBe(10000);
  });
});

describe("budget", () => {
  it("parses, totals and writes budget.csv", () => {
    const lines = parseBudgetCsv("category,type,line_item,quantity,rate,amount,notes\nSpace,Expense,Rehearsal,3,150,,\nArtist fees,Expense,Fee,,,1000,\nOther,Income,Tickets,,,200,\n");
    const t = budgetTotals(lines);
    expect(t.expenses).toBe(1450);
    expect(t.income).toBe(200);
    expect(t.gap).toBe(1250);
    const csv = stringifyBudgetCsv(lines, { totals: true });
    expect(csv).toContain("TOTAL EXPENSES");
    expect(parseBudgetCsv(csv)).toHaveLength(3);
  });
});

describe("vault", () => {
  it("creates, renames and loads grants", async () => {
    const fs = new MemoryFS({}, false);
    const g = await createGrant(fs, { title: "Project Grant", funder: "pittsburgh-foundation", deadline: "2027-02-01" });
    expect(g.folder).toBe("2027-02-pittsburgh-foundation-project-grant");
    const moved = await saveGrant(fs, { ...g, fm: withStatus({ ...g.fm, deadline: "2027-03-05" }, "planning") });
    expect(moved.folder).toBe("2027-03-pittsburgh-foundation-project-grant");
    const v = await loadVault(fs);
    expect(v.grants).toHaveLength(1);
    expect(v.grants[0].fm.status_history.map((h) => h.status)).toEqual(["researching", "planning"]);
    expect(v.clients[0].slug).toBe("me");
  });
  it("folder names", () => {
    expect(grantFolderName({ deadline: "2027-02-01", funder: "pittsburgh-foundation", title: "Project Grant" })).toBe("2027-02-pittsburgh-foundation-project-grant");
    expect(grantFolderName({ funder: "x", title: "Y" })).toBe("rolling-x-y");
  });
  it("parses questions", () => {
    const qs = parseQuestions("## Questions\n### 1. Project description (500 words)\nDraft: drafts/01-project-description.md\n### 2. Short answer (1,000 characters)\n## Notes\n### Not a question");
    expect(qs).toEqual([
      { number: "1", title: "Project description", limit: 500, limitUnit: "words", draft: "drafts/01-project-description.md" },
      { number: "2", title: "Short answer", limit: 1000, limitUnit: "characters", draft: null },
    ]);
    const body = addQuestionToBody("## Eligibility\n\n## Questions\n### 1. A\nDraft: drafts/01-a.md\n\n## Notes\nx\n", { title: "2. B", limit: 100, unit: "words", draft: "drafts/02-b.md" });
    expect(parseQuestions(body).map((q) => q.title)).toEqual(["A", "B"]);
    expect(body).toContain("## Notes\nx");
  });
  it("loads the sample vault and computes attention", async () => {
    const today = new Date(2026, 10, 22);
    const fs = new MemoryFS(sampleVault(today).files, false);
    const v = await loadVault(fs);
    expect(v.grants.length).toBe(13);
    const att = needsAttention(v.grants, today);
    expect(att.some((a) => a.kind === "due")).toBe(true);
    expect(att.some((a) => a.kind === "noreports")).toBe(true);
    expect(att.some((a) => a.kind === "decision")).toBe(true);
    expect(att.some((a) => a.kind === "report")).toBe(true);
    const n = dashboardNumbers(v.grants, today);
    expect(n.active).toBeGreaterThan(0);
    expect(toICS(calendarEvents(v.grants))).toContain("BEGIN:VEVENT");
    const s = suggestFor("Artist bio", v.library, "me");
    expect(s[0].item.path.startsWith("me/")).toBe(true);
    expect(suggestFor("Mission and history", v.library, "me").every((x) => !x.item.path.startsWith("lakeside"))).toBe(true);
  });
});

describe("csv import", () => {
  it("maps, previews, imports and undoes", async () => {
    const fs = new MemoryFS({}, false);
    const csv = readCsv("﻿Grant Name;Organization;Due Date;Amount;Stage;Tags;Link\nProject Grant;Pittsburgh Foundation;February 1, 2027;$5,000;Won;theater; individual\nNo date;Foo;someday;;Rejected;;\n;Bar;2027-01-01;;;;\n");
    expect(csv.delimiter).toBe(";");
    const m = autoMapping(csv);
    expect(m.columns).toMatchObject({ "Grant Name": "title", Organization: "funder", "Due Date": "deadline", Amount: "amount_requested", Stage: "status", Link: "url" });
    expect(m.statuses).toMatchObject({ Won: "awarded", Rejected: "declined", "": "researching" });
    const prev = buildPreview(csv, m, []);
    expect(prev[0].fm).toMatchObject({ title: "Project Grant", deadline: "2027-02-01", amount_requested: 5000, status: "awarded" });
    expect(prev[1].warnings[0]).toMatch(/Can't read deadline/);
    expect(prev[2].error).toBe("Missing title");
    const log = await runImport(fs, prev, m, "x.csv");
    expect(log.created).toHaveLength(2);
    expect(log.skipped).toHaveLength(1);
    let v = await loadVault(fs);
    expect(v.grants).toHaveLength(2);
    expect(v.funders.map((f) => f.fm.name)).toContain("Pittsburgh Foundation");
    // duplicates
    const prev2 = buildPreview(csv, m, v.grants);
    expect(prev2[0].duplicateOf).toBeTruthy();
    await undoImport(fs, log);
    v = await loadVault(fs);
    expect(v.grants).toHaveLength(0);
    expect(v.funders).toHaveLength(0);
  });
  it("guesses statuses", () => {
    expect(guessStatus("Sent")).toBe("submitted");
    expect(guessStatus("In progress")).toBe("drafting");
    expect(guessStatus("No")).toBe("declined");
  });
});

import JSZip from "jszip";
import { createSample, duplicateSample, kindForFile, kindForUrl, normalizeSample, sampleCaption, samplesForClient } from "../src/lib/samples";
import { buildReviewDocx, draftParagraphs, reviewDocumentXml } from "../src/lib/reviewExport";

describe("work samples", () => {
  it("works out the kind from a file name or link", () => {
    expect(kindForFile("Still 03.JPG")).toBe("image");
    expect(kindForFile("reel.mov")).toBe("video");
    expect(kindForFile("quartet.flac")).toBe("audio");
    expect(kindForFile("pages.pdf")).toBe("document");
    expect(kindForUrl("https://vimeo.com/123")).toBe("video");
    expect(kindForUrl("https://artist.bandcamp.com/track/x")).toBe("audio");
    expect(kindForUrl("https://example.org")).toBe("link");
    expect(normalizeSample({ file: "a.mp3" }, "me/a.md", "").fm.kind).toBe("audio");
    expect(normalizeSample({ kind: "image", file: "a.mp3" }, "me/a.md", "").fm.kind).toBe("image");
  });

  it("writes a caption for an application's sample list", () => {
    const s = normalizeSample({ title: "River Suite", year: 2024, medium: "Oil on linen", dimensions: "24 x 36 in." }, "me/river.md", "");
    expect(sampleCaption(s)).toBe("River Suite (2024). Oil on linen, 24 x 36 in.");
    expect(sampleCaption(normalizeSample({ title: "Reel" }, "me/reel.md", ""))).toBe("Reel.");
  });

  it("copies the file into the vault, loads it back, and keeps clients apart", async () => {
    const fs = new MemoryFS(sampleVault().files, false);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const s = await createSample(fs, "me", { title: "Still 03", file: { name: "IMG_0003.JPG", copyTo: (dest) => fs.writeBytes(dest, bytes) } });
    expect(s.path).toBe("me/still-03.md");
    expect(s.fm.file).toBe("still-03.jpg");
    expect(s.fm.kind).toBe("image");
    expect(Array.from(await fs.readBytes("samples/me/still-03.jpg"))).toEqual([1, 2, 3, 4]);
    // A second sample with the same title gets its own names.
    const s2 = await createSample(fs, "me", { title: "Still 03", file: { name: "other.png", copyTo: (dest) => fs.writeBytes(dest, bytes) } });
    expect(s2.path).toBe("me/still-03-2.md");

    const copy = await duplicateSample(fs, s, "lakeside-youth-theater");
    expect(copy.path).toBe("lakeside-youth-theater/still-03.md");
    expect(await fs.exists("samples/lakeside-youth-theater/still-03.jpg")).toBe(true);

    const data = await loadVault(fs);
    expect(data.samples.find((x) => x.path === "me/still-03.md")?.fm.file).toBe("still-03.jpg");
    const forMe = samplesForClient(data.samples, "me").map((x) => x.path);
    expect(forMe).toContain("me/still-03.md");
    expect(forMe.some((p) => p.startsWith("lakeside-youth-theater/"))).toBe(false);
  });

  it("keeps used_in pointing at the grant when its folder is renamed", async () => {
    const fs = new MemoryFS(sampleVault().files, false);
    const data = await loadVault(fs);
    const g = data.grants.find((x) => x.fm.work_samples.length > 0)!;
    expect(g.fm.work_samples).toContain("me/prodigy-reading-excerpt.md");
    const sample = data.samples.find((x) => x.path === "me/prodigy-reading-excerpt.md")!;
    expect(sample.fm.used_in).toContain(g.folder);
    const moved = await saveGrant(fs, { ...g, fm: { ...g.fm, deadline: "2031-05-01" } });
    expect(moved.folder).not.toBe(g.folder);
    const after = (await loadVault(fs)).samples.find((x) => x.path === sample.path)!;
    expect(after.fm.used_in).toContain(moved.folder);
    expect(after.fm.used_in).not.toContain(g.folder);
  });
});

describe("client review export", () => {
  const grant = (body = "") => ({
    folder: "2027-02-pittsburgh-foundation-project-grant",
    fm: normalizeGrantForTest({ title: "Project Grant & Friends", funder: "pittsburgh-foundation", amount_requested: 5000, deadline: "2027-02-01" }),
    body,
    lastEdited: 0,
  });

  it("turns drafts into Word paragraphs, lists and inline styles", () => {
    const xml = draftParagraphs("First **bold** and *soft*.\nSame paragraph.\n\n- one\n- two\n\n## A heading");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("<w:br/>");
    expect((xml.match(/ListParagraph/g) ?? []).length).toBe(2);
    expect(xml).toContain(">A heading<");
  });

  it("includes every question with its limit, and escapes text", async () => {
    const xml = reviewDocumentXml({
      grant: grant(),
      clientName: "Me",
      funderName: "The Pittsburgh Foundation",
      questions: [
        { number: "1", title: "Project description", limit: 3, limitUnit: "words", draft: "drafts/01.md", text: "# Project description\n\nRock < roll & four words" },
        { number: "2", title: "Bio", limit: 150, limitUnit: "words", draft: null, text: "" },
      ],
      samples: [normalizeSample({ title: "Reel", year: "2025", url: "https://vimeo.com/1" }, "me/reel.md", "Two minutes.")],
      budget: { expenses: 6000, income: 1000, inKind: 0, gap: 5000 } as never,
      today: new Date(2026, 10, 22),
    });
    expect(xml).toContain("Project Grant &amp; Friends");
    expect(xml).toContain("Rock &lt; roll &amp; four words");
    expect(xml).toContain("over the limit");
    expect(xml.match(/>1\. Project description</g)?.length).toBe(1);
    expect(xml).not.toContain(">Project description<");
    expect(xml).toContain("No draft yet.");
    expect(xml).toContain("Reel (2025).");
    expect(xml).toContain("Budget summary");
    expect(xml).not.toMatch(/[\u0000-\u0008]/);

    const zip = await JSZip.loadAsync(
      await buildReviewDocx({ grant: grant(), clientName: "Me", funderName: "", questions: [], samples: [], budget: null }),
    );
    for (const f of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels", "docProps/core.xml"])
      expect(zip.file(f), f).not.toBeNull();
  });
});

describe("adding a file to a link-only sample", () => {
  it("uploads, then replaces, sending the old file to trash", async () => {
    const { setSampleFile } = await import("../src/lib/samples");
    const { trash } = await import("../src/lib/vault");
    const fs = new MemoryFS(sampleVault().files, false);
    const s = (await loadVault(fs)).samples.find((x) => x.path === "me/made-men-podcast.md")!;
    expect(s.fm.file).toBe("");
    const up = await setSampleFile(fs, s, { name: "pilot.mp3", copyTo: (d) => fs.writeBytes(d, new Uint8Array([1])) }, (p) => trash(fs, p));
    expect(up.fm.file).toBe("made-men-podcast.mp3");
    expect(up.fm.url).toBe(s.fm.url); // the link stays
    const re = await setSampleFile(fs, up, { name: "pilot.wav", copyTo: (d) => fs.writeBytes(d, new Uint8Array([2])) }, (p) => trash(fs, p));
    expect(re.fm.file).toBe("made-men-podcast.wav");
    expect(await fs.exists("samples/me/made-men-podcast.mp3")).toBe(false);
    expect((await fs.list(".manyapply/trash")).some((e) => e.path.endsWith("made-men-podcast.mp3"))).toBe(true);
  });
});

describe("documents", () => {
  it("guesses the type, tracks expiry and loads from the vault", async () => {
    const { createDocument, expiryState, guessDocType } = await import("../src/lib/documents");
    expect(guessDocType("W9 2026 signed.pdf")).toBe("W-9");
    expect(guessDocType("COI Lakeside.pdf")).toBe("Insurance certificate");
    expect(guessDocType("IRS determination letter.pdf")).toBe("501(c)(3) letter");
    const fs = new MemoryFS(sampleVault().files, false);
    const d = await createDocument(fs, "me", { title: "W9 2026", file: { name: "W9 2026.pdf", copyTo: (p) => fs.writeBytes(p, new Uint8Array([1])) } });
    expect(d.fm.type).toBe("W-9");
    expect(await fs.exists("documents/me/w9-2026.pdf")).toBe(true);
    const data = await loadVault(fs);
    expect(data.documents.some((x) => x.path === "me/w9-2026.md")).toBe(true);
    const states = Object.fromEntries(data.documents.map((x) => [x.path, expiryState(x)]));
    expect(states["me/w-9.md"]).toBe("soon");
    expect(states["lakeside-youth-theater/certificate-of-insurance.md"]).toBe("expired");
    expect(states["me/fiscal-sponsor-agreement.md"]).toBe("none");
  });

  it("is never included in Share client folder", async () => {
    const { zipClient } = await import("../src/lib/backup");
    const fs = new MemoryFS(sampleVault().files, false);
    const zip = await JSZip.loadAsync(await zipClient(fs, "lakeside-youth-theater", []));
    expect(Object.keys(zip.files).some((p) => p.startsWith("documents/"))).toBe(false);
  });
});

describe("feeds", () => {
  it("parses RSS with CDATA, entities and categories", async () => {
    const { parseFeed, matchesFilter, itemToGrant } = await import("../src/lib/feeds");
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>NYC Playwrights</title>
      <item><title>Call for Plays &amp; Monologues</title><link>https://example.org/a</link><guid isPermaLink="false">tag:1</guid>
      <pubDate>Mon, 02 Nov 2026 10:00:00 +0000</pubDate><category>Theater</category>
      <description><![CDATA[<p>Deadline: December 15, 2026. Prize of $1,000.</p><p>No fee.</p>]]></description></item>
      <item><title>Broadband</title><link>https://example.org/b</link><category><![CDATA[Infrastructure]]></category></item>
    </channel></rss>`;
    const { title, items } = parseFeed(xml, "x");
    expect(title).toBe("NYC Playwrights");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "tag:1", title: "Call for Plays & Monologues", link: "https://example.org/a", categories: ["Theater"] });
    expect(items[0].date).toBe("2026-11-02T10:00:00.000Z");
    expect(items[0].summary).toBe("Deadline: December 15, 2026. Prize of $1,000.\nNo fee.");
    expect(matchesFilter(items[0], "arts, theater")).toBe(true);
    expect(matchesFilter(items[1], "arts, theater")).toBe(false);
    expect(matchesFilter(items[1], "")).toBe(true);
    // "art" must not match "start"
    expect(matchesFilter({ ...items[1], title: "Start-up grants" }, "art")).toBe(false);
    const g = itemToGrant(items[0], "NYC Playwrights");
    expect(g.url).toBe("https://example.org/a");
    expect(g.max_award).toBe(1000);
    expect(g.eligibility).toContain("From NYC Playwrights.");
  });

  it("parses Atom and keeps the alternate link", async () => {
    const { parseFeed } = await import("../src/lib/feeds");
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Blog</title>
      <entry><id>urn:1</id><title type="html">Residency &lt;b&gt;open&lt;/b&gt;</title>
      <link rel="replies" href="https://example.org/1#comments"/><link rel="alternate" type="text/html" href="https://example.org/1"/>
      <published>2026-10-01T00:00:00Z</published><summary>Four weeks.</summary></entry></feed>`;
    const { items } = parseFeed(xml, "b");
    expect(items[0]).toMatchObject({ id: "urn:1", title: "Residency open", link: "https://example.org/1", summary: "Four weeks." });
    expect(parseFeed("<html>not a feed</html>", "z").items).toEqual([]);
  });

  it("gives old settings the default feeds and keeps the user's choices", async () => {
    const { mergeFeeds, DEFAULT_FEEDS } = await import("../src/lib/feeds");
    expect(mergeFeeds(undefined).map((f) => f.id)).toEqual(DEFAULT_FEEDS.map((f) => f.id));
    const mine = mergeFeeds([{ id: "artdeadline", name: "AD", url: "https://x/feed", enabled: false, match: "" }, { id: "own", name: "Mine", url: "https://y/rss", enabled: true, match: "" }]);
    expect(mine.find((f) => f.id === "artdeadline")?.enabled).toBe(false);
    expect(mine.map((f) => f.id)).toEqual(["artdeadline", "own", "nycplaywrights"]);
  });

  it("drops the retired Grants.gov feed from saved settings", async () => {
    const { mergeFeeds } = await import("../src/lib/feeds");
    const saved = [{ id: "grants-gov", name: "Grants.gov", url: "https://www.grants.gov/rss/GG_NewOppByCategory.xml", enabled: true, match: "arts", builtin: true }];
    expect(mergeFeeds(saved).map((f) => f.id)).not.toContain("grants-gov");
  });
});

describe("displayText", () => {
  it("stops the app font drawing (c) as ©, without changing visible text", async () => {
    const { displayText } = await import("../src/lib/util");
    expect(displayText("501(c)(3) letter")).toBe("501(‌c)(3) letter");
    expect(displayText("501(c)(3) letter").replace(/‌/g, "")).toBe("501(c)(3) letter");
  });
});

describe("donor CSV import", () => {
  const csv = `First Name,Last Name,Email,Amount,Date,Payment Method,City,State
Jamie,Rivera,jamie@example.org,"$1,000.00",3/4/2026,check,Pittsburgh,PA
Jamie,Rivera,JAMIE@example.org,50,2026-06-01,card,,
Sam,Lee,,25,Feb 1 2026,PayPal,,
,,,10,2026-01-01,,,
Pat,Kim,pat@example.org,,,,,`;

  it("guesses columns, merges rows for the same person and logs gifts", async () => {
    const { autoDonorMapping, planDonorImport, donorDatesAmbiguous } = await import("../src/lib/donorImport");
    const { headers, rows } = readCsv(csv);
    const mapping = autoDonorMapping(headers);
    expect(mapping).toMatchObject({ "First Name": "first_name", Email: "email", Amount: "gift_amount", Date: "gift_date", City: "address", State: "address" });
    expect(donorDatesAmbiguous(rows, mapping)).toBe(true);
    const plan = planDonorImport([], rows, { mapping, dateOrder: "us" });
    expect(plan.created).toBe(3);
    expect(plan.gifts).toBe(3);
    expect(plan.giftTotal).toBe(1075);
    expect(plan.skippedRows).toBe(1);
    const jamie = plan.entries.find((e) => e.donor.fm.email === "jamie@example.org")!.donor;
    expect(jamie.fm.name).toBe("Jamie Rivera");
    expect(jamie.fm.address).toBe("Pittsburgh, PA");
    expect(jamie.fm.gifts.map((g) => g.date)).toEqual(["2026-06-01", "2026-03-04"]);
    expect(jamie.fm.stage).toBe("active");
    expect(plan.entries.find((e) => e.donor.fm.name === "Pat Kim")!.donor.fm.stage).toBe("prospect");
  });

  it("matches existing donors, keeps their details and skips gifts already logged", async () => {
    const { autoDonorMapping, planDonorImport, applyDonorImport, undoDonorImport } = await import("../src/lib/donorImport");
    const { createDonor, readDonor, writeDonor } = await import("../src/lib/donors");
    const fs = new MemoryFS();
    const slug = await createDonor(fs, "Jamie R.");
    const d = await readDonor(fs, `donors/${slug}.md`);
    d.fm.email = "jamie@example.org";
    d.fm.address = "1 Main St";
    d.fm.gifts = [{ date: "2026-03-04", amount: 1000, method: "check", note: "", acknowledged: true }];
    await writeDonor(fs, d);
    const before = await fs.readText(`donors/${slug}.md`);
    const { headers, rows } = readCsv(csv);
    const plan = planDonorImport([d], rows, { mapping: autoDonorMapping(headers), dateOrder: "us" });
    expect(plan.updated).toBe(1);
    expect(plan.created).toBe(2);
    expect(plan.duplicateGifts).toBe(1);
    const r = await applyDonorImport(fs, plan);
    const after = await readDonor(fs, `donors/${slug}.md`);
    expect(after.fm.name).toBe("Jamie R.");
    expect(after.fm.address).toBe("1 Main St");
    expect(after.fm.gifts).toHaveLength(2);
    await undoDonorImport(fs, r);
    expect(await fs.readText(`donors/${slug}.md`)).toBe(before);
    expect(await fs.exists("donors/sam-lee.md")).toBe(false);
  });
});

describe("moveDocument", () => {
  it("moves a document and its file to another client's folder", async () => {
    const { createDocument, moveDocument, documentFilePath } = await import("../src/lib/documents");
    const fs = new MemoryFS();
    const d = await createDocument(fs, "me", { title: "W-9 2026", file: { name: "w9.pdf", copyTo: (p) => fs.writeBytes(p, new Uint8Array([1])) } });
    await createDocument(fs, "lakeside", { title: "W-9 2026" });
    const moved = await moveDocument(fs, d, "lakeside");
    expect(moved.path).toBe("lakeside/w-9-2026-2.md");
    expect(moved.fm.file).toBe("w-9-2026-2.pdf");
    expect(await fs.exists(documentFilePath(moved))).toBe(true);
    expect(await fs.exists("documents/me/w-9-2026.md")).toBe(false);
    expect(await fs.exists("documents/me/w-9-2026.pdf")).toBe(false);
  });
});

describe("moving Library items keeps applications linked", () => {
  it("updates library_items, work_samples and documents on grants", async () => {
    const { createLibraryItem, moveLibraryItem, loadVault } = await import("../src/lib/vault");
    const { createSample, moveSample } = await import("../src/lib/samples");
    const { createDocument, moveDocument } = await import("../src/lib/documents");
    const fs = new MemoryFS();
    await fs.writeText("clients/me.md", "---\nname: Me\n---\n");
    const item = await createLibraryItem(fs, "me", "Bio");
    const sample = await createSample(fs, "me", { title: "Clip", file: { name: "clip.mp4", copyTo: (p) => fs.writeBytes(p, new Uint8Array([1])) } });
    const doc = await createDocument(fs, "me", { title: "W-9" });
    const g = await createGrant(fs, { title: "X", funder: "f", deadline: "2027-01-01", library_items: [item.path], work_samples: [sample.path], documents: [doc.path] } as never);
    const newItem = await moveLibraryItem(fs, item.path, "shared");
    const newSample = await moveSample(fs, sample, "shared");
    const newDoc = await moveDocument(fs, doc, "lakeside");
    const data = await loadVault(fs);
    const after = data.grants.find((x) => x.folder === g.folder)!;
    expect(after.fm.library_items).toEqual([newItem]);
    expect(after.fm.work_samples).toEqual([newSample.path]);
    expect(after.fm.documents).toEqual([newDoc.path]);
    expect(await fs.exists("samples/shared/clip.mp4")).toBe(true);
  });
});

describe("CV builder", () => {
  it("round-trips the cv file and reads hand-typed lines", async () => {
    const { parseCv, stringifyCv } = await import("../src/lib/cv");
    const text = `---\nname: Jamie Rivera\nemail: j@example.org\n---\n\n## Education\n- 2015 | MFA, Carnegie Mellon\n- 2010–2012 BA, Oberlin\n\n## Press\nReview in the Post-Gazette\n`;
    const cv = parseCv(text, "me", "Me");
    expect(cv.name).toBe("Jamie Rivera");
    expect(cv.sections[0].entries).toEqual([{ year: "2015", text: "MFA, Carnegie Mellon" }, { year: "2010–2012", text: "BA, Oberlin" }]);
    expect(cv.sections[1].entries).toEqual([{ year: "", text: "Review in the Post-Gazette" }]);
    expect(parseCv(stringifyCv(cv), "me", "Me")).toEqual(cv);
  });

  it("suggests awarded grants and work samples not yet on the CV, and builds a docx", async () => {
    const { blankCv, cvSuggestions, applySuggestions, buildCvDocx, cvText } = await import("../src/lib/cv");
    const fs = new MemoryFS();
    await fs.writeText("clients/me.md", "---\nname: Me\n---\n");
    await createGrant(fs, { title: "Project Grant", funder: "pittsburgh-foundation", deadline: "2026-03-01", status: "awarded", amount_awarded: 5000, decision_on: "2026-05-01" } as never);
    await createGrant(fs, { title: "Hambidge Residency", funder: "hambidge", deadline: "2025-09-01", status: "awarded", type: "residency" } as never);
    await createGrant(fs, { title: "Lost one", funder: "x", deadline: "2026-01-01", status: "declined" } as never);
    const { loadVault } = await import("../src/lib/vault");
    const data = await loadVault(fs);
    const cv = blankCv("me", "Jamie");
    cv.sections[0].entries.push({ year: "2024", text: "Project Grant, Pittsburgh Foundation" });
    const name = (s: string) => (s === "pittsburgh-foundation" ? "Pittsburgh Foundation" : "Hambidge Center");
    const sugs = cvSuggestions(cv, data.grants, [], name, { amounts: true });
    expect(sugs).toEqual([{ section: "Residencies and fellowships", entry: { year: "2025", text: "Hambidge Residency, Hambidge Center" } }]);
    const next = applySuggestions(cv, sugs);
    expect(cvText(next)).toContain("2025  Hambidge Residency, Hambidge Center");
    const bytes = await buildCvDocx(next);
    const JSZip = (await import("jszip")).default;
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(xml).toContain("Hambidge Residency");
    expect(xml).not.toContain("Selected works");
  });
});
