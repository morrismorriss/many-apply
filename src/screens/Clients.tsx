import { useStore } from "../store";
import { ACTIVE_STATUSES, DONE_STATUSES, isFor } from "../lib/model";
import { fmtDate, fmtMoney, toISO } from "../lib/util";
import { askText } from "../components/dialogs";

export function Clients() {
  const clients = useStore((s) => s.data!.clients);
  const grants = useStore((s) => s.data!.grants);
  const open = useStore((s) => s.openDrawer);
  const addClient = useStore((s) => s.addClient);
  const today = toISO(new Date());
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <div className="sub">Who you write for. Solo artists can ignore this: everything defaults to Me.</div>
        </div>
        <span className="spacer" />
        <button
          className="btn primary"
          onClick={async () => {
            const name = await askText("New client", { placeholder: "Organization or person" });
            if (name) open({ kind: "client", id: await addClient(name) });
          }}
        >
          + New client
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Type</th>
              <th className="r">Active</th>
              <th>Next deadline</th>
              <th className="r">Requested</th>
              <th className="r">Awarded</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const gs = grants.filter((g) => isFor(g.fm, c.slug));
              const next = gs
                .filter((g) => g.fm.deadline >= today && !DONE_STATUSES.includes(g.fm.status))
                .sort((a, b) => a.fm.deadline.localeCompare(b.fm.deadline))[0];
              return (
                <tr key={c.slug} className="click" onClick={() => open({ kind: "client", id: c.slug })}>
                  <td style={{ fontWeight: 550 }}>
                    <span className="label" style={{ ["--c" as string]: c.fm.color, marginRight: 8 }}>&nbsp;</span>
                    {c.fm.name}
                  </td>
                  <td className="soft">{c.fm.type}</td>
                  <td className="r num">{gs.filter((g) => ACTIVE_STATUSES.includes(g.fm.status)).length}</td>
                  <td className="small">{next ? `${fmtDate(next.fm.deadline)} · ${next.fm.title}` : <span className="muted">—</span>}</td>
                  <td className="r num">{fmtMoney(gs.filter((g) => !["researching", "withdrawn"].includes(g.fm.status)).reduce((s, g) => s + (g.fm.amount_requested ?? 0), 0))}</td>
                  <td className="r num">{fmtMoney(gs.filter((g) => g.fm.status === "awarded").reduce((s, g) => s + (g.fm.amount_awarded ?? 0), 0))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
