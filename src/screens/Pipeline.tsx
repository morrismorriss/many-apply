import { useState } from "react";
import { useGrants, useStore } from "../store";
import { GrantCard, statusColor } from "../components/ui";
import { GrantTable } from "../components/GrantTable";
import { QuickAdd } from "../components/QuickAdd";
import { STATUSES, STATUS_LABEL, type Status } from "../lib/model";
import { fmtMoney } from "../lib/util";

export function Pipeline() {
  const grants = useGrants();
  const setStatus = useStore((s) => s.setStatus);
  const [view, setView] = useState<"board" | "table">("board");
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [showClosed, setShowClosed] = useState(true);
  const [adding, setAdding] = useState(false);
  const cols = showClosed ? STATUSES : STATUSES.filter((s) => !["declined", "withdrawn"].includes(s));

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <div className="sub">Drag a card to change its status.</div>
        </div>
        <span className="spacer" />
        <label className="check small">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show declined & withdrawn
        </label>
        <div className="seg">
          <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}>Board</button>
          <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table</button>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ New</button>
      </div>
      {view === "table" ? (
        <GrantTable grants={grants.filter((g) => cols.includes(g.fm.status))} />
      ) : (
        <div className="board">
          {cols.map((s) => {
            const items = grants
              .filter((g) => g.fm.status === s)
              .sort((a, b) => (a.fm.deadline || "9999").localeCompare(b.fm.deadline || "9999"));
            const total = items.reduce((t, g) => t + ((s === "awarded" ? g.fm.amount_awarded : g.fm.amount_requested) ?? 0), 0);
            return (
              <div
                key={s}
                className={`column${over === s ? " drop" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(s);
                }}
                onDragLeave={() => setOver((o) => (o === s ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const folder = e.dataTransfer.getData("text/plain") || drag;
                  setOver(null);
                  setDrag(null);
                  if (folder) void setStatus(folder, s);
                }}
              >
                <div className="column-head">
                  <span className="pill" style={{ ["--c" as string]: statusColor(s) }}>{STATUS_LABEL[s]}</span>
                  <span className="n">{items.length}</span>
                  <span className="grow" />
                  {total > 0 && <span className="n small num">{fmtMoney(total, "USD", true)}</span>}
                </div>
                {items.map((g) => (
                  <GrantCard
                    key={g.folder}
                    g={g}
                    draggable
                    dragging={drag === g.folder}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", g.folder);
                      e.dataTransfer.effectAllowed = "move";
                      setDrag(g.folder);
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
      {adding && <QuickAdd status="planning" onClose={() => setAdding(false)} />}
    </div>
  );
}
