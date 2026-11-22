import YAML from "yaml";

export interface Parsed<T = Record<string, unknown>> {
  data: T;
  body: string;
}

const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Split a markdown file into YAML frontmatter and body. Tolerates missing frontmatter. */
export function parseFrontmatter<T = Record<string, unknown>>(text: string): Parsed<T> {
  const m = FM_RE.exec(text);
  if (!m) return { data: {} as T, body: text };
  let data: unknown = {};
  try {
    data = YAML.parse(m[1]) ?? {};
  } catch {
    data = {};
  }
  if (typeof data !== "object" || Array.isArray(data)) data = {};
  return { data: data as T, body: m[2].replace(/^\r?\n/, "") };
}

/** Keys whose list items are written in compact flow style, like the spec's examples. */
const FLOW_ITEM_KEYS = new Set(["reports", "status_history"]);

/**
 * Serialise frontmatter + body. Empty values are written as bare keys (`submitted_on:`)
 * so hand-edited files stay tidy and match the documented format.
 */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string, order: string[] = []): string {
  const keys = [...order.filter((k) => k in data), ...Object.keys(data).filter((k) => !order.includes(k))];
  const lines: string[] = [];
  for (const k of keys) {
    const v = data[k];
    if (v === undefined) continue;
    if (v === null || v === "") {
      lines.push(`${k}:`);
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else if (v.every((x) => typeof x !== "object" || x === null)) {
        lines.push(`${k}: ${flow(v)}`);
      } else if (FLOW_ITEM_KEYS.has(k)) {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${flow(item)}`);
      } else {
        const doc = YAML.stringify({ [k]: v }).trimEnd();
        lines.push(doc);
      }
    } else if (typeof v === "object") {
      lines.push(YAML.stringify({ [k]: v }).trimEnd());
    } else {
      lines.push(`${k}: ${scalar(v)}`);
    }
  }
  const b = body.startsWith("\n") ? body : "\n" + body;
  return `---\n${lines.join("\n")}\n---\n${b}`;
}

function scalar(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  // Quote only when YAML would misread it.
  const plain = YAML.stringify(s).trimEnd();
  if (plain.includes("\n")) return JSON.stringify(s);
  return plain;
}

function flow(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => flowScalar(x)).join(", ")}]`;
  if (v && typeof v === "object") {
    const parts = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${k}: ${x === null || x === "" ? "" : flowScalar(x)}`.trimEnd());
    return `{${parts.join(", ")}}`;
  }
  return flowScalar(v);
}

function flowScalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  if (/^[\w./@:+-][\w ./@:+-]*$/.test(s) && !/[:#]\s|\s$|^(true|false|null|yes|no|~)$/i.test(s) && !s.includes(","))
    return s;
  return JSON.stringify(s);
}
