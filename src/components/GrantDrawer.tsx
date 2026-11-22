import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import {
  ClientSelect,
  FunderSelect,
  InlineDate,
  InlineNumber,
  InlineSelect,
  InlineText,
  Modal,
  StatusPill,
  TagInput,
  WordMeter,
  useAllTags,
} from "./ui";
import { confirmAction } from "./dialogs";
import {
  DEADLINE_TYPES,
  GRANT_TYPES,
  STATUSES,
  STATUS_LABEL,
  type Grant,
  type GrantFM,
  type Question,
  type ReportDate,
} from "../lib/model";
import { addQuestionToBody, bodySection, listAttachments, parseQuestions, readDraft, setBodySection, GRANT_ORDER } from "../lib/vault";
import { budgetTotals, parseBudgetCsv } from "../lib/budget";
import { suggestFor } from "../lib/library";
import { fmtDate, fmtMoney, slugify, todayISO, wordCount } from "../lib/util";
import { openExternal } from "../lib/platform";

const openExternalSafe = (u: string) => void openExternal(u).catch(() => {});

export function GrantDrawer({ folder }: { folder: string }) {
  const g = useStore((s) => s.data?.grants.find((x) => x.folder === folder));
  const update = useStore((s) => s.updateGrant);
  const setStatus = useStore((s) => s.setStatus);
  const del = useStore((s) => s.deleteGrant);
  const go = useStore((s) => s.go);
  const tags = useAllTags();

  if (!g) return <p className="muted">This application isn't in the vault any more.</p>;
  const f = g.fm;
  const set = (patch: Partial<GrantFM>) => update(folder, (x) => ({ ...x, fm: { ...x.fm, ...patch } }));
  const setBody = (heading: string, text: string) => update(folder, (x) => ({ ...x, body: setBodySection(x.body, heading, text) }));
  const extras = Object.keys(f).filter((k) => !GRANT_ORDER.includes(k));

  return (
    <div>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <InlineText className="drawer-title" value={f.title} onSave={(v) => v && set({ title: v })} />
        <button className={`icon-btn ${f.starred ? "star" : ""}`} title="Star" onClick={() => set({ starred: !f.starred })} style={{ marginTop: 6 }}>
          {f.starred ? "★" : "☆"}
        </button>
      </div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <select
          className="select"
          style={{ width: "auto" }}
          aria-label="Status"
          value={f.status}
          onChange={(e) => setStatus(folder, e.target.value as GrantFM["status"])}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <StatusPill status={f.status} />
        {f.status === "researching" && (
          <button className="btn small" onClick={() => setStatus(folder, "planning")}>
            Move to Pipeline →
          </button>
        )}
        <span className="grow" />
        <button className="btn small" onClick={() => go({ screen: "budget", folder })}>
          Budget
        </button>
      </div>

      <section>
        <div className="props">
          <div className="k">For</div>
          <div className="v">
            <ClientSelect value={f.client} onChange={(client) => set({ client })} />
          </div>
          <div className="k">Funder</div>
          <div className="v">
            <FunderSelect value={f.funder} onChange={(funder) => set({ funder })} />
          </div>
          <div className="k">Type</div>
          <div className="v">
            <InlineSelect value={f.type} options={GRANT_TYPES} onSave={(type) => set({ type })} />
          </div>
          <div className="k">Link</div>
          <div className="v">
            <InlineText value={f.url} placeholder="https://" onSave={(url) => set({ url })} />
            {f.url && (
              <button className="icon-btn" title="Open link" onClick={() => openExternalSafe(f.url)}>
                ↗
              </button>
            )}
          </div>
          <div className="k">Deadline</div>
          <div className="v">
            <InlineDate value={f.deadline} onSave={(deadline) => set({ deadline })} />
            <InlineSelect
              value={f.deadline_type}
              options={DEADLINE_TYPES}
              labels={{ fixed: "Fixed", rolling: "Rolling", loi: "LOI" }}
              onSave={(deadline_type) => set({ deadline_type })}
            />
          </div>
          <div className="k">Requested</div>
          <div className="v">
            <InlineNumber value={f.amount_requested} prefix="$" placeholder="Empty" onSave={(amount_requested) => set({ amount_requested })} />
          </div>
          <div className="k">Max award</div>
          <div className="v">
            <InlineNumber value={f.max_award} prefix="$" placeholder="Empty" onSave={(max_award) => set({ max_award })} />
          </div>
          {(f.status === "awarded" || f.amount_awarded !== null) && (
            <>
              <div className="k">Awarded</div>
              <div className="v">
                <InlineNumber value={f.amount_awarded} prefix="$" placeholder="Empty" onSave={(amount_awarded) => set({ amount_awarded })} />
              </div>
            </>
          )}
          <div className="k">Currency</div>
          <div className="v">
            <InlineText value={f.currency} onSave={(currency) => set({ currency: currency.toUpperCase() || "USD" })} />
          </div>
          <div className="k">Project</div>
          <div className="v">
            <InlineText value={f.project} placeholder="Empty" onSave={(project) => set({ project })} />
          </div>
          <div className="k">Location</div>
          <div className="v">
            <InlineText value={f.location} placeholder="Empty" onSave={(location) => set({ location })} />
          </div>
          <div className="k">Tags</div>
          <div className="v">
            <TagInput value={f.tags} suggestions={tags} onSave={(t) => set({ tags: t })} />
          </div>
          <div className="k">Submitted</div>
          <div className="v">
            <InlineDate value={f.submitted_on} onSave={(submitted_on) => set({ submitted_on })} />
          </div>
          <div className="k">Decision expected</div>
          <div className="v">
            <InlineDate value={f.decision_expected} onSave={(decision_expected) => set({ decision_expected })} />
          </div>
          <div className="k">Decision on</div>
          <div className="v">
            <InlineDate value={f.decision_on} onSave={(decision_on) => set({ decision_on })} />
          </div>
          {extras.map((k) => (
            <ExtraField key={k} k={k} value={f[k]} onSave={(v) => set({ [k]: v } as Partial<GrantFM>)} />
          ))}
        </div>
      </section>

      {(f.status === "awarded" || f.reports.length > 0) && <Reports g={g} />}

      <Questions g={g} />

      <BudgetSummary g={g} />

      <section>
        <h3>Eligibility</h3>
        <InlineText multiline value={bodySection(g.body, "Eligibility")} placeholder="Who can apply, what's required…" onSave={(v) => setBody("Eligibility", v)} />
      </section>

      <section>
        <h3>Notes</h3>
        <InlineText multiline value={bodySection(g.body, "Notes")} placeholder="Anything worth remembering" onSave={(v) => setBody("Notes", v)} />
      </section>

      <Todoist g={g} />
      <Attachments folder={folder} />

      <section>
        <h3>Status history</h3>
        <div className="stack" style={{ gap: 4 }}>
          {[...f.status_history].reverse().map((h, i) => (
            <div key={i} className="row small">
              <span className="muted num" style={{ width: 100 }}>
                {fmtDate(h.date, { year: true })}
              </span>
              <StatusPill status={h.status} />
            </div>
          ))}
        </div>
      </section>

      <section className="row">
        <span className="muted small grow">
          grants/{folder}/grant.md · created {fmtDate(f.created, { year: true })}
        </span>
        <button
          className="btn small danger"
          onClick={async () => {
            if (await confirmAction("Move this application to trash?", "It goes to .manyapply/trash/ in your vault, so nothing is lost.", { okLabel: "Move to trash", danger: true }))
              await del(folder);
          }}
        >
          Delete
        </button>
      </section>
    </div>
  );
}

