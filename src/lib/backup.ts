import JSZip from "jszip";
import { isSafeRelPath, isSafeSegment, type VaultFS } from "./fs/types";

async function addTree(zip: JSZip, fs: VaultFS, dir: string, filter: (p: string) => boolean = () => true) {
  for (const e of await fs.list(dir)) {
    if (e.isDir || !filter(e.path) || !isSafeRelPath(e.path)) continue;
    zip.file(e.path, await fs.readBytes(e.path));
  }
}

/** Zip the whole vault (minus caches and trash). */
export async function zipVault(fs: VaultFS): Promise<Uint8Array> {
  const zip = new JSZip();
  await addTree(zip, fs, "", (p) => !p.startsWith(".manyapply/trash/") && !/\.manyapply\/index\.(db|json)$/.test(p) && !p.startsWith(".git/"));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** "Share client folder": one client's profile, applications and Library folder. */
export async function zipClient(fs: VaultFS, client: string, grantFolders: string[]): Promise<Uint8Array> {
  if (!isSafeSegment(client)) throw new Error("Not a client folder");
  const zip = new JSZip();
  if (await fs.exists(`clients/${client}.md`)) zip.file(`clients/${client}.md`, await fs.readBytes(`clients/${client}.md`));
  for (const g of grantFolders) if (isSafeSegment(g)) await addTree(zip, fs, `grants/${g}`);
  await addTree(zip, fs, `library/${client}`);
  if (await fs.exists(`cv/${client}.md`)) zip.file(`cv/${client}.md`, await fs.readBytes(`cv/${client}.md`));
  zip.file(
    "README.txt",
    `Exported from Many Apply on ${new Date().toDateString()}.\nThese are plain markdown and CSV files. Open them in any text editor, or point Many Apply at this folder.\n`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
