import { libraryBudgetName } from "../lib/budget";
import { useStore } from "../store";
import { CLIENT_TYPES, ME, type Client } from "../lib/model";
import { fmtMoney } from "../lib/util";
import { zipClient } from "../lib/backup";
import { saveFile } from "../lib/platform";
import { InlineNumber, InlineText, StatusPill } from "./ui";

export function ClientDrawer({ slug }: { slug: string }) {
  const client = useStore((s) => s.data?.clients.find((c) => c.slug === slug));
  const grants = useStore((s) => s.data?.grants ?? []).filter((g) => g.fm.client === slug);
  const templates = useStore((s) => s.data?.budgetTemplates ?? []);
  const save = useStore((s) => s.saveClient);
  const open = useStore((s) => s.openDrawer);
  const fs = useStore((s) => s.fs);
  const toast = useStore((s) => s.toast);
  if (!client) return <p className="muted">This client isn't in the vault any more.</p>;
  const set = (patch: Partial<Client["fm"]>) => save({ ...client, fm: { ...client.fm, ...patch } });
  const requested = grants.reduce((s, g) => s + (g.fm.amount_requested ?? 0), 0);
  const awarded = grants.filter((g) => g.fm.status === "awarded").reduce((s, g) => s + (g.fm.amount_awarded ?? 0), 0);

  return (
    <div>
      <div className="row">
        <input
          type="color"
          value={client.fm.color}
          title="Label color"
          onChange={(e) => set({ color: e.target.value })}
          style={{ width: 28, height: 28, border: 0, background: "none", padding: 0, cursor: "pointer" }}
        />
        <InlineText className="drawer-title" value={client.fm.name} onSave={(name) => name && set({ name })} />
      </div>
      <p className="muted small">
        {grants.length} applications · {fmtMoney(requested)} requested · {fmtMoney(awarded)} awarded
      </p>
      <section>
        <div className="props">
          <div className="k">Type</div>
          <div className="v">
            <select className="inline" value={client.fm.type} onChange={(e) => set({ type: e.target.value })}>
              {CLIENT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="k">Contact person</div>
          <div className="v"><InlineText value={client.fm.contact_person} placeholder="Empty" onSave={(contact_person) => set({ contact_person })} /></div>
          <div className="k">Email</div>
          <div className="v"><InlineText type="email" value={client.fm.contact_email} placeholder="Empty" onSave={(contact_email) => set({ contact_email })} /></div>
          <div className="k">Website</div>
          <div className="v"><InlineText value={client.fm.website} placeholder="https://" onSave={(website) => set({ website })} /></div>
          <div className="k">Mission (short)</div>
          <div className="v"><InlineText multiline value={client.fm.mission} placeholder="One or two sentences" onSave={(mission) => set({ mission })} /></div>
          <div className="k">Fiscal year starts</div>
          <div className="v"><InlineText value={client.fm.fiscal_year_start} placeholder="e.g. 07-01" onSave={(fiscal_year_start) => set({ fiscal_year_start })} /></div>
          <div className="k">Annual budget</div>
          <div className="v"><InlineNumber value={client.fm.annual_budget} prefix="$" placeholder="Empty" onSave={(annual_budget) => set({ annual_budget })} /></div>
          <div className="k">Fiscal sponsor</div>
          <div className="v"><InlineText value={client.fm.fiscal_sponsor} placeholder="None" onSave={(fiscal_sponsor) => set({ fiscal_sponsor })} /></div>
        </div>
        <p className="muted small">Profile fields can be inserted into any draft from the editor's "Insert field" menu.</p>
      </section>
      <section>
        <h3>Defaults</h3>
        <div className="props">
          <div className="k">Default budget</div>
          <div className="v">
            <select className="inline" value={client.fm.budget_template} onChange={(e) => set({ budget_template: e.target.value })}>
              <option value="">None</option>
              {templates.map((t) => (
                <option key={t} value={t}>{libraryBudgetName(t)}</option>
              ))}
            </select>
          </div>
          <div className="k">Todoist project</div>
          <div className="v">
            <InlineText value={client.fm.todoist_project_id} placeholder="Created automatically on first use" onSave={(todoist_project_id) => set({ todoist_project_id })} />
          </div>
        </div>
      </section>
      <section>
        <h3>Notes</h3>
        <InlineText multiline value={client.body} placeholder="Contract terms, preferences, who signs off" onSave={(body) => save({ ...client, body })} />
      </section>
      <section>
        <h3>Applications</h3>
        {grants.length === 0 && <p className="muted small">None yet.</p>}
        <table className="table">
          <tbody>
            {grants.map((g) => (
              <tr key={g.folder} className="click" onClick={() => open({ kind: "grant", id: g.folder })}>
                <td>{g.fm.title}</td>
                <td className="r num">{fmtMoney(g.fm.amount_awarded ?? g.fm.amount_requested)}</td>
                <td><StatusPill status={g.fm.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {slug !== ME && (
        <section>
          <h3>Hand over</h3>
          <button
            className="btn"
            onClick={async () => {
              const data = await zipClient(fs!, slug, grants.map((g) => g.folder));
              const p = await saveFile(`${slug}-many-apply.zip`, data, "application/zip");
              if (p) toast("Client folder saved");
            }}
          >
            Share client folder (.zip)
          </button>
          <p className="muted small">Zips this client's profile, applications and Library folder, for handing over at the end of a contract.</p>
        </section>
      )}
      <p className="muted small" style={{ marginTop: 24 }}>clients/{slug}.md</p>
    </div>
  );
}
