// The browser extension ships inside the app, so it can be saved as a zip from Settings
// without going to GitHub, and always matches the app's version.
import JSZip from "jszip";

// Text files are bundled exactly as they are (a ?url import would let the bundler minify the CSS).
const TEXT = import.meta.glob(["../../extension/**/*", "!**/*.png"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
// Images are bundled inline as base64 data URLs and decoded here, never fetched: the desktop app's
// content security policy doesn't allow fetching data: URLs, which broke the download.
const IMAGES = import.meta.glob("../../extension/**/*.png", { query: "?inline", import: "default", eager: true }) as Record<string, string>;

const inZip = (path: string) => path.replace(/^(\.\.\/)+extension\//, "");

export function dataUrlBytes(url: string): Uint8Array {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error("Not a data URL");
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2]));
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function zipExtension(): Promise<Uint8Array> {
  const zip = new JSZip();
  const folder = zip.folder("many-apply-extension")!;
  for (const [path, text] of Object.entries(TEXT)) folder.file(inZip(path), text);
  for (const [path, url] of Object.entries(IMAGES)) {
    try {
      folder.file(inZip(path), dataUrlBytes(url));
    } catch {
      throw new Error(`Couldn't read ${inZip(path)}`);
    }
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
