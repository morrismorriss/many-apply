import { describe, expect, it, vi } from "vitest";
import { MemoryFS } from "../src/lib/fs/memory";
import { DEFAULT_SETTINGS } from "../src/lib/model";
import { loadSettings, saveSettings } from "../src/lib/vault";
import { listImports, undoImport, type ImportLog } from "../src/lib/csvImport";
import { autoDonorMapping, planDonorImport } from "../src/lib/donorImport";
import { normalizeDonor } from "../src/lib/donors";
import { useStore } from "../src/store";
import * as todoist from "../src/lib/todoist";

vi.mock("../src/lib/todoist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/todoist")>();
  return { ...actual, getToken: vi.fn(), tasksForPlanning: vi.fn() };
});

describe("grant import history", () => {
  it("ignores donor-import logs, which have a different shape", async () => {
    const fs = new MemoryFS(
      {
        ".manyapply/imports/grants-1.json": JSON.stringify({
          id: "1",
          file: "grants.csv",
          date: "2026-01-01",
          created: [],
          createdFunders: [],
          createdClients: [],
          merged: [],
          skipped: [],
        }),
        ".manyapply/imports/donors-2.json": JSON.stringify({
          id: "2",
          created: [],
          originals: {},
          createdCount: 0,
          updatedCount: 0,
          gifts: 0,
          undone: false,
        }),
      },
      false,
    );
    expect((await listImports(fs)).map((l) => l.id)).toEqual(["1"]);
  });

  it("undoes an old grant log that lacks the newer fields", async () => {
    const fs = new MemoryFS({ ".manyapply/imports/old.json": "{}" }, false);
    const log = { id: "old", file: "x.csv", date: "2026-01-01", created: [], merged: [] } as unknown as ImportLog;
    await expect(undoImport(fs, log)).resolves.toBeUndefined();
  });
});

describe("settings secrets", () => {
  it("keeps the pairing code out of settings.json", async () => {
    const fs = new MemoryFS({}, false);
    await saveSettings(fs, { ...DEFAULT_SETTINGS, pairingCode: "123456", pairingEnabled: false });
    const raw = JSON.parse(await fs.readText(".manyapply/settings.json"));
    expect(raw.pairingCode).toBeUndefined();
    expect(raw.pairingEnabled).toBe(false);
  });

  it("defaults extension access on and respects an explicit off", async () => {
    const on = await loadSettings(new MemoryFS({ ".manyapply/settings.json": "{}" }, false));
    expect(on.pairingEnabled).toBe(true);
    const off = await loadSettings(
      new MemoryFS({ ".manyapply/settings.json": JSON.stringify({ pairingEnabled: false }) }, false),
    );
    expect(off.pairingEnabled).toBe(false);
  });

  it("reads a legacy pairing code when no keychain is available", async () => {
    const fs = new MemoryFS({ ".manyapply/settings.json": JSON.stringify({ pairingCode: "123456" }) }, false);
    expect((await loadSettings(fs)).pairingCode).toBe("123456");
  });
});

describe("donor import duplicates", () => {
  const existing = () =>
    normalizeDonor(
      "jamie",
      {
        name: "Jamie Rivera",
        email: "jamie@example.org",
        gave_to: ["me"],
        gifts: [{ date: "2026-06-01", amount: 50, method: "check", note: "", acknowledged: false }],
      },
      "",
    );
  const headers = ["Name", "Email", "Amount", "Date", "Gave to"];
  const plan = (gaveTo: string) =>
    planDonorImport(
      [existing()],
      [{ Name: "Jamie Rivera", Email: "jamie@example.org", Amount: "50", Date: "2026-06-01", "Gave to": gaveTo }],
      {
        mapping: autoDonorMapping(headers),
        dateOrder: "us",
        client: "me",
        clients: [
          { slug: "me", name: "Me" },
          { slug: "lakeside", name: "Lakeside" },
        ],
      },
    );

  it("skips the same gift to the same client", () => {
    expect(plan("Me").duplicateGifts).toBe(1);
    expect(plan("Me").gifts).toBe(0);
  });

  it("keeps the same amount on the same day for a different client", () => {
    const p = plan("Lakeside");
    expect(p.duplicateGifts).toBe(0);
    expect(p.gifts).toBe(1);
  });

  it("keeps existing touchpoints when an import adds a gift", async () => {
    const { applyDonorImport } = await import("../src/lib/donorImport");
    const { readDonor, writeDonor } = await import("../src/lib/donors");
    const fs = new MemoryFS();
    const d = normalizeDonor(
      "jamie",
      {
        name: "Jamie Rivera",
        email: "jamie@example.org",
        gave_to: ["me"],
        touches: [{ date: "2026-05-01", kind: "call", note: "Talked" }],
      },
      "",
    );
    await writeDonor(fs, d);
    const p = planDonorImport(
      [d],
      [{ Name: "Jamie Rivera", Email: "jamie@example.org", Amount: "25", Date: "2026-06-02", "Gave to": "Me" }],
      { mapping: autoDonorMapping(headers), dateOrder: "us", client: "me" },
    );
    expect(p.gifts).toBe(1);
    await applyDonorImport(fs, p);
    const after = await readDonor(fs, "donors/jamie.md");
    expect(after.fm.touches).toEqual([{ date: "2026-05-01", kind: "call", note: "Talked" }]);
    expect(after.fm.gifts.map((g) => g.amount)).toContain(25);
  });
});

describe("planning tasks", () => {
  it("creates Todoist tasks when a grant is created already in planning", async () => {
    await useStore.getState().openDemo(true);
    await useStore.getState().updateSettings((s) => ({
      ...s,
      todoist: { ...s.todoist, enabled: true, projectPerClient: false, defaultProjectId: "p" },
    }));
    vi.mocked(todoist.getToken).mockResolvedValue("token");
    vi.mocked(todoist.tasksForPlanning).mockResolvedValue(["task-1"]);

    const g = await useStore.getState().addGrant(
      { title: "Planning from the start", status: "planning", client: "me", deadline: "2026-12-01" },
      "",
    );
    const after = useStore.getState().data!.grants.find((x) => x.folder === g.folder)!;
    expect(after.fm.todoist_task_ids).toContain("task-1");
    expect(todoist.tasksForPlanning).toHaveBeenCalled();
    vi.clearAllMocks();
  });
});
