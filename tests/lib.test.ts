import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../src/lib/frontmatter";
import { findAmounts, findDates, parseDate } from "../src/lib/extract";
import { budgetTotals, parseBudgetCsv, stringifyBudgetCsv } from "../src/lib/budget";
import { MemoryFS } from "../src/lib/fs/memory";
import { createGrant, grantFolderName, loadVault, parseQuestions, saveGrant, withStatus, addQuestionToBody } from "../src/lib/vault";
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
