import { useState, type ReactNode } from "react";
import { useLookups, useStore } from "../store";
import type { Grant } from "../lib/model";
import { STATUSES, clientsOf } from "../lib/model";
import { ClientLabels, DeadlineText, StatusPill } from "./ui";
import { fmtMoney } from "../lib/util";

type Col = "title" | "funder" | "status" | "deadline" | "amount" | "client" | "type";

export function GrantTable({ grants, extra }: { grants: Grant[]; extra?: (g: Grant) => ReactNode }) {
  const open = useStore((s) => s.openDrawer);
  const update = useStore((s) => s.updateGrant);
  const { funderName, clientName } = useLookups();
  const hasClients = useStore((s) => (s.data?.clients.length ?? 0) > 1 && !s.clientFilter);
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "deadline", dir: 1 });

  const val = (g: Grant, c: Col): string | number => {
    switch (c) {
      case "title": return g.fm.title.toLowerCase();
      case "funder": return funderName(g.fm.funder).toLowerCase();
      case "status": return STATUSES.indexOf(g.fm.status);
      case "deadline": return g.fm.deadline || "9999";
      case "amount": return g.fm.amount_awarded ?? g.fm.amount_requested ?? -1;
      case "client": return clientsOf(g.fm).map(clientName).join(", ").toLowerCase();
      case "type": return g.fm.type;
    }
  };
  const rows = [...grants].sort((a, b) => {
    const x = val(a, sort.col), y = val(b, sort.col);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  const th = (c: Col, label: string, cls = "") => (
    <th className={`sortable ${cls}`} onClick={() => setSort({ col: c, dir: sort.col === c ? (-sort.dir as 1 | -1) : 1 })}>
      {label} {sort.col === c ? (sort.dir === 1 ? "↑" : "↓") : ""}
    </th>
  );
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 28 }} />
            {th("title", "Title")}
            {th("funder", "Funder")}
            {hasClients && th("client", "For")}
            {th("type", "Type")}
            {th("deadline", "Deadline")}
            {th("amount", "Amount", "r")}
            {th("status", "Status")}
            {extra && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.folder} className="click" onClick={() => open({ kind: "grant", id: g.folder })}>
              <td>
                <button
                  className={`icon-btn ${g.fm.starred ? "star" : ""}`}
                  style={{ width: 22, height: 22 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void update(g.folder, (x) => ({ ...x, fm: { ...x.fm, starred: !x.fm.starred } }));
                  }}
                >
                  {g.fm.starred ? "★" : "☆"}
                </button>
              </td>
              <td style={{ fontWeight: 550 }}>{g.fm.title}</td>
              <td className="soft">{funderName(g.fm.funder)}</td>
              {hasClients && (
                <td>
                  <ClientLabels fm={g.fm} />
                </td>
              )}
              <td className="soft">{g.fm.type}</td>
              <td className="small">
                <DeadlineText g={g} />
              </td>
              <td className="r num">{fmtMoney(g.fm.amount_awarded ?? g.fm.amount_requested ?? g.fm.max_award, g.fm.currency)}</td>
              <td>
                <StatusPill status={g.fm.status} />
              </td>
              {extra && <td onClick={(e) => e.stopPropagation()}>{extra(g)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
