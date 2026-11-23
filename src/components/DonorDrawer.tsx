import { useState } from "react";
import { useLookups, useStore } from "../store";
import { ClientMultiSelect, InlineDate, InlineText, TagInput } from "./ui";
import { confirmAction } from "./dialogs";
import { DONOR_STAGES, DONOR_STAGE_LABEL, TOUCH_KINDS, giftTo, looksLapsed, summarize, type Donor, type Gift, type Touch } from "../lib/donors";
import { fmtDate, fmtMoney, parseNumber, todayISO } from "../lib/util";
import { StagePill } from "../screens/Giving";

export function DonorDrawer({ slug }: { slug: string }) {
  const d = useStore((s) => s.data?.donors.find((x) => x.slug === slug));
  const allDonors = useStore((s) => s.data?.donors ?? []);
  const currency = useStore((s) => s.data?.settings.currency ?? "USD");
  const save = useStore((s) => s.saveDonor);
  const del = useStore((s) => s.deleteDonor);
  if (!d) return <p className="muted">This donor isn't in the vault any more.</p>;
  const set = (patch: Partial<Donor["fm"]>) => save({ ...d, fm: { ...d.fm, ...patch } });
  const s = summarize(d);
  const tagSuggestions = [...new Set(allDonors.flatMap((x) => x.fm.tags))].sort();

  return (
    <div>
      <InlineText className="drawer-title" value={d.fm.name} onSave={(name) => name && set({ name })} />
      <div className="row wrap" style={{ marginTop: 8 }}>
        <select className="select" style={{ width: "auto" }} aria-label="Stage" value={d.fm.stage} onChange={(e) => set({ stage: e.target.value as Donor["fm"]["stage"] })}>
          {DONOR_STAGES.map((x) => <option key={x} value={x}>{DONOR_STAGE_LABEL[x]}</option>)}
        </select>
        <StagePill stage={d.fm.stage} />
        {d.fm.stage !== "lapsed" && looksLapsed(d) && (
          <button className="btn small ghost" onClick={() => set({ stage: "lapsed" })}>No gift in 18 months · mark lapsed?</button>
        )}
      </div>
      <p className="muted small">
        {fmtMoney(s.lifetime, currency)} lifetime · {d.fm.gifts.length} gift{d.fm.gifts.length === 1 ? "" : "s"}
        {s.largest ? ` · largest ${fmtMoney(s.largest, currency)}` : ""}
        {s.lastTouch ? ` · last contact ${fmtDate(s.lastTouch, { year: true })}` : ""}
      </p>

      <section>
        <h3>Next follow-up</h3>
        <div className="props">
          <div className="k">Date</div>
          <div className="v"><InlineDate value={d.fm.next_followup} onSave={(next_followup) => set({ next_followup })} /></div>
          <div className="k">What to do</div>
          <div className="v"><InlineText value={d.fm.next_step} placeholder="e.g. Invite to the spring showing" onSave={(next_step) => set({ next_step })} /></div>
        </div>
      </section>

      <section>
        <h3>Contact</h3>
        <div className="props">
          <div className="k">Gave to</div>
          <div className="v"><ClientMultiSelect value={d.fm.gave_to} label="Add who they gave to" onChange={(gave_to) => set({ gave_to })} /></div>
          <div className="k">Email</div>
          <div className="v"><InlineText type="email" value={d.fm.email} placeholder="Empty" onSave={(email) => set({ email })} /></div>
          <div className="k">Phone</div>
          <div className="v"><InlineText value={d.fm.phone} placeholder="Empty" onSave={(phone) => set({ phone })} /></div>
          <div className="k">Address</div>
          <div className="v"><InlineText multiline value={d.fm.address} placeholder="For thank-you letters" onSave={(address) => set({ address })} /></div>
          <div className="k">Organization</div>
          <div className="v"><InlineText value={d.fm.organization} placeholder="Employer, family foundation…" onSave={(organization) => set({ organization })} /></div>
          <div className="k">Tags</div>
          <div className="v"><TagInput value={d.fm.tags} suggestions={tagSuggestions} onSave={(tags) => set({ tags })} /></div>
        </div>
      </section>

      <Gifts d={d} currency={currency} onChange={(gifts, stage) => set(stage ? { gifts, stage } : { gifts })} />
      <Touches d={d} onChange={(touches) => set({ touches })} />

      <section>
        <h3>Notes</h3>
        <InlineText multiline value={d.body} placeholder="Interests, family, how you met, what they care about" onSave={(body) => save({ ...d, body })} />
      </section>

      <section className="row">
        <span className="muted small grow">donors/{slug}.md · added {fmtDate(d.fm.created, { year: true })}</span>
        <button
          className="btn small danger"
          title="Moves it to .manyapply/trash/ in your vault. You can undo."
          onClick={() => void del(slug)}
        >
          Delete
        </button>
      </section>
    </div>
  );
}

const byDateDesc = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => b.date.localeCompare(a.date));

