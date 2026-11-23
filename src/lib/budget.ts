import Papa from "papaparse";
import type { BudgetLine } from "./model";
import { parseNumber, uid } from "./util";

export const BUDGET_COLUMNS = ["category", "type", "line_item", "quantity", "rate", "amount", "notes"] as const;

export function lineAmount(l: BudgetLine): number {
  if (l.quantity !== null && l.rate !== null) return l.quantity * l.rate;
  return l.amount ?? 0;
}

export function blankLine(partial: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: uid(),
    category: "",
    type: "Expense",
    line_item: "",
    quantity: null,
    rate: null,
    amount: null,
    notes: "",
    ...partial,
  };
}

function normType(v: string): BudgetLine["type"] {
  const s = v.trim().toLowerCase();
  if (s.startsWith("inc") || s === "revenue") return "Income";
  if (s.replace(/[^a-z]/g, "") === "inkind") return "In-kind";
  return "Expense";
}

const HEADER_ALIASES: Record<string, (typeof BUDGET_COLUMNS)[number]> = {
  category: "category", section: "category", group: "category",
  type: "type", kind: "type",
  lineitem: "line_item", item: "line_item", description: "line_item", expense: "line_item", name: "line_item",
  quantity: "quantity", qty: "quantity", units: "quantity",
  rate: "rate", unitcost: "rate", unitprice: "rate", price: "rate", cost: "rate",
  amount: "amount", total: "amount", budget: "amount", subtotal: "amount",
  notes: "notes", note: "notes", comments: "notes", details: "notes",
};

/** Parse budget.csv (or any budget CSV, matching common header names). Skips a TOTAL row. */
export function parseBudgetCsv(text: string): BudgetLine[] {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  const fields = parsed.meta.fields ?? [];
  const map = new Map<string, (typeof BUDGET_COLUMNS)[number]>();
  for (const f of fields) {
    const hit = HEADER_ALIASES[f.toLowerCase().replace(/[^a-z]/g, "")];
    if (hit && ![...map.values()].includes(hit)) map.set(f, hit);
  }
  const out: BudgetLine[] = [];
  for (const row of parsed.data) {
    const r: Record<string, string> = {};
    // A leading apostrophe before = + - @ was added on export so spreadsheets show it as text; take it off.
    for (const [f, col] of map) r[col] = (row[f] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
    if (/^((grand\s+)?totals?\b|gap\b)/i.test(r.line_item || "") || /^totals?\b/i.test(r.category || "")) continue;
    if (!r.line_item && !r.amount && !r.rate) continue;
    out.push(
      blankLine({
        category: r.category || "",
        type: normType(r.type || ""),
        line_item: r.line_item || "",
        quantity: parseNumber(r.quantity),
        rate: parseNumber(r.rate),
        amount: parseNumber(r.amount),
        notes: r.notes || "",
      }),
    );
  }
  return out;
}

/** Text that a spreadsheet would run as a formula gets a leading apostrophe (see csvSafe in csvImport). */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s.trim()) ? `'${s}` : s);

export function stringifyBudgetCsv(lines: BudgetLine[], opts: { totals?: boolean; amounts?: boolean } = {}): string {
  const amounts = opts.amounts ?? true;
  const rows: (string | number)[][] = lines
    .filter((l) => l.line_item.trim() || lineAmount(l))
    .map((l) => [
      safe(l.category),
      l.type,
      safe(l.line_item),
      amounts ? (l.quantity ?? "") : "",
      amounts ? (l.rate ?? "") : "",
      amounts ? (l.quantity !== null && l.rate !== null ? lineAmount(l) : (l.amount ?? "")) : "",
      safe(l.notes),
    ]);
  if (opts.totals) {
    const t = budgetTotals(lines);
    rows.push([]);
    rows.push(["", "Expense", "TOTAL EXPENSES", "", "", t.expenses, ""]);
    rows.push(["", "Income", "TOTAL INCOME", "", "", t.income, ""]);
    if (t.inKind) rows.push(["", "In-kind", "TOTAL IN-KIND", "", "", t.inKind, ""]);
    rows.push(["", "", "GAP (EXPENSES − INCOME)", "", "", t.gap, ""]);
  }
  return Papa.unparse({ fields: [...BUDGET_COLUMNS], data: rows }) + "\n";
}

export interface BudgetTotals {
  expenses: number;
  income: number;
  inKind: number;
  gap: number;
  byCategory: { category: string; expenses: number; income: number; inKind: number }[];
}

export function budgetTotals(lines: BudgetLine[]): BudgetTotals {
  const cats = new Map<string, { expenses: number; income: number; inKind: number }>();
  let expenses = 0, income = 0, inKind = 0;
  for (const l of lines) {
    const a = lineAmount(l);
    if (!a) continue;
    const c = l.category || "Uncategorized";
    const row = cats.get(c) ?? { expenses: 0, income: 0, inKind: 0 };
    if (l.type === "Income") {
      income += a;
      row.income += a;
    } else if (l.type === "In-kind") {
      inKind += a;
      row.inKind += a;
    } else {
      expenses += a;
      row.expenses += a;
    }
    cats.set(c, row);
  }
  return {
    expenses,
    income,
    inKind,
    gap: expenses - income,
    byCategory: [...cats.entries()].map(([category, v]) => ({ category, ...v })),
  };
}

function money(n: number) {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Budget as a tab-separated table (pastes cleanly into forms and spreadsheets) plus HTML. */
export function budgetAsTable(lines: BudgetLine[]): { text: string; html: string } {
  const live = lines.filter((l) => l.line_item.trim() || lineAmount(l));
  const header = ["Category", "Type", "Line item", "Amount", "Notes"];
  const rows = live.map((l) => [
    l.category,
    l.type,
    l.line_item + (l.quantity !== null && l.rate !== null ? ` (${l.quantity} × ${money(l.rate)})` : ""),
    money(lineAmount(l)),
    l.notes,
  ]);
  const t = budgetTotals(lines);
  const totals = [
    ["", "", "Total expenses", money(t.expenses), ""],
    ["", "", "Total income", money(t.income), ""],
    ["", "", "Gap", money(t.gap), ""],
  ];
  const text = [header, ...rows, ...totals].map((r) => r.join("\t")).join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html =
    `<table border="1" cellpadding="4" style="border-collapse:collapse">` +
    `<tr>${header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") +
    totals.map((r) => `<tr>${r.map((c) => `<td><b>${esc(c)}</b></td>`).join("")}</tr>`).join("") +
    `</table>`;
  return { text, html };
}
