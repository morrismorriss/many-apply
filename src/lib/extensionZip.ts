// The Chrome extension ships inside the app, so it can be saved as a zip from Settings
// without going to GitHub, and always matches the app's version.
import JSZip from "jszip";

// Text files are bundled exactly as they are (a ?url import would let the bundler minify the CSS).
const TEXT = import.meta.glob(["../../extension/**/*", "!**/*.png"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const IMAGES = import.meta.glob("../../extension/**/*.png", { query: "?url", import: "default", eager: true }) as Record<string, string>;

const inZip = (path: string) => path.replace(/^(\.\.\/)+extension\//, "");

export async function zipExtension(): Promise<Uint8Array> {
  const zip = new JSZip();
  const folder = zip.folder("many-apply-extension")!;
  for (const [path, text] of Object.entries(TEXT)) folder.file(inZip(path), text);
  for (const [path, url] of Object.entries(IMAGES)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't read ${inZip(path)}`);
    folder.file(inZip(path), new Uint8Array(await res.arrayBuffer()));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
