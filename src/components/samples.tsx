import { useEffect, useState } from "react";
import { useStore } from "../store";
import { askText } from "./dialogs";
import { createSample, setSampleFile, previewMime, sampleFilePath, SAMPLE_EXTENSIONS, type WorkSample } from "../lib/samples";
import { droppedFiles, errorText, openExternal, pickFiles, type PickedFile } from "../lib/platform";

const KIND_ICON: Record<WorkSample["fm"]["kind"], string> = {
  image: "▣",
  video: "▶",
  audio: "♪",
  document: "≡",
  link: "↗",
};

/**
 * A blob: URL for a vault file, for <img>, <video> and <audio>. The file is read only when `on` is true,
 * and the URL is released when the component goes away.
 */
export function useBlobUrl(path: string, mime: string, on = true): { url: string | null; failed: boolean } {
  const fs = useStore((s) => s.fs);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!fs || !path || !mime || !on) return;
    let live = true;
    let made: string | null = null;
    fs.readBytes(path)
      .then((bytes) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
        setUrl(made);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [fs, path, mime, on]);
  return { url, failed };
}

/** Square-ish thumbnail for a card or list row. Only images are read; everything else shows an icon. */
export function SampleThumb({ s, size = 140 }: { s: WorkSample; size?: number }) {
  const file = sampleFilePath(s);
  const isImage = s.fm.kind === "image" && !!file && !!previewMime(s.fm.file);
  const { url } = useBlobUrl(file, isImage ? previewMime(s.fm.file) : "", isImage);
  return (
    <div className="sample-thumb" style={{ height: size }} aria-hidden>
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="sample-icon">{KIND_ICON[s.fm.kind]}</span>}
    </div>
  );
}

/** Full preview in the drawer: image, video or audio player, or a note for files the app can't show. */
export function SamplePreview({ s }: { s: WorkSample }) {
  const file = sampleFilePath(s);
  const mime = file ? previewMime(s.fm.file) : "";
  const { url, failed } = useBlobUrl(file, mime, !!mime);
  if (!file) {
    return s.fm.url ? (
      <div className="sample-preview empty">
        <span className="sample-icon">{KIND_ICON[s.fm.kind]}</span>
        <a href="#" onClick={(e) => { e.preventDefault(); void openExternal(s.fm.url).catch(() => {}); }}>
          {s.fm.url.replace(/^https?:\/\//, "")}
        </a>
      </div>
    ) : (
      <div className="sample-preview empty muted small">No file or link yet.</div>
    );
  }
  if (failed) return <div className="sample-preview empty muted small">Couldn't find {s.fm.file} next to this sample.</div>;
  if (!mime) return <div className="sample-preview empty"><span className="sample-icon">{KIND_ICON[s.fm.kind]}</span><span className="muted small">{s.fm.file}</span></div>;
  if (!url) return <div className="sample-preview empty muted small">Loading…</div>;
  if (mime.startsWith("image/")) return <div className="sample-preview"><img src={url} alt={s.fm.title} /></div>;
  if (mime.startsWith("video/")) return <div className="sample-preview"><video src={url} controls preload="metadata" /></div>;
  if (mime.startsWith("audio/")) return <div className="sample-preview audio"><span className="sample-icon">♪</span><audio src={url} controls preload="metadata" /></div>;
  return <div className="sample-preview empty"><span className="sample-icon">≡</span><span className="muted small">{s.fm.file}</span></div>;
}

const titleFromFile = (name: string) =>
  name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";

/** Add samples from picked or dropped files, or from a link. Returns the new samples. */
export function useAddSamples() {
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const open = useStore((s) => s.openDrawer);

  const addFiles = async (folder: string, files: PickedFile[]) => {
    const ok = files.filter((f) => SAMPLE_EXTENSIONS.includes(f.name.split(".").pop()?.toLowerCase() ?? ""));
    if (ok.length < files.length) toast(`Skipped ${files.length - ok.length} file${files.length - ok.length === 1 ? "" : "s"} that aren't images, video, audio or documents.`, "warn");
    if (!ok.length) return [];
    try {
      const made = await mutate(async (fs) => {
        const out: WorkSample[] = [];
        for (const f of ok) out.push(await createSample(fs, folder, { title: titleFromFile(f.name), file: { name: f.name, copyTo: (dest) => f.copyTo(fs, dest) } }));
        return out;
      });
      if (made.length === 1) open({ kind: "sample", id: made[0].path });
      else toast(`Added ${made.length} work samples`);
      return made;
    } catch (e) {
      toast(`Couldn't add that file: ${errorText(e)}`, "error");
      return [];
    }
  };

  return {
    /** Upload a file to an existing sample, replacing any file it had. */
    replace: async (sample: WorkSample) => {
      const [f] = await pickFiles(SAMPLE_EXTENSIONS, sample.fm.file ? "Replace file" : "Upload a file");
      if (!f) return;
      try {
        const { trash } = await import("../lib/vault");
        await mutate((fs) => setSampleFile(fs, sample, { name: f.name, copyTo: (dest) => f.copyTo(fs, dest) }, (p) => trash(fs, p)));
        toast(sample.fm.file ? "Replaced the file. The old one is in trash." : "Uploaded");
      } catch (e) {
        toast(`Couldn't add that file: ${errorText(e)}`, "error");
      }
    },
    pick: async (folder: string) => addFiles(folder, await pickFiles(SAMPLE_EXTENSIONS, "Add work samples")),
    drop: async (folder: string, list: FileList) => addFiles(folder, droppedFiles(list)),
    link: async (folder: string) => {
      const url = await askText("Insert a link", {
        placeholder: "https://vimeo.com/…",
        message: "Vimeo, YouTube, SoundCloud, Bandcamp, a portfolio page or a shared folder.",
      });
      if (!url?.trim()) return [];
      const href = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      const title = await askText("Title", { placeholder: "River Suite (excerpt)", okLabel: "Add sample" });
      if (!title?.trim()) return [];
      const s = await mutate((fs) => createSample(fs, folder, { title: title.trim(), url: href }));
      open({ kind: "sample", id: s.path });
      return [s];
    },
  };
}

