import { useEffect, useMemo, useRef, useState } from "react";
import { useLookups, useStore } from "../store";
import { blankLine, budgetAsTable, libraryBudgetFile, libraryBudgetName, budgetTotals, lineAmount, parseBudgetCsv, stringifyBudgetCsv } from "../lib/budget";
import type { BudgetLine } from "../lib/model";
import { copyToClipboard, pickFile, saveFile } from "../lib/platform";
import { debounce, fmtMoney, slugify } from "../lib/util";
import { confirmAction } from "../components/dialogs";
import { MenuButton, Modal } from "../components/ui";
import type { Grant } from "../lib/model";
import { setPref } from "../lib/platform";

export { libraryBudgetName };

/** The budget for an application (`folder`), or a Library budget not tied to any application (`file`, in library/budgets/). */
export function BudgetBuilder({ folder = "", file = "" }: { folder?: string; file?: string }) {
  const fs = useStore((s) => s.fs!);
  const g = useStore((s) => (folder ? s.data?.grants.find((x) => x.folder === folder) : undefined));
  const data = useStore((s) => s.data!);
  const update = useStore((s) => s.updateGrant);
  const go = useStore((s) => s.go);
  const openDrawer = useStore((s) => s.openDrawer);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const { client } = useLookups();
  const [lines, setLines] = useState<BudgetLine[] | null>(null);
  const [exists, setExists] = useState(false);
  const [saved, setSaved] = useState(true);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [saveTpl, setSaveTpl] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const path = folder ? `grants/${folder}/budget.csv` : `library/budgets/${file}`;
  const budgetName = libraryBudgetName(file);
  const categories = data.settings.categories;

  useEffect(() => {
    fs.readText(path)
      .then((t) => {
        setExists(true);
        const l = parseBudgetCsv(t);
        setLines(l.length ? l : [blankLine()]);
      })
      .catch(() => {
        setExists(false);
        setLines([blankLine()]);
      });
  }, [fs, path]);

  const persist = useMemo(
    () =>
      debounce(async (l: BudgetLine[]) => {
        await fs.writeText(path, stringifyBudgetCsv(l));
        setExists(true);
        setSaved(true);
      }, 500),
    [fs, path],
  );

  useEffect(() => {
    if (!focusId) return;
    const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${focusId}"] input[data-col="line_item"]`);
    el?.focus();
    setFocusId(null);
  }, [focusId, lines]);

  if (folder && !g) return <div className="page"><p className="muted">This application isn't in the vault.</p></div>;
  if (!lines) return <div className="page"><p className="muted">Loading…</p></div>;

  const change = (next: BudgetLine[]) => {
    setLines(next);
    setSaved(false);
    persist(next);
  };
  const setLine = (id: string, patch: Partial<BudgetLine>) => change(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addAfter = (i: number) => {
    const prev = lines[i];
    const nl = blankLine({ category: prev?.category ?? "", type: prev?.type ?? "Expense" });
    const next = [...lines.slice(0, i + 1), nl, ...lines.slice(i + 1)];
    change(next);
    setFocusId(nl.id);
  };
  const remove = (id: string) => change(lines.length === 1 ? [blankLine()] : lines.filter((l) => l.id !== id));

  const t = budgetTotals(lines);
  const c = g?.fm.currency ?? data.settings.currency;
  const over = !!g && g.fm.amount_requested !== null && g.fm.max_award !== null && g.fm.amount_requested > g.fm.max_award;
  const isEmpty = lines.every((l) => !l.line_item && !lineAmount(l));

  const loadLines = async (incoming: BudgetLine[], label: string) => {
    if (!isEmpty && !(await confirmAction(`Replace this budget with ${label}?`, "The current lines will be replaced.", { okLabel: "Replace" }))) return;
    change(incoming.length ? incoming.map((l) => ({ ...l })) : [blankLine()]);
    toast(`Loaded ${label}`);
  };

  const templateItems = data.budgetTemplates.filter((tpl) => tpl !== file).map((tpl) => ({
    label: <>Library budget: {libraryBudgetName(tpl)}</>,
    run: async () => loadLines(parseBudgetCsv(await fs.readText(`library/budgets/${tpl}`)), `the "${libraryBudgetName(tpl)}" budget`),
  }));
  const pastItems = data.grants
    .filter((x) => x.folder !== folder)
    .map((x) => ({
      label: <>Past budget: {x.fm.title}</>,
      run: async () => {
        try {
          await loadLines(parseBudgetCsv(await fs.readText(`grants/${x.folder}/budget.csv`)), `the budget from ${x.fm.title}`);
        } catch {
          toast("That application has no budget.", "warn");
        }
      },
    }));
  const defaultTpl = g ? client(g.fm.client)?.fm.budget_template : undefined;
  // Applications to copy a Library budget into: open ones first.
  const openFirst = [...data.grants].sort(
    (a, b) => Number(["awarded", "declined", "withdrawn"].includes(a.fm.status)) - Number(["awarded", "declined", "withdrawn"].includes(b.fm.status)),
  );
  const copyTo = async (target: Grant) => {
    const dest = `grants/${target.folder}/budget.csv`;
    if ((await fs.exists(dest)) && !(await confirmAction(`Replace the budget for ${target.fm.title}?`, "Its current budget lines will be replaced with this one.", { okLabel: "Replace" }))) return;
    await mutate((v) => v.writeText(dest, stringifyBudgetCsv(lines)));
    toast(`Copied to ${target.fm.title}`, "ok", { label: "Open", run: () => go({ screen: "budget", folder: target.folder }) });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          {g ? (
            <button className="btn ghost small" style={{ marginLeft: -8, marginBottom: 4 }} onClick={() => { go({ screen: "pipeline" }); openDrawer({ kind: "grant", id: folder }); }}>
              ← {g.fm.title}
            </button>
          ) : (
            <button className="btn ghost small" style={{ marginLeft: -8, marginBottom: 4 }} onClick={() => { setPref("libraryTab", "budgets"); go({ screen: "library" }); }}>
              ← Library budgets
            </button>
          )}
          <h1>{g ? "Budget" : budgetName}</h1>
          <div className="sub">
            {g ? null : "Not tied to an application. "}Saved as <code>{path}</code> · {saved ? "Saved" : "Saving…"}
          </div>
        </div>
        <span className="spacer" />
        <MenuButton label="Start from… ▾" items={[...templateItems, ...pastItems.slice(0, 15)]} />
        <button
          className="btn"
          onClick={async () => {
            const f = await pickFile(["csv"]);
            if (f) await loadLines(parseBudgetCsv(f.text), f.name);
          }}
        >
          Import CSV
        </button>
        <button className="btn" onClick={() => setSaveTpl(true)} disabled={isEmpty}>{g ? "Save to Library" : "Save a copy"}</button>
        {!g && (
          <MenuButton
            label="Copy to an application ▾"
            items={openFirst.map((x) => ({ label: <>{x.fm.title} <span className="muted small">{x.fm.status}</span></>, run: () => void copyTo(x) }))}
          />
        )}
        <button
          className="btn"
          onClick={async () => {
            const tbl = budgetAsTable(lines);
            await copyToClipboard(tbl.text, tbl.html);
            toast("Copied as a table");
          }}
        >
          Copy as table
        </button>
        <button className="btn primary" onClick={() => saveFile(`${slugify(g?.fm.title ?? budgetName)}-budget.csv`, stringifyBudgetCsv(lines, { totals: true }), "text/csv")}>
          Export CSV
        </button>
      </div>

      {g && !exists && isEmpty && defaultTpl && (
        <div className="callout" style={{ marginBottom: 14 }}>
          {client(g.fm.client)?.fm.name} has a default Library budget.{" "}
          <a href="#" onClick={async (e) => { e.preventDefault(); await loadLines(parseBudgetCsv(await fs.readText(`library/budgets/${defaultTpl}`)), "the default template"); }}>
            Start from {libraryBudgetName(defaultTpl)}
          </a>
        </div>
      )}

      <div className="table-wrap">
        <table className="table budget" ref={tableRef}>
          <thead>
            <tr>
              <th style={{ width: 22 }} />
              <th>Line item</th>
              <th style={{ width: 150 }}>Category</th>
              <th style={{ width: 104 }}>Type</th>
              <th style={{ width: 210 }} className="r">Amount</th>
              <th>Notes</th>
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const qr = l.quantity !== null || l.rate !== null;
              const onKey = (e: React.KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAfter(i);
                } else if (e.key === "Backspace" && (e.target as HTMLInputElement).dataset.col === "line_item" && !l.line_item && !lineAmount(l) && lines.length > 1) {
                  e.preventDefault();
                  remove(l.id);
                  if (i > 0) setFocusId(lines[i - 1].id);
                }
              };
              return (
                <tr
                  key={l.id}
                  data-row={l.id}
                  className={overIdx === i && dragIdx !== null && dragIdx !== i ? "drag-over" : ""}
                  onDragOver={(e) => {
                    if (dragIdx === null) return;
                    e.preventDefault();
                    setOverIdx(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx === null || dragIdx === i) return;
                    const next = [...lines];
                    const [moved] = next.splice(dragIdx, 1);
                    next.splice(i, 0, moved);
                    change(next);
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                >
                  <td
                    className="handle"
                    draggable
                    title="Drag to reorder"
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(i));
                      setDragIdx(i);
                    }}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setOverIdx(null);
                    }}
                  >
                    ⋮⋮
                  </td>
                  <td>
                    <input className="inline" data-col="line_item" value={l.line_item} placeholder={i === 0 ? "Lighting designer fee" : ""} onChange={(e) => setLine(l.id, { line_item: e.target.value })} onKeyDown={onKey} />
                  </td>
                  <td>
                    <input className="inline" list="budget-cats" value={l.category} placeholder="Category" onChange={(e) => setLine(l.id, { category: e.target.value })} onKeyDown={onKey} />
                  </td>
                  <td>
                    <select className="inline" value={l.type} onChange={(e) => setLine(l.id, { type: e.target.value as BudgetLine["type"] })}>
                      <option>Expense</option>
                      <option>Income</option>
                      <option>In-kind</option>
                    </select>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                      {qr ? (
                        <>
                          <NumIn value={l.quantity} width={44} placeholder="qty" onChange={(quantity) => setLine(l.id, { quantity })} onKeyDown={onKey} />
                          <span className="muted">×</span>
                          <NumIn value={l.rate} width={70} placeholder="rate" onChange={(rate) => setLine(l.id, { rate })} onKeyDown={onKey} />
                          <span className="num small" style={{ minWidth: 62, textAlign: "right" }}>{fmtMoney(lineAmount(l), c)}</span>
                        </>
                      ) : (
                        <NumIn value={l.amount} width={120} placeholder="$0" onChange={(amount) => setLine(l.id, { amount })} onKeyDown={onKey} />
                      )}
                      <button
                        className="icon-btn"
                        style={{ width: 22, height: 22, fontSize: 12 }}
                        title={qr ? "Switch to a single amount" : "Switch to quantity × rate"}
                        onClick={() =>
                          qr
                            ? setLine(l.id, { amount: lineAmount(l) || null, quantity: null, rate: null })
                            : setLine(l.id, { quantity: 1, rate: l.amount, amount: null })
                        }
                      >
                        {qr ? "$" : "×"}
                      </button>
                    </div>
                  </td>
                  <td>
                    <input className="inline" value={l.notes} placeholder="" onChange={(e) => setLine(l.id, { notes: e.target.value })} onKeyDown={onKey} />
                  </td>
                  <td>
                    <button className="icon-btn" title="Delete line" onClick={() => remove(l.id)}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="budget-cats">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
        <div className="row" style={{ padding: "6px 10px" }}>
          <button className="btn small ghost" onClick={() => addAfter(lines.length - 1)}>+ Add line</button>
          <span className="muted small">Press <span className="kbd">Enter</span> in any cell for a new line.</span>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2>By category</h2>
          <table className="table small">
            <thead>
              <tr><th>Category</th><th className="r">Expenses</th><th className="r">Income</th><th className="r">In-kind</th></tr>
            </thead>
            <tbody>
              {t.byCategory.map((r) => (
                <tr key={r.category}>
                  <td>{r.category}</td>
                  <td className="r num">{r.expenses ? fmtMoney(r.expenses, c) : ""}</td>
                  <td className="r num">{r.income ? fmtMoney(r.income, c) : ""}</td>
                  <td className="r num">{r.inKind ? fmtMoney(r.inKind, c) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Totals</h2>
          <div className="totals">
            <span className="soft">Total expenses</span>
            <span className="num">{fmtMoney(t.expenses, c)}</span>
            <span className="soft">Total income</span>
            <span className="num">{fmtMoney(t.income, c)}</span>
            {t.inKind > 0 && (
              <>
                <span className="soft">In-kind (not in the gap)</span>
                <span className="num">{fmtMoney(t.inKind, c)}</span>
              </>
            )}
            <span className="big">Gap</span>
            <span className="big num">{fmtMoney(t.gap, c)}</span>
            {g && (
              <>
                <span className="soft">Amount requested</span>
                <span className="num">{fmtMoney(g.fm.amount_requested, c)}</span>
                <span className="soft">Funder's max</span>
                <span className="num">{fmtMoney(g.fm.max_award, c)}</span>
              </>
            )}
          </div>
          {g && <div className="row" style={{ marginTop: 14 }}>
            <button
              className="btn"
              disabled={t.gap <= 0 || g.fm.amount_requested === t.gap}
              onClick={async () => {
                await update(folder, (x) => ({ ...x, fm: { ...x.fm, amount_requested: t.gap } }));
                toast(`Amount requested set to ${fmtMoney(t.gap, c)}`);
              }}
            >
              Set amount requested to the gap
            </button>
          </div>}
          {g && (over || (g.fm.max_award !== null && t.gap > g.fm.max_award)) && (
            <div className="callout warn small" style={{ marginTop: 10 }}>
              {over
                ? `The request (${fmtMoney(g.fm.amount_requested, c)}) is above the funder's max (${fmtMoney(g.fm.max_award, c)}).`
                : `The gap is above the funder's max of ${fmtMoney(g.fm.max_award, c)}. You'll need other income to close it.`}
            </div>
          )}
        </div>
      </div>

      {saveTpl && (
        <SaveTemplate
          keepAmounts={!g}
          onClose={() => setSaveTpl(false)}
          onSave={async (name, amounts) => {
            setSaveTpl(false);
            const target = libraryBudgetFile(name);
            if (data.budgetTemplates.includes(target) && !(await confirmAction(`Replace the "${name}" budget in the Library?`))) return;
            await mutate((fs) => fs.writeText(`library/budgets/${target}`, stringifyBudgetCsv(lines, { amounts })));
            toast(`Saved "${name}" to Library budgets`, "ok", { label: "Open", run: () => go({ screen: "libraryBudget", file: target }) });
          }}
        />
      )}
    </div>
  );
}

function NumIn({ value, onChange, width, placeholder, onKeyDown }: {
  value: number | null;
  onChange: (n: number | null) => void;
  width: number;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const [v, setV] = useState(value === null ? "" : String(value));
  useEffect(() => {
    const cur = v.trim() === "" ? null : Number(v.replace(/[^0-9.-]/g, ""));
    if (cur !== value) setV(value === null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="inline num"
      style={{ width, textAlign: "right" }}
      inputMode="decimal"
      value={v}
      placeholder={placeholder}
      onChange={(e) => {
        setV(e.target.value);
        const s = e.target.value.replace(/[^0-9.-]/g, "");
        const n = s === "" ? null : Number(s);
        onChange(n === null || isNaN(n) ? null : n);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

function SaveTemplate({ keepAmounts, onClose, onSave }: { keepAmounts: boolean; onClose: () => void; onSave: (name: string, amounts: boolean) => void }) {
  const [name, setName] = useState("");
  const [amounts, setAmounts] = useState(keepAmounts);
  return (
    <Modal
      title="Save to Library budgets"
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim(), amounts)}>Save</button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          Name
          <input className="input" autoFocus value={name} placeholder="Staged reading" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim(), amounts)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={amounts} onChange={(e) => setAmounts(e.target.checked)} /> Keep the amounts
        </label>
        <span className="muted small">Saved in Library → Budgets (library/budgets/). Any budget can start from it with "Start from…".</span>
      </div>
    </Modal>
  );
}

