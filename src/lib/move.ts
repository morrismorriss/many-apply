// Moving things between folders (Me, a client, Shared) without breaking the applications that use them.
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import { basename, dirname, isSafeRelPath, isSafeSegment, joinPath, safeFileName, type VaultFS } from "./fs/types";
import { asArray } from "./util";

/** The grant fields that point at Library answers, work samples and documents. */
export type ReferenceField = "library_items" | "work_samples" | "documents";

/**
 * Move a markdown file and the media file next to it (if any) from `root/<path>` into `root/<toFolder>/`,
 * picking names that are free there. Returns the new .md path (relative to root) and file name.
 */
export async function moveWithFile(
  fs: VaultFS,
  root: string,
  path: string,
  file: string,
  toFolder: string,
): Promise<{ path: string; file: string }> {
  if (!isSafeRelPath(path) || !isSafeSegment(toFolder) || (file && !safeFileName(file)))
    throw new Error("Refusing to move an unsafe path");
  const stem = basename(path).replace(/\.md$/, "");
  const extMatch = /\.([^.]+)$/.exec(file);
  const ext = extMatch ? extMatch[1] : "";
  const fileStem = file ? file.replace(/\.[^.]+$/, "") : "";
  const taken = async (b: string, f: string) =>
    (await fs.exists(`${root}/${joinPath(toFolder, b)}.md`)) || (!!f && (await fs.exists(`${root}/${joinPath(toFolder, f)}`)));
  let base = stem;
  let nextFile = file;
  for (let i = 2; await taken(base, nextFile); i++) {
    base = `${stem}-${i}`;
    // A file named after its .md stays in step with it; any other name gets the same suffix.
    nextFile = file ? `${fileStem === stem ? base : `${fileStem}-${i}`}${ext ? `.${ext}` : ""}` : "";
  }
  await fs.mkdir(`${root}/${toFolder}`);
  const oldFile = file ? `${root}/${joinPath(dirname(path), file)}` : "";
  if (oldFile && (await fs.exists(oldFile))) await fs.rename(oldFile, `${root}/${joinPath(toFolder, nextFile)}`);
  else nextFile = file;
  const dest = `${joinPath(toFolder, base)}.md`;
  await fs.rename(`${root}/${path}`, `${root}/${dest}`);
  return { path: dest, file: nextFile };
}

/** Point every application that lists `from` in `field` at `to` instead. */
export async function renameGrantReferences(fs: VaultFS, field: ReferenceField, from: string, to: string) {
  if (from === to) return;
  for (const e of await fs.list("grants")) {
    if (e.isDir || !e.path.endsWith("/grant.md")) continue;
    const text = await fs.readText(e.path);
    if (!text.includes(from)) continue;
    const { data, body } = parseFrontmatter(text);
    const list = asArray(data[field]);
    if (!list.includes(from)) continue;
    data[field] = list.map((x) => (x === from ? to : x));
    // Keep the file's own key order: only this one value changes.
    await fs.writeText(e.path, stringifyFrontmatter(data, body, Object.keys(data)));
  }
}
