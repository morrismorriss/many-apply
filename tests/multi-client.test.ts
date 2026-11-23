import { describe, expect, it } from "vitest";
import { MemoryFS } from "../src/lib/fs/memory";
import { createGrant, loadVault, normalizeGrant, saveGrant } from "../src/lib/vault";
import { clientsOf, isFor } from "../src/lib/model";
import { filterForReports } from "../src/lib/stats";

describe("grants for several clients", () => {
  it("reads older files with only a client", () => {
    const fm = normalizeGrant({ title: "A", client: "lakeside" }, "x");
    expect(fm.client).toBe("lakeside");
    expect(clientsOf(fm)).toEqual(["lakeside"]);
  });

  it("keeps the main client first and drops duplicates", () => {
    const fm = normalizeGrant({ title: "A", client: "me", clients: ["lakeside", "me", "lakeside"] }, "x");
    expect(fm.clients).toEqual(["me", "lakeside"]);
    expect(isFor(fm, "lakeside")).toBe(true);
    expect(isFor(fm, "other")).toBe(false);
  });

  it("takes the main client from the list when client is missing", () => {
    expect(normalizeGrant({ title: "A", clients: ["lakeside", "me"] }, "x").client).toBe("lakeside");
  });

  it("writes clients only when there's more than one, and round-trips", async () => {
    const fs = new MemoryFS({}, false);
    const one = await createGrant(fs, { title: "Solo", client: "me" });
    expect(await fs.readText(`grants/${one.folder}/grant.md`)).not.toMatch(/^clients:/m);
    const both = await createGrant(fs, { title: "Shared", client: "me", clients: ["me", "lakeside"] });
    expect(await fs.readText(`grants/${both.folder}/grant.md`)).toMatch(/^clients:/m);
    await saveGrant(fs, { ...both, fm: { ...both.fm, client: "lakeside", clients: ["lakeside"] } });
    const data = await loadVault(fs);
    const g = data.grants.find((x) => x.fm.title === "Shared")!;
    expect(g.fm.client).toBe("lakeside");
    expect(clientsOf(g.fm)).toEqual(["lakeside"]);
  });

  it("counts a shared grant in each client's reports", async () => {
    const fs = new MemoryFS({}, false);
    await createGrant(fs, { title: "Shared", client: "me", clients: ["me", "lakeside"] });
    const { grants } = await loadVault(fs);
    const f = { year: "", tag: "", project: "", client: "" };
    expect(filterForReports(grants, { ...f, client: "me" })).toHaveLength(1);
    expect(filterForReports(grants, { ...f, client: "lakeside" })).toHaveLength(1);
  });
});
