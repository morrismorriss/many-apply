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
});
