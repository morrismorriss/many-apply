// Client review export: every question and its draft in one Word document (.docx), to send a client
// to comment on or edit with tracked changes. Word, Google Docs, Pages and LibreOffice all open it.
// Built by hand with JSZip, so there's no extra dependency.
import JSZip from "jszip";
import type { Grant, Question } from "./model";
import type { budgetTotals } from "./budget";
import { sampleCaption, type WorkSample } from "./samples";
import { fmtDate, fmtMoney, wordCount } from "./util";

export interface ReviewInput {
  grant: Grant;
  clientName: string;
  funderName: string;
  questions: (Question & { text: string })[];
  samples: WorkSample[];
  budget: ReturnType<typeof budgetTotals> | null;
  /** For tests. */
  today?: Date;
}

export function reviewFileName(g: Grant): string {
  return `${g.folder}-for-review.docx`;
}

// ---------------------------------------------------------------- XML helpers

export function esc(s: string): string {
  return s
    // Characters XML 1.0 doesn't allow at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RunOpts {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number; // half-points
}

export function run(text: string, o: RunOpts = {}): string {
  const props = [
    o.bold ? "<w:b/>" : "",
    o.italic ? "<w:i/>" : "",
    o.color ? `<w:color w:val="${o.color}"/>` : "",
    o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : "",
  ].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

export function para(runs: string, style?: string, extra = ""): string {
  const pPr = style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : "";
  return `<w:p>${pPr}${runs}</w:p>`;
}

/** **bold**, *italic* and _italic_ inside a line of markdown. */
export function inlineRuns(line: string, base: RunOpts = {}): string {
  const out: string[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > last) out.push(run(line.slice(last, m.index), base));
    const t = m[0];
    if (t.startsWith("**") || t.startsWith("__")) out.push(run(t.slice(2, -2), { ...base, bold: true }));
    else out.push(run(t.slice(1, -1), { ...base, italic: true }));
    last = m.index! + t.length;
  }
  if (last < line.length) out.push(run(line.slice(last), base));
  return out.join("") || run("", base);
}

/** A draft (markdown-ish plain text) as Word paragraphs. */
export function draftParagraphs(text: string): string {
  const blocks = text.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      for (const l of lines) {
        const m = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(l)!;
        const marker = /\d/.test(m[1]) ? m[1] : "•";
        out.push(para(run(`${marker} `) + inlineRuns(m[2]), "ListParagraph"));
      }
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(lines[0]);
    if (h && lines.length === 1) {
      out.push(para(inlineRuns(h[1], { bold: true })));
      continue;
    }
    // Single line breaks inside a paragraph are kept as line breaks.
    out.push(para(lines.map((l) => inlineRuns(l)).join("<w:r><w:br/></w:r>")));
  }
  return out.join("");
}

