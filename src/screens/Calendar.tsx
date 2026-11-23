import { useState } from "react";
import { useGrants, useStore } from "../store";
import { calendarEvents, toICS, type CalEvent } from "../lib/stats";
import { addDays, fmtDate, MONTH_NAMES, toISO } from "../lib/util";
import { saveFile } from "../lib/platform";
import { ClientLabel, statusColor } from "../components/ui";

const KIND_LABEL: Record<CalEvent["kind"], string> = {
  deadline: "Deadline",
  submitted: "Submitted",
  decision: "Expected decision",
  report: "Report due",
};

function evColor(e: CalEvent) {
  if (e.kind === "report") return "var(--ev-report)";
  if (e.kind === "decision") return "var(--ev-decision)";
  if (e.kind === "submitted") return "var(--st-submitted)";
  return statusColor(e.grant.fm.status);
}

export function CalendarScreen() {
  const grants = useGrants();
  const open = useStore((s) => s.openDrawer);
  const toast = useStore((s) => s.toast);
  const keepIcs = useStore((s) => s.data!.settings.keepIcsUpdated);
  const [view, setView] = useState<"month" | "agenda">("month");
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [kinds, setKinds] = useState<Record<CalEvent["kind"], boolean>>({ deadline: true, submitted: true, decision: true, report: true });
  const events = calendarEvents(grants).filter((e) => kinds[e.kind]);
  const byDate = new Map<string, CalEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const today = toISO(new Date());

  const exportIcs = async () => {
    const p = await saveFile("many-apply.ics", toICS(calendarEvents(grants)), "text/calendar");
    if (p) toast("Calendar exported. Import or subscribe to it in Google or Apple Calendar.");
  };

  // Month grid (weeks start Sunday)
  const start = addDays(cursor, -cursor.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const lastRowNeeded = days.slice(35).some((d) => d.getMonth() === cursor.getMonth());
  const shown = lastRowNeeded ? days : days.slice(0, 35);

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <div className="sub">Deadlines, submissions, expected decisions and report due dates.</div>
        </div>
        <span className="spacer" />
        <div className="seg">
          <button className={view === "month" ? "on" : ""} onClick={() => setView("month")}>Month</button>
          <button className={view === "agenda" ? "on" : ""} onClick={() => setView("agenda")}>Agenda</button>
        </div>
        <button className="btn" onClick={exportIcs} title="Download an .ics file">
          Export .ics
        </button>
      </div>
      <div className="toolbar">
        {view === "month" && (
          <>
            <button className="btn small" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>←</button>
            <button className="btn small" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
            <button className="btn small" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>→</button>
            <h2 style={{ marginLeft: 8 }}>
              {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
            </h2>
          </>
        )}
        <span className="grow" />
        {(Object.keys(KIND_LABEL) as CalEvent["kind"][]).map((k) => (
          <label key={k} className="check small">
            <input type="checkbox" checked={kinds[k]} onChange={(e) => setKinds({ ...kinds, [k]: e.target.checked })} />
            <span className="label" style={{ ["--c" as string]: k === "report" ? "var(--ev-report)" : k === "decision" ? "var(--ev-decision)" : k === "submitted" ? "var(--st-submitted)" : "var(--st-planning)" }}>
              {KIND_LABEL[k]}
            </span>
          </label>
        ))}
      </div>
      {keepIcs && (
        <p className="muted small" style={{ marginTop: -6 }}>
          A live copy is kept at <code>.manyapply/calendar.ics</code> in your vault. If the vault is in iCloud or Dropbox, you can subscribe to that file.
        </p>
      )}

      {view === "month" ? (
        <div className="cal">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="dow">{d}</div>
          ))}
          {shown.map((d) => {
            const iso = toISO(d);
            const evs = byDate.get(iso) ?? [];
            return (
              <div key={iso} className={`day${d.getMonth() !== cursor.getMonth() ? " out" : ""}${iso === today ? " today" : ""}`}>
                <div className="n">{d.getDate()}</div>
                {evs.slice(0, 4).map((e, i) => (
                  <span
                    key={i}
                    className={`ev${e.done && e.kind !== "submitted" ? " done" : ""}`}
                    style={{ ["--c" as string]: evColor(e) }}
                    title={`${KIND_LABEL[e.kind]}: ${e.grant.fm.title}`}
                    onClick={() => open({ kind: "grant", id: e.grant.folder })}
                  >
                    {e.kind === "report" ? e.grant.fm.reports[e.reportIndex!]?.title + ": " : e.kind === "deadline" ? "" : KIND_LABEL[e.kind] + ": "}
                    {e.grant.fm.title}
                  </span>
                ))}
                {evs.length > 4 && <span className="muted small">+{evs.length - 4} more</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <Agenda events={events.filter((e) => e.date >= toISO(addDays(new Date(), -7)))} />
      )}
    </div>
  );
}

function Agenda({ events }: { events: CalEvent[] }) {
  const open = useStore((s) => s.openDrawer);
  const groups = new Map<string, CalEvent[]>();
  for (const e of events) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
  if (!events.length) return <p className="muted">Nothing coming up.</p>;
  return (
    <div className="panel">
      {[...groups.entries()].map(([date, evs]) => (
        <div key={date} className="agenda-day">
          <div>
            <div style={{ fontWeight: 600 }}>{fmtDate(date, { year: true })}</div>
            <div className="muted small">{new Date(date + "T12:00").toLocaleDateString("en-US", { weekday: "long" })}</div>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            {evs.map((e, i) => (
              <div key={i} className="row" style={{ cursor: "pointer" }} onClick={() => open({ kind: "grant", id: e.grant.folder })}>
                <span className="label" style={{ ["--c" as string]: evColor(e), minWidth: 120, textAlign: "center" }}>
                  {e.kind === "report" ? e.grant.fm.reports[e.reportIndex!]?.title : KIND_LABEL[e.kind]}
                </span>
                <span className={e.done && e.kind !== "submitted" ? "muted" : ""} style={{ textDecoration: e.done && e.kind !== "submitted" ? "line-through" : undefined }}>
                  {e.grant.fm.title}
                </span>
                <ClientLabel slug={e.grant.fm.client} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
