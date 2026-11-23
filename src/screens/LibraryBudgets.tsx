import { useEffect, useState, type ReactNode } from "react";
import { useLookups, useStore } from "../store";
import { askText } from "../components/dialogs";
import { Empty } from "../components/ui";
import { budgetTotals, parseBudgetCsv, stringifyBudgetCsv } from "../lib/budget";
import { fmtMoney } from "../lib/util";
import { libraryBudgetFile, libraryBudgetName } from "../lib/budget";

interface Row {
  file: string;
  lines: number;
  expenses: number;
  income: number;
  gap: number;
}

/** Library → Budgets: budgets not tied to any application, for a project or to start new budgets from. */
export function LibraryBudgets({ tabs }: { tabs: ReactNode }) {
  const fs = useStore((s) => s.fs!);
  const files = useStore((s) => s.data!.budgetTemplates);
  const clients = useStore((s) => s.data!.clients);
  const currency = useStore((s) => s.data!.settings.currency);
  const mutate = useStore((s) => s.mutate);
  const go = useStore((s) => s.go);
  const trashPaths = useStore((s) => s.trashPaths);
  const { clientName } = useLookups();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all(
      files.map(async (file) => {
        try {
          const lines = parseBudgetCsv(await fs.readText(`library/budgets/${file}`));
          const t = budgetTotals(lines);
          return { file, lines: lines.length, expenses: t.expenses, income: t.income, gap: t.gap };
        } catch {
          return { file, lines: 0, expenses: 0, income: 0, gap: 0 };
        }
      }),
    ).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [fs, files]);

  const create = async () => {
    const name = await askText("New budget", { placeholder: "Made Men staged reading", message: "A budget for a project, not tied to an application. You can copy it into any application later." });
    if (!name?.trim()) return;
    const base = libraryBudgetFile(name).replace(/\.csv$/, "");
    let file = `${base}.csv`;
    for (let i = 2; files.some((f) => f.toLowerCase() === file.toLowerCase()); i++) file = `${base}-${i}.csv`;
    await mutate((v) => v.writeText(`library/budgets/${file}`, stringifyBudgetCsv([])));
    go({ screen: "libraryBudget", file });
  };

  const defaultFor = (file: string) => clients.filter((c) => c.fm.budget_template === file).map((c) => clientName(c.slug));

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Library</h1>
          <div className="sub">Budgets for projects, not tied to any application. Copy one into an application, or start a new budget from it.</div>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => void create()}>+ New budget</button>
      </div>
      <div className="lib-tabs">{tabs}</div>

      {files.length === 0 ? (
        <Empty title="No Library budgets yet">
          <p>
            Build a budget for a project once (a production, a residency, a year of programs) and reuse it: copy it into any application, or
            pick it from "Start from…" in an application's budget. You can also save any application's budget here with "Save to Library".
          </p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Budget</th>
                <th className="r">Lines</th>
                <th className="r">Expenses</th>
                <th className="r">Income</th>
                <th className="r">Gap</th>
                <th>Default for</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const r = rows?.find((x) => x.file === file);
                return (
                  <tr key={file} className="click" onClick={() => go({ screen: "libraryBudget", file })}>
                    <td style={{ fontWeight: 550 }}>{libraryBudgetName(file)}</td>
                    <td className="r num">{r ? r.lines : ""}</td>
                    <td className="r num">{r ? fmtMoney(r.expenses, currency) : ""}</td>
                    <td className="r num">{r ? fmtMoney(r.income, currency) : ""}</td>
                    <td className="r num">{r ? fmtMoney(r.gap, currency) : ""}</td>
                    <td className="soft small">{defaultFor(file).join(", ")}</td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="icon-btn"
                        title="Move to trash (you can undo)"
                        aria-label={`Delete ${libraryBudgetName(file)}`}
                        onClick={() =>
                          void trashPaths([`library/budgets/${file}`], (d) => ({ ...d, budgetTemplates: d.budgetTemplates.filter((x) => x !== file) }))
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 12 }}>
        Saved in <code>library/budgets/</code> as CSV. A client can have a default budget (set it in their profile), offered when one of their
        applications has no budget yet.
      </p>
    </div>
  );
}