/** Drafts often start with "# <question title>"; the export already has that heading. */
function withoutTitleHeading(text: string, title: string): string {
  const m = /^\s*#{1,6}\s+(.*)\n?/.exec(text);
  const norm = (t: string) => t.toLowerCase().replace(/^\d+[.)]\s*/, "").replace(/\s*[([].*$/, "").trim();
  return m && norm(m[1]) === norm(title) ? text.slice(m[0].length) : text;
}

function limitLine(q: ReviewInput["questions"][number]): string {
  const n = q.limitUnit === "characters" ? q.text.trim().length : wordCount(q.text);
  const unit = q.limitUnit;
  if (!q.text.trim()) return q.limit ? `Limit ${q.limit.toLocaleString("en-US")} ${unit}` : "";
  if (!q.limit) return `${n.toLocaleString("en-US")} ${unit}`;
  const over = n - q.limit;
  return over > 0
    ? `${n.toLocaleString("en-US")} of ${q.limit.toLocaleString("en-US")} ${unit}: ${over.toLocaleString("en-US")} over the limit`
    : `${n.toLocaleString("en-US")} of ${q.limit.toLocaleString("en-US")} ${unit}`;
}

// ---------------------------------------------------------------- document

export function reviewDocumentXml(input: ReviewInput): string {
  const { grant: g, questions, samples, budget } = input;
  const f = g.fm;
  const c = f.currency;
  const body: string[] = [];

  body.push(para(run(f.title), "Title"));
  const sub = [input.clientName && `For ${input.clientName}`, input.funderName, f.deadline && `Due ${fmtDate(f.deadline, { year: true })}`]
    .filter(Boolean)
    .join(" · ");
  if (sub) body.push(para(run(sub, { color: "6B6460" }), "Subtitle"));

  const facts: [string, string][] = [];
  if (f.amount_requested !== null) facts.push(["Amount requested", fmtMoney(f.amount_requested, c)]);
  if (f.max_award !== null) facts.push(["Funder's maximum", fmtMoney(f.max_award, c)]);
  if (f.project) facts.push(["Project", f.project]);
  if (f.url) facts.push(["Guidelines", f.url]);
  for (const [k, v] of facts) body.push(para(run(`${k}: `, { bold: true }) + run(v)));

  body.push(
    para(
      run("How to review: ", { bold: true }) +
        run(
          "edit straight in this document with Track Changes on (in Word: Review → Track Changes; in Google Docs: Suggesting), or add comments. " +
            "Each question shows its word or character limit, so please keep an eye on length.",
        ),
      "Note",
    ),
  );

  if (questions.length === 0) body.push(para(run("This application has no questions yet.", { italic: true })));
  for (const q of questions) {
    body.push(para(run(`${q.number}. ${q.title}`), "Heading1"));
    const line = limitLine(q);
    const over = q.limit !== null && (q.limitUnit === "characters" ? q.text.trim().length : wordCount(q.text)) > q.limit;
    if (line) body.push(para(run(line, { italic: true, color: over ? "A12A2A" : "6B6460", size: 19 })));
    body.push(q.text.trim() ? draftParagraphs(withoutTitleHeading(q.text, q.title)) : para(run("No draft yet.", { italic: true, color: "6B6460" })));
  }

  if (samples.length) {
    body.push(para(run("Work samples"), "Heading1"));
    samples.forEach((s, i) => {
      body.push(para(run(`${i + 1}. `) + run(sampleCaption(s), { bold: true }), "ListParagraph"));
      const detail = [s.body.trim(), s.fm.credits && `Credits: ${s.fm.credits}`, s.fm.url].filter(Boolean).join(" ");
      if (detail) body.push(para(run(detail), "ListParagraph"));
    });
  }

  if (budget) {
    body.push(para(run("Budget summary"), "Heading1"));
    const rows: [string, string][] = [
      ["Total expenses", fmtMoney(budget.expenses, c)],
      ["Total income", fmtMoney(budget.income, c)],
      ["Gap", fmtMoney(budget.gap, c)],
    ];
    if (f.amount_requested !== null) rows.push(["Requested", fmtMoney(f.amount_requested, c)]);
    for (const [k, v] of rows) body.push(para(run(`${k}: `, { bold: true }) + run(v)));
  }

  const today = input.today ?? new Date();
  body.push(para(run(`Exported from Many Apply on ${today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`, { italic: true, color: "8A817C", size: 18 })));

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${body.join("")}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

export const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/><w:ind w:left="360" w:hanging="360"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="8A1C2B"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F5F3F1"/><w:spacing w:before="200" w:after="200"/><w:ind w:left="180"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
</w:styles>`;

export async function buildReviewDocx(input: ReviewInput): Promise<Uint8Array> {
  return packDocx(input.grant.fm.title, reviewDocumentXml(input), input.today);
}

/** Wrap a document.xml in the other parts a .docx needs. */
export async function packDocx(title: string, documentXml: string, today = new Date()): Promise<Uint8Array> {
  const zip = new JSZip();
  const now = today.toISOString().replace(/\.\d+Z$/, "Z");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title>
<dc:creator>Many Apply</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
</cp:coreProperties>`,
  );
  zip.file("word/styles.xml", DOCX_STYLES);
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
