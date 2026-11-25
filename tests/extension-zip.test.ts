import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { dataUrlBytes, zipExtension } from "../src/lib/extensionZip";

describe("extension zip", () => {
  it("decodes data URLs without fetching", () => {
    expect([...dataUrlBytes("data:image/png;base64,iVBORw==")]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("bundles the manifest and every icon as real PNGs", async () => {
    const zip = await JSZip.loadAsync(await zipExtension());
    expect(zip.file("many-apply-extension/manifest.json")).toBeTruthy();
    for (const size of [16, 48, 128]) {
      const bytes = await zip.file(`many-apply-extension/icons/icon${size}.png`)!.async("uint8array");
      expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });

  it("has a manifest that loads in both Chrome and Firefox", async () => {
    const zip = await JSZip.loadAsync(await zipExtension());
    const m = JSON.parse(await zip.file("many-apply-extension/manifest.json")!.async("string"));
    // Chrome runs the service worker; Firefox runs background scripts. Each ignores the other's key.
    expect(m.background.service_worker).toBe("background.js");
    expect(m.background.scripts).toEqual(["background.js"]);
    // Firefox needs a fixed ID to keep storage (pairing code, queue) across reloads.
    expect(m.browser_specific_settings.gecko.id).toMatch(/@/);
  });
});
