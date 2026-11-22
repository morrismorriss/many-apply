import { useState } from "react";
import { useGrants, useStore } from "../store";
import { Empty, GrantCard, useAllTags } from "../components/ui";
import { GrantTable } from "../components/GrantTable";
import { QuickAdd } from "../components/QuickAdd";
import { GRANT_TYPES, type Grant } from "../lib/model";
import { daysUntil } from "../lib/util";

export function Research() {
  const all = useGrants();
  const setStatus = useStore((s) => s.setStatus);
  const tags = useAllTags();
  const [view, setView] = useState<"cards" | "list">("cards");
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [type, setType] = useState("");
  const [when, setWhen] = useState("");
  const [starred, setStarred] = useState(false);

  const grants = all
    .filter((g) => g.fm.status === "researching")
    .filter((g) => !q || (g.fm.title + " " + g.fm.funder + " " + g.body).toLowerCase().includes(q.toLowerCase()))
    .filter((g) => !tag || g.fm.tags.includes(tag))
    .filter((g) => !type || g.fm.type === type)
    .filter((g) => !starred || g.fm.starred)
    .filter((g) => {
      if (!when) return true;
      const d = daysUntil(g.fm.deadline);
      if (when === "rolling") return g.fm.deadline_type === "rolling" || !g.fm.deadline;
      return d !== null && d >= 0 && d <= Number(when);
    })
    .sort((a, b) => Number(b.fm.starred) - Number(a.fm.starred) || (a.fm.deadline || "9999").localeCompare(b.fm.deadline || "9999"));

  const move = (g: Grant) => (
    <button className="btn small" onClick={() => setStatus(g.folder, "planning")}>
      Move to Pipeline →
    </button>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Research</h1>
          <div className="sub">Opportunities you're looking into. Move the good ones to the Pipeline.</div>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Quick add
        </button>
      </div>
      <div className="toolbar">
        <input className="input" style={{ width: 220 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {GRANT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="select" value={when} onChange={(e) => setWhen(e.target.value)}>
          <option value="">Any deadline</option>
          <option value="30">Next 30 days</option>
          <option value="90">Next 90 days</option>
          <option value="365">Next year</option>
          <option value="rolling">Rolling / none</option>
        </select>
        <label className="check small">
          <input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} /> Starred only
        </label>
        <span className="grow" />
        <div className="seg">
          <button className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>Cards</button>
          <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
        </div>
      </div>
      {grants.length === 0 ? (
        <Empty title={all.some((g) => g.fm.status === "researching") ? "No matches" : "Nothing in research"}>
          <p>Found something promising? Quick-add it, and paste the guidelines to pull out dates and amounts.</p>
        </Empty>
      ) : view === "cards" ? (
        <div className="cards">
          {grants.map((g) => (
            <GrantCard key={g.folder} g={g} footer={move(g)} />
          ))}
        </div>
      ) : (
        <GrantTable grants={grants} extra={move} />
      )}
      {adding && <QuickAdd onClose={() => setAdding(false)} />}
    </div>
  );
}