function ExtraField({ k, value, onSave }: { k: string; value: unknown; onSave: (v: unknown) => void }) {
  const isObj = value !== null && typeof value === "object";
  return (
    <>
      <div className="k" title="Extra field (kept from an import or a hand edit)">
        {k.replace(/_/g, " ")}
      </div>
      <div className="v">
        {isObj ? (
          <code className="small">{JSON.stringify(value)}</code>
        ) : (
          <InlineText value={value === null || value === undefined ? "" : String(value)} onSave={(v) => onSave(v)} />
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Questions

function Questions({ g }: { g: Grant }) {
  const fs = useStore((s) => s.fs);
  const library = useStore((s) => s.data?.library ?? []);
  const update = useStore((s) => s.updateGrant);
  const mutate = useStore((s) => s.mutate);
  const go = useStore((s) => s.go);
  const openDrawer = useStore((s) => s.openDrawer);
  const qs = useMemo(() => parseQuestions(g.body), [g.body]);
  const [counts, setCounts] = useState<Record<string, { words: number; chars: number }>>({});
  const [adding, setAdding] = useState(false);
  const [openSug, setOpenSug] = useState<string | null>(null);

  useEffect(() => {
    if (!fs) return;
    let live = true;
    void Promise.all(
      qs.filter((q) => q.draft).map(async (q) => {
        const t = await readDraft(fs, g.folder, q.draft!);
        return [q.draft!, { words: wordCount(t), chars: t.trim().length }] as const;
      }),
    ).then((r) => live && setCounts(Object.fromEntries(r)));
    return () => {
      live = false;
    };
  }, [fs, g.folder, g.lastEdited, qs]);

  const ensureDraft = async (q: Question): Promise<string> => {
    if (q.draft) return q.draft;
    const path = `drafts/${q.number.padStart(2, "0")}-${slugify(q.title, 40)}.md`;
    await update(g.folder, (x) => ({
      ...x,
      body: x.body.replace(
        new RegExp(`(^###\\s+(?:${q.number}[.)]\\s*)?${q.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$)`, "m"),
        `$1\nDraft: ${path}`,
      ),
    }));
    return path;
  };

  const openDraft = async (q: Question) => {
    const path = await ensureDraft(q);
    const folder = g.folder;
    if (!(await fs!.exists(`grants/${folder}/${path}`))) await mutate((f) => f.writeText(`grants/${folder}/${path}`, ""));
    go({ screen: "draft", folder, draft: path });
  };

  return (
    <section>
      <h3>
        Questions <span className="spacer" />
        <button className="btn small ghost" onClick={() => setAdding(true)}>
          + Add question
        </button>
      </h3>
      {qs.length === 0 && <p className="muted small">No questions yet. Add the application's questions to track word counts and drafts.</p>}
      <div className="stack" style={{ gap: 6 }}>
        {qs.map((q) => {
          const c = q.draft ? counts[q.draft] : undefined;
          const n = q.limitUnit === "characters" ? c?.chars ?? 0 : c?.words ?? 0;
          const sugs = suggestFor(q.title, library, g.fm.client);
          const key = q.number + q.title;
          return (
            <div key={key} className="panel" style={{ padding: "10px 12px" }}>
              <div className="row">
                <span className="muted num">{q.number}.</span>
                <span className="grow" style={{ fontWeight: 550 }}>
                  {q.title}
                </span>
                <WordMeter count={n} limit={q.limit} unit={q.limitUnit} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => openDraft(q)}>
                  {q.draft && c && (c.words > 0) ? "Open draft" : "Start draft"}
                </button>
                {sugs.length > 0 && (
                  <button className="btn small ghost" onClick={() => setOpenSug(openSug === key ? null : key)}>
                    {sugs.length} from Library {openSug === key ? "▴" : "▾"}
                  </button>
                )}
                <span className="grow" />
                {q.draft && <span className="muted small ellipsis">{q.draft}</span>}
              </div>
              {openSug === key && (
                <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                  {sugs.map((s) => (
                    <div key={s.item.path} className="row small" style={{ padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); openDrawer({ kind: "library", id: s.item.path }); }} className="grow ellipsis">
                        {s.item.fm.title}
                      </a>
                      <span className="muted">{s.shared ? "Shared" : "Client"} · {s.item.fm.word_count} words</span>
                    </div>
                  ))}
                  <span className="muted small">Open the draft and use "Insert from Library" to copy one in.</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {adding && (
        <AddQuestion
          next={qs.length + 1}
          onClose={() => setAdding(false)}
          onAdd={async (title, limit, unit) => {
            const n = String(qs.length + 1);
            const draft = `drafts/${n.padStart(2, "0")}-${slugify(title, 40)}.md`;
            await update(g.folder, (x) => ({ ...x, body: addQuestionToBody(x.body, { title: `${n}. ${title}`, limit, unit, draft }) }));
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}

function AddQuestion({ next, onClose, onAdd }: { next: number; onClose: () => void; onAdd: (t: string, l: number | null, u: string) => void }) {
  const [title, setTitle] = useState("");
  const [limit, setLimit] = useState("");
  const [unit, setUnit] = useState("words");
  return (
    <Modal
      title={`Question ${next}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim()} onClick={() => onAdd(title.trim(), limit ? parseInt(limit, 10) : null, unit)}>
            Add question
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          Question
          <input className="input" autoFocus value={title} placeholder="Project description" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="row">
          <label className="field grow">
            Limit (optional)
            <input className="input" inputMode="numeric" value={limit} placeholder="500" onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="field">
            &nbsp;
            <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="words">words</option>
              <option value="characters">characters</option>
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Reports

function Reports({ g }: { g: Grant }) {
  const update = useStore((s) => s.updateGrant);
  const addReport = useStore((s) => s.addReport);
  const [adding, setAdding] = useState(false);
  const setReport = (i: number, patch: Partial<ReportDate>) =>
    update(g.folder, (x) => ({ ...x, fm: { ...x.fm, reports: x.fm.reports.map((r, j) => (j === i ? { ...r, ...patch } : r)) } }));
  return (
    <section>
      <h3>
        Reports <span className="spacer" />
        <button className="btn small" onClick={() => setAdding(true)}>
          + Add reporting date
        </button>
      </h3>
      {g.fm.reports.length === 0 && (
        <div className="callout small">Got your reporting dates? Add them here, whenever they arrive. Usually they're in the award email.</div>
      )}
      <div className="stack" style={{ gap: 6 }}>
        {g.fm.reports.map((r, i) => (
          <div key={i} className="panel" style={{ padding: "8px 12px" }}>
            <div className="row">
              <label className="check" title={r.submitted_on ? `Submitted ${r.submitted_on}` : "Mark as submitted"}>
                <input type="checkbox" checked={!!r.submitted_on} onChange={(e) => setReport(i, { submitted_on: e.target.checked ? todayISO() : null })} />
              </label>
              <div className="grow">
                <InlineText value={r.title} onSave={(title) => setReport(i, { title: title || "Report" })} />
              </div>
              <div style={{ width: 150 }}>
                <InlineDate value={r.due} onSave={(due) => setReport(i, { due })} />
              </div>
              <button
                className="icon-btn"
                title="Remove"
                onClick={async () => (await confirmAction("Remove this reporting date?")) && update(g.folder, (x) => ({ ...x, fm: { ...x.fm, reports: x.fm.reports.filter((_, j) => j !== i) } }))}
              >
                ×
              </button>
            </div>
            <InlineText multiline value={r.notes ?? ""} placeholder="Notes: where this date came from (paste the email text)" onSave={(notes) => setReport(i, { notes })} />
            {r.todoist_task_id && <span className="muted small">In Todoist</span>}
          </div>
        ))}
      </div>
      {adding && (
        <AddReport
          onClose={() => setAdding(false)}
          onAdd={async (r) => {
            setAdding(false);
            await addReport(g.folder, r);
          }}
        />
      )}
    </section>
  );
}

function AddReport({ onClose, onAdd }: { onClose: () => void; onAdd: (r: ReportDate) => void }) {
  const [title, setTitle] = useState("Final report");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Modal
      title="Add reporting date"
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!due} onClick={() => onAdd({ title: title.trim() || "Report", due, notes: notes.trim() || null, submitted_on: null, todoist_task_id: null })}>
            Add
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <label className="field grow">
            Report
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} list="report-titles" />
            <datalist id="report-titles">
              <option value="Interim report" />
              <option value="Final report" />
              <option value="Financial report" />
              <option value="Narrative report" />
            </datalist>
          </label>
          <label className="field">
            Due
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <label className="field">
          Notes (optional)
          <textarea className="textarea" value={notes} placeholder="Paste the award email text, or where this date came from" onChange={(e) => setNotes(e.target.value)} />
        </label>
        <span className="muted small">If Todoist is connected, a task is added for the due date, plus a reminder before it.</span>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Budget summary

function BudgetSummary({ g }: { g: Grant }) {
  const fs = useStore((s) => s.fs);
  const go = useStore((s) => s.go);
  const [totals, setTotals] = useState<ReturnType<typeof budgetTotals> | null>(null);
  useEffect(() => {
    if (!fs) return;
    let live = true;
    fs.readText(`grants/${g.folder}/budget.csv`)
      .then((t) => live && setTotals(budgetTotals(parseBudgetCsv(t))))
      .catch(() => live && setTotals(null));
    return () => {
      live = false;
    };
  }, [fs, g.folder, g.lastEdited]);
  const req = g.fm.amount_requested;
  const max = g.fm.max_award;
  const c = g.fm.currency;
  return (
    <section>
      <h3>
        Budget <span className="spacer" />
        <button className="btn small" onClick={() => go({ screen: "budget", folder: g.folder })}>
          {totals ? "Open budget" : "Build budget"}
        </button>
      </h3>
      {totals ? (
        <div className="totals small">
          <span className="soft">Total expenses</span>
          <span className="num">{fmtMoney(totals.expenses, c)}</span>
          <span className="soft">Total income</span>
          <span className="num">{fmtMoney(totals.income, c)}</span>
          <span className="soft">Gap</span>
          <span className="num">{fmtMoney(totals.gap, c)}</span>
          <span className="soft">Requested</span>
          <span className="num">{fmtMoney(req, c)}</span>
          <span className="soft">Funder's max</span>
          <span className="num">{fmtMoney(max, c)}</span>
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>No budget yet.</p>
      )}
      {req !== null && max !== null && req > max && (
        <div className="callout warn small" style={{ marginTop: 8 }}>
          The request ({fmtMoney(req, c)}) is over the funder's max ({fmtMoney(max, c)}).
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Todoist & attachments

function Todoist({ g }: { g: Grant }) {
  const createTasks = useStore((s) => s.createPlanningTasks);
  const ids = g.fm.todoist_task_ids;
  return (
    <section>
      <h3>Todoist</h3>
      {ids.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          {g.fm.status === "researching"
            ? "Tasks are created when this moves to Planning (if Todoist is connected in Settings)."
            : "No linked tasks."}
          {g.fm.status === "planning" && g.fm.deadline && (
            <>
              {" "}
              <a href="#" onClick={(e) => { e.preventDefault(); void createTasks(g.folder, true); }}>
                Create tasks now
              </a>
            </>
          )}
        </p>
      ) : (
        <div className="row wrap small">
          {ids.map((id) => (
            <a key={id} href="#" onClick={(e) => { e.preventDefault(); openExternalSafe(`https://app.todoist.com/app/task/${id}`); }}>
              Task {id.slice(-6)}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function Attachments({ folder }: { folder: string }) {
  const fs = useStore((s) => s.fs);
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    if (fs) void listAttachments(fs, folder).then(setFiles).catch(() => setFiles([]));
  }, [fs, folder]);
  return (
    <section>
      <h3>Attachments</h3>
      {files.length ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Put work samples and award letters in <code>grants/{folder}/attachments/</code>.
        </p>
      )}
    </section>
  );
}

