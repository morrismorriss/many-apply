import { useStore } from "../store";
import { FUNDER_TYPES, type Funder } from "../lib/model";
import { funderStats } from "../lib/stats";
import { fmtDate, fmtMoney } from "../lib/util";
import { openExternal } from "../lib/platform";
import { ClientLabel, InlineText, StatusPill } from "./ui";

export function FunderDrawer({ slug }: { slug: string }) {
  const funder = useStore((s) => s.data?.funders.find((f) => f.slug === slug));
  const grants = useStore((s) => s.data?.grants ?? []);
  const save = useStore((s) => s.saveFunder);
  const open = useStore((s) => s.openDrawer);
  if (!funder) return <p className="muted">This funder isn't in the vault any more.</p>;
  const st = funderStats(funder, grants);
  const set = (patch: Partial<Funder["fm"]>) => save({ ...funder, fm: { ...funder.fm, ...patch } });
  return (
    <div>
      <InlineText className="drawer-title" value={funder.fm.name} onSave={(name) => name && set({ name })} />
      <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 16 }}>
        <div className="stat">
          <div className="v">{st.applied}</div>
          <div className="k">Applied</div>
        </div>
        <div className="stat">
          <div className="v">{fmtMoney(st.awarded, "USD", true)}</div>
          <div className="k">Awarded</div>
        </div>
        <div className="stat">
          <div className="v">{st.winRate === null ? "—" : `${Math.round(st.winRate * 100)}%`}</div>
          <div className="k">Win rate</div>
        </div>
      </div>
      <section>
        <div className="props">
          <div className="k">Website</div>
          <div className="v">
            <InlineText value={funder.fm.website} placeholder="https://" onSave={(website) => set({ website })} />
            {funder.fm.website && (
              <button className="icon-btn" onClick={() => openExternal(funder.fm.website)} title="Open">
                ↗
              </button>
            )}
          </div>
          <div className="k">Type</div>
          <div className="v">
            <select className="inline" value={funder.fm.funder_type} onChange={(e) => set({ funder_type: e.target.value })}>
              <option value="">—</option>
              {FUNDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="k">Contacts</div>
          <div className="v">
            <InlineText multiline value={funder.fm.contacts} placeholder="Program officer, email, phone" onSave={(contacts) => set({ contacts })} />
          </div>
          <div className="k">Notes</div>
          <div className="v">
            <InlineText multiline value={funder.fm.notes} placeholder="What they like, what they've said" onSave={(notes) => set({ notes })} />
          </div>
        </div>
      </section>
      <section>
        <h3>Applications to this funder</h3>
        {st.grants.length === 0 ? (
          <p className="muted small">Nothing sent yet.</p>
        ) : (
          <table className="table">
            <tbody>
              {st.grants.map((g) => (
                <tr key={g.folder} className="click" onClick={() => open({ kind: "grant", id: g.folder })}>
                  <td>
                    {g.fm.title} <ClientLabel slug={g.fm.client} hideMe />
                  </td>
                  <td className="muted small">{fmtDate(g.fm.deadline, { year: true })}</td>
                  <td className="r num">{fmtMoney(g.fm.amount_awarded ?? g.fm.amount_requested, g.fm.currency)}</td>
                  <td>
                    <StatusPill status={g.fm.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="muted small" style={{ marginTop: 24 }}>funders/{slug}.md</p>
    </div>
  );
}
