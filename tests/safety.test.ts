import { describe, expect, it } from "vitest";
import { MemoryFS } from "../src/lib/fs/memory";
import { isSafeRelPath, isSafeSegment, safeDraftPath, safeFileName } from "../src/lib/fs/types";
import {
  createLibraryItem,
  loadVault,
  moveLibraryItem,
  normalizeGrant,
  parseQuestions,
  readDraft,
  trash,
} from "../src/lib/vault";
import { normalizeSample, samplePaths } from "../src/lib/samples";
import { documentPaths, normalizeDocument } from "../src/lib/documents";
import { moveWithFile } from "../src/lib/move";
import { zipClient } from "../src/lib/backup";
import { calendarEvents, needsAttention, toICS } from "../src/lib/stats";
import type { Grant } from "../src/lib/model";

const fs = () => new MemoryFS({}, false);

describe("vault paths stay inside their folders", () => {
  it("recognises safe segments and relative paths", () => {
    expect(isSafeSegment("me")).toBe(true);
    expect(isSafeSegment("Lakeside_Youth")).toBe(true);
    expect(isSafeSegment("..")).toBe(false);
    expect(isSafeSegment(".")).toBe(false);
    expect(isSafeSegment("")).toBe(false);
    expect(isSafeSegment("a/b")).toBe(false);
    expect(isSafeRelPath("me/river-suite.md")).toBe(true);
    expect(isSafeRelPath("../clients/other.md")).toBe(false);
    expect(isSafeRelPath("a//b")).toBe(false);
    expect(isSafeRelPath("/etc/passwd")).toBe(false);
    expect(isSafeRelPath("C:/x")).toBe(false);
    expect(safeFileName("../../clients/other.md")).toBe("");
    expect(safeFileName("x.jpg")).toBe("x.jpg");
    expect(safeDraftPath("drafts/01-project.md")).toBe("drafts/01-project.md");
    expect(safeDraftPath("drafts/../clients/other.md")).toBe("");
    expect(safeDraftPath("other/01-project.md")).toBe("");
  });

  it("drops client/funder/donor files whose names would escape the folder", async () => {
    const vault = new MemoryFS(
      {
        "clients/...md": "---\nname: Weird\n---\n",
        "clients/other.md": "---\nname: Other\n---\n",
      },
      false,
    );
    const data = await loadVault(vault);
    expect(data.clients.map((c) => c.slug)).toEqual(["me", "other"]);
    expect(data.libraryFolders).not.toContain("..");
  });

  it("refuses a client slug of .. in Share client folder", async () => {
    await expect(zipClient(fs(), "..", [])).rejects.toThrow(/client/i);
  });

  it("refuses to trash a path outside the vault", async () => {
    await expect(trash(fs(), "../clients/other.md")).rejects.toThrow(/unsafe/i);
  });

  it("refuses to move a sample into an unsafe owner", async () => {
    await expect(moveWithFile(fs(), "samples", "me/x.md", "x.jpg", "..")).rejects.toThrow(/unsafe/i);
  });

  it("refuses library writes and moves outside library/", async () => {
    await expect(createLibraryItem(fs(), "..", "T")).rejects.toThrow(/library/i);
    await expect(moveLibraryItem(fs(), "me/x.md", "..")).rejects.toThrow(/library/i);
  });

  it("ignores a media file name that points at another folder", () => {
    const sample = normalizeSample({ title: "X", file: "../../clients/other.md" }, "me/x.md", "");
    expect(sample.fm.file).toBe("");
    expect(samplePaths(sample)).toEqual(["samples/me/x.md"]);

    const doc = normalizeDocument({ title: "W-9", file: "../other.pdf" }, "me/w9.md", "");
    expect(doc.fm.file).toBe("");
    expect(documentPaths(doc)).toEqual(["documents/me/w9.md"]);
  });

  it("only opens drafts under drafts/", async () => {
    const vault = new MemoryFS({ "clients/other.md": "secret", "grants/x/drafts/a.md": "hello" }, false);
    expect(await readDraft(vault, "x", "drafts/a.md")).toBe("hello");
    expect(await readDraft(vault, "x", "../../clients/other.md")).toBe("");
  });

  it("drops unsafe Draft: links from question lists", () => {
    const qs = parseQuestions(
      "## Questions\n### 1. A\nDraft: drafts/a.md\n### 2. B\nDraft: ../../clients/other.md\n### 3. C\nDraft: [x](../../clients/other.md)\n",
    );
    expect(qs.map((q) => q.draft)).toEqual(["drafts/a.md", null, null]);
  });
});

describe("dates that can't be parsed don't break the app", () => {
  it("normalises grant dates and drops invalid ones", () => {
    const fm = normalizeGrant(
      {
        title: "T",
        deadline: "TBD",
        submitted_on: 2027,
        decision_expected: "soon",
        decision_on: "2026-13-45",
        created: "nope",
        updated: "2026-01-02T03:04:05",
        reports: [{ title: "R", due: "later", submitted_on: "2026-02-30" }],
        status_history: [{ status: "submitted", date: "x" }],
      },
      "2026-01-t",
    );
    expect(fm.deadline).toBe("");
    expect(fm.submitted_on).toBe("");
    expect(fm.decision_expected).toBe("");
    expect(fm.decision_on).toBe("");
    expect(fm.updated).toBe("2026-01-02");
    expect(fm.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fm.reports[0].due).toBe("");
    expect(fm.reports[0].submitted_on).toBeNull();
    expect(fm.status_history).toEqual([{ status: "researching", date: fm.created }]);
  });

  it("keeps valid ISO dates", () => {
    const fm = normalizeGrant({ title: "T", deadline: "2026-01-05", submitted_on: "2025-12-01" }, "x");
    expect(fm.deadline).toBe("2026-01-05");
    expect(fm.submitted_on).toBe("2025-12-01");
  });

  it("doesn't throw in needsAttention on unvalidated dates", () => {
    const fm = normalizeGrant({ title: "T" }, "x");
    const grant = { folder: "x", fm: { ...fm, deadline: "TBD", decision_expected: "TBD", status: "submitted" }, body: "", lastEdited: 0 } as Grant;
    expect(() => needsAttention([grant], new Date("2026-11-23"))).not.toThrow();
  });

  it("skips invalid dates and escapes URLs in the calendar", () => {
    const fm = normalizeGrant(
      { title: "T", deadline: "2026-01-05", url: "https://x.test/\r\nATTENDEE:mailto:evil@example.com" },
      "2026-01-x",
    );
    const grant = { folder: "2026-01-x", fm, body: "", lastEdited: 0 } as Grant;
    const ics = toICS(calendarEvents([grant]));
    expect(ics).toContain("DTSTART;VALUE=DATE:20260105");
    expect(ics).toContain("URL:https://x.test/\\nATTENDEE:mailto:evil@example.com");
    expect(ics.split("\r\n").some((line) => line.startsWith("ATTENDEE:"))).toBe(false);

    const bad = { ...grant, fm: { ...fm, deadline: "TBD" } } as Grant;
    expect(toICS(calendarEvents([bad]))).not.toContain("BEGIN:VEVENT");
  });
});