function Gifts({ d, currency, onChange }: { d: Donor; currency: string; onChange: (g: Gift[], stage?: Donor["fm"]["stage"]) => void }) {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const clientFilter = useStore((s) => s.clientFilter);
  const { clientName } = useLookups();
  const many = d.fm.gave_to.length > 1 || d.fm.gifts.some((g) => g.to && g.to !== d.fm.gave_to[0]);
  const defaultTo = d.fm.gave_to.includes(clientFilter) ? clientFilter : d.fm.gave_to[0];
  const [to, setTo] = useState(defaultTo);
  const gifts = d.fm.gifts;
  const patch = (i: number, p: Partial<Gift>) => onChange(gifts.map((g, j) => (j === i ? { ...g, ...p } : g)));
  const amt = parseNumber(amount);

  return (
    <section>
      <h3>
        Gifts <span className="spacer" />
        {!adding && <button className="btn small" onClick={() => setAdding(true)}>+ Log a gift</button>}
      </h3>
      {adding && (
        <div className="panel stack" style={{ padding: 12, marginBottom: 8 }}>
          <div className="row">
            <label className="field">
              Date
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field grow">
              Amount
              <input className="input" inputMode="decimal" autoFocus placeholder="250" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="field grow">
              Method
              <input className="input" list="gift-methods" placeholder="Check" value={method} onChange={(e) => setMethod(e.target.value)} />
              <datalist id="gift-methods">
                <option value="Check" /><option value="Cash" /><option value="Card" /><option value="Venmo" /><option value="PayPal" />
                <option value="Bank transfer" /><option value="Stock" /><option value="In-kind" /><option value="Fiscal sponsor" />
              </datalist>
            </label>
          </div>
          <div className="row">
            {d.fm.gave_to.length > 1 && (
              <label className="field">
                For
                <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
                  {d.fm.gave_to.map((c) => <option key={c} value={c}>{clientName(c)}</option>)}
                </select>
              </label>
            )}
            <label className="field grow">
              Note (optional)
              <input className="input" placeholder="For the spring production" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <span className="grow" />
            <button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button
              className="btn primary"
              disabled={!amt || !date}
              onClick={() => {
                const next = byDateDesc([...gifts, { date, amount: amt!, method: method.trim(), note: note.trim(), acknowledged: false, to: d.fm.gave_to.includes(to) ? to : d.fm.gave_to[0] }]);
                const stage = d.fm.stage === "prospect" ? (gifts.length === 0 ? "first-time" : "active") : d.fm.stage === "first-time" || d.fm.stage === "lapsed" ? "active" : d.fm.stage;
                onChange(next, stage !== d.fm.stage ? stage : undefined);
                setAdding(false);
                setAmount("");
                setMethod("");
                setNote("");
                setDate(todayISO());
              }}
            >
              Save gift
            </button>
          </div>
        </div>
      )}
      {gifts.length === 0 && !adding && <p className="muted small" style={{ margin: 0 }}>No gifts logged yet.</p>}
      {gifts.length > 0 && (
        <table className="table small">
          <thead>
            <tr><th>Date</th><th className="r">Amount</th>{many && <th>For</th>}<th>Method / note</th><th title="Thank-you sent">Thanked</th><th /></tr>
          </thead>
          <tbody>
            {gifts.map((g, i) => (
              <tr key={i}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>{fmtDate(g.date, { year: true })}</td>
                <td className="r num">{fmtMoney(g.amount, currency)}</td>
                {many && (
                  <td>
                    <select className="select inline" style={{ width: "auto", minWidth: 96, maxWidth: 150 }} aria-label="Gift was for" value={giftTo(d, g)} onChange={(e) => patch(i, { to: e.target.value })}>
                      {[...new Set([...d.fm.gave_to, giftTo(d, g)])].map((c) => <option key={c} value={c}>{clientName(c)}</option>)}
                    </select>
                  </td>
                )}
                <td className="soft">{[g.method, g.note].filter(Boolean).join(" · ")}</td>
                <td>
                  <label className="check">
                    <input type="checkbox" checked={g.acknowledged} onChange={(e) => patch(i, { acknowledged: e.target.checked })} />
                  </label>
                </td>
                <td className="r">
                  <button
                    className="icon-btn"
                    title="Remove gift"
                    onClick={async () => (await confirmAction("Remove this gift?", `${fmtMoney(g.amount, currency)} on ${fmtDate(g.date, { year: true })}`)) && onChange(gifts.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Touches({ d, onChange }: { d: Donor; onChange: (t: Touch[]) => void }) {
  const [kind, setKind] = useState<string>("email");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const touches = d.fm.touches;
  const add = () => {
    if (!note.trim()) return;
    onChange(byDateDesc([...touches, { date, kind, note: note.trim() }]));
    setNote("");
    setDate(todayISO());
  };
  return (
    <section>
      <h3>Contact log</h3>
      <div className="row" style={{ marginBottom: 8 }}>
        <select className="select" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          {TOUCH_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input className="input" type="date" style={{ width: "auto" }} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <input
          className="input grow"
          placeholder="What happened? (Enter to add)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn small" disabled={!note.trim()} onClick={add}>Add</button>
      </div>
      {touches.length === 0 && <p className="muted small" style={{ margin: 0 }}>No calls, emails or meetings logged yet.</p>}
      <div className="stack" style={{ gap: 4 }}>
        {touches.map((t, i) => (
          <div key={i} className="row small" style={{ alignItems: "flex-start" }}>
            <span className="muted num" style={{ width: 96, flex: "none" }}>{fmtDate(t.date, { year: true })}</span>
            <span className="tag" style={{ flex: "none" }}>{t.kind}</span>
            <span className="grow">{t.note}</span>
            <button className="icon-btn" title="Remove" onClick={() => onChange(touches.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
      </div>
    </section>
  );
}
