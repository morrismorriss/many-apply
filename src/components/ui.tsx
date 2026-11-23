import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { STATUS_LABEL, type Grant, type Status } from "../lib/model";
import { useLookups, useStore } from "../store";
import { daysUntil, fmtDate, fmtMoney } from "../lib/util";
import { askText } from "./dialogs";

export function statusColor(s: Status) {
  return `var(--st-${s})`;
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className="pill" style={{ ["--c" as string]: statusColor(status) }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ClientLabel({ slug, hideMe = false }: { slug: string; hideMe?: boolean }) {
  const { client, clientName } = useLookups();
  const filter = useStore((s) => s.clientFilter);
  const hasClients = useStore((s) => (s.data?.clients.length ?? 0) > 1);
  if (!hasClients || filter) return null;
  if (hideMe && slug === "me") return null;
  const c = client(slug);
  return (
    <span className="label" style={{ ["--c" as string]: c?.fm.color || "#8a817c" }}>
      {clientName(slug)}
    </span>
  );
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </span>
  );
}

export function DeadlineText({ g }: { g: Grant }) {
  if (g.fm.deadline_type === "rolling" && !g.fm.deadline) return <span>Rolling</span>;
  if (!g.fm.deadline) return <span className="muted">No deadline</span>;
  const n = daysUntil(g.fm.deadline);
  const urgent = n !== null && n >= 0 && n <= 14 && !["submitted", "awarded", "declined", "withdrawn"].includes(g.fm.status);
  return (
    <span className={urgent ? "warn-text" : undefined} title={g.fm.deadline}>
      {g.fm.deadline_type === "loi" ? "LOI " : ""}
      {fmtDate(g.fm.deadline)}
      {urgent ? ` · ${n === 0 ? "today" : `${n}d`}` : ""}
    </span>
  );
}

export function GrantCard({ g, draggable, onDragStart, onDragEnd, dragging, footer }: {
  g: Grant;
  footer?: ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}) {
  const open = useStore((s) => s.openDrawer);
  const update = useStore((s) => s.updateGrant);
  const { funderName } = useLookups();
  return (
    <div
      className={`card${dragging ? " dragging" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => open({ kind: "grant", id: g.folder })}
    >
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="title grow">{g.fm.title}</div>
        <button
          className={`icon-btn ${g.fm.starred ? "star" : ""}`}
          style={{ width: 22, height: 22, marginTop: -2 }}
          title={g.fm.starred ? "Unstar" : "Star"}
          onClick={(e) => {
            e.stopPropagation();
            void update(g.folder, (x) => ({ ...x, fm: { ...x.fm, starred: !x.fm.starred } }));
          }}
        >
          {g.fm.starred ? "★" : "☆"}
        </button>
      </div>
      <div className="soft small ellipsis">{funderName(g.fm.funder) || <span className="muted">No funder</span>}</div>
      <div className="meta">
        <DeadlineText g={g} />
        {(g.fm.amount_requested ?? g.fm.max_award) !== null && (
          <span className="num">{fmtMoney(g.fm.amount_awarded ?? g.fm.amount_requested ?? g.fm.max_award, g.fm.currency, true)}</span>
        )}
        <ClientLabel slug={g.fm.client} hideMe />
      </div>
      {footer && (
        <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
          {footer}
        </div>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose, actions, width }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, 94vw)` } : undefined} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

/** A button that opens a small menu of choices. */
export function MenuButton({ label, items, className = "btn", title }: {
  label: ReactNode;
  items: { label: ReactNode; run: () => void; disabled?: boolean }[];
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu is drawn over the whole window (not inside the drawer or panel the button is in),
  // so it's never cut off. It opens upward when there's more room above.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const btn = ref.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!btn || !menu) return;
      const gap = 4;
      const margin = 8;
      const below = window.innerHeight - btn.bottom - gap - margin;
      const above = btn.top - gap - margin;
      const natural = Math.min(menu.scrollHeight, 360);
      const up = natural > below && above > below;
      const maxHeight = Math.max(120, Math.min(360, up ? above : below));
      const width = Math.max(menu.offsetWidth, 200);
      // Line the menu's right edge up with the button's, then keep it on screen.
      const left = Math.min(Math.max(margin, btn.right - width), window.innerWidth - width - margin);
      setPos({
        position: "fixed",
        left,
        maxHeight,
        ...(up ? { bottom: window.innerHeight - btn.top + gap } : { top: btn.bottom + gap }),
      });
    };
    place();
    const close = (e: Event) => {
      // Scrolling inside the menu itself is fine; scrolling the page would leave it floating.
      if (e.type === "scroll" && menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button className={className} title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="menu" role="menu" style={pos ?? { position: "fixed", top: -9999, left: -9999 }}>
            {items.length === 0 && <div className="muted small" style={{ padding: 8 }}>Nothing here yet</div>}
            {items.map((it, i) => (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.run();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ---------- Inline-editable fields: save on blur or Enter.

export function InlineText({ value, onSave, placeholder, multiline, type = "text", className = "inline" }: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: string;
  className?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onSave(v.trim());
  if (multiline)
    return (
      <textarea className={className} value={v} placeholder={placeholder} rows={3} onChange={(e) => setV(e.target.value)} onBlur={commit} />
    );
  return (
    <input
      className={className}
      type={type}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function InlineNumber({ value, onSave, placeholder, prefix }: {
  value: number | null;
  onSave: (v: number | null) => void;
  placeholder?: string;
  prefix?: string;
}) {
  const fmt = (n: number | null) => (n === null ? "" : n.toLocaleString("en-US"));
  const [v, setV] = useState(fmt(value));
  useEffect(() => setV(fmt(value)), [value]);
  return (
    <div className="row" style={{ gap: 0, width: "100%" }}>
      {prefix && v && <span className="muted" style={{ paddingLeft: 8 }}>{prefix}</span>}
      <input
        className="inline num"
        value={v}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = v.trim() === "" ? null : Number(v.replace(/[^0-9.-]/g, ""));
          const next = n === null || isNaN(n) ? null : n;
          if (next !== value) onSave(next);
          setV(fmt(next));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

export function InlineDate({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return (
    <input
      className="inline"
      type="date"
      value={value || ""}
      onChange={(e) => e.target.value !== value && onSave(e.target.value)}
      style={{ color: value ? undefined : "var(--muted)" }}
    />
  );
}

export function InlineSelect<T extends string>({ value, options, onSave, labels }: {
  value: T;
  options: readonly T[];
  onSave: (v: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <select className="inline" value={value} onChange={(e) => onSave(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

export function TagInput({ value, onSave, suggestions = [] }: { value: string[]; onSave: (v: string[]) => void; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const id = useRef("tags-" + Math.random().toString(36).slice(2)).current;
  const add = () => {
    const parts = draft.split(/[,;]/).map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
    if (parts.length) onSave([...new Set([...value, ...parts])]);
    setDraft("");
  };
  return (
    <div className="row wrap" style={{ gap: 4, padding: "2px 4px", width: "100%" }}>
      {value.map((t) => (
        <span key={t} className="tag">
          {t}{" "}
          <button className="icon-btn" style={{ width: 14, height: 14, fontSize: 11 }} onClick={() => onSave(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
            ×
          </button>
        </span>
      ))}
      <input
        className="inline"
        style={{ width: 110, flex: 1, minHeight: 26 }}
        list={id}
        value={draft}
        placeholder={value.length ? "" : "Add tags"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) onSave(value.slice(0, -1));
        }}
      />
      <datalist id={id}>
        {suggestions.filter((s) => !value.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function useAllTags(): string[] {
  const grants = useStore((s) => s.data?.grants);
  return [...new Set((grants ?? []).flatMap((g) => g.fm.tags))].sort();
}

export function ClientSelect({ value, onChange, className = "inline", allowNew = true, style }: {
  value: string;
  style?: CSSProperties;
  onChange: (slug: string) => void;
  className?: string;
  allowNew?: boolean;
}) {
  const clients = useStore((s) => s.data?.clients ?? []);
  const addClient = useStore((s) => s.addClient);
  return (
    <select
      className={className}
      style={style}
      value={value}
      onChange={async (e) => {
        if (e.target.value === "__new") {
          const name = await askText("New client", { placeholder: "Organization or person" });
          if (name?.trim()) onChange(await addClient(name.trim()));
          return;
        }
        onChange(e.target.value);
      }}
    >
      {clients.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.fm.name}
        </option>
      ))}
      {allowNew && <option value="__new">+ New client…</option>}
    </select>
  );
}

export function FunderSelect({ value, onChange, className = "inline" }: { value: string; onChange: (slug: string, name: string) => void; className?: string }) {
  const funders = useStore((s) => s.data?.funders ?? []);
  const mutate = useStore((s) => s.mutate);
  return (
    <select
      className={className}
      value={value}
      onChange={async (e) => {
        if (e.target.value === "__new") {
          const name = await askText("New funder", { placeholder: "Funder name" });
          if (!name?.trim()) return;
          const { ensureFunder } = await import("../lib/vault");
          const r = await mutate((fs) => ensureFunder(fs, name.trim()));
          onChange(r.slug, name.trim());
          return;
        }
        const f = funders.find((x) => x.slug === e.target.value);
        onChange(e.target.value, f?.fm.name ?? "");
      }}
    >
      <option value="">No funder</option>
      {value && !funders.some((f) => f.slug === value) && <option value={value}>{value}</option>}
      {funders.map((f) => (
        <option key={f.slug} value={f.slug}>
          {f.fm.name}
        </option>
      ))}
      <option value="__new">+ New funder…</option>
    </select>
  );
}

export function WordMeter({ count, limit, unit }: { count: number; limit: number | null; unit: string }) {
  if (!limit) return <span className="muted small num">{count.toLocaleString()} {unit}</span>;
  const pct = Math.min(100, (count / limit) * 100);
  const cls = count > limit ? "over" : pct >= 90 ? "near" : "";
  return (
    <div className="stack" style={{ gap: 3, minWidth: 120 }}>
      <span className={`small num ${count > limit ? "danger-text" : "muted"}`}>
        {count.toLocaleString()} / {limit.toLocaleString()} {unit}
      </span>
      <div className={`meter ${cls}`}>
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Re-render every `ms` while `on` is true; returns the current time. */
export function useNow(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return now;
}

/** 3725000 ms -> "1:02:05" */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** The running timer, shown in the sidebar so it can be stopped from anywhere. */
export function TimerChip() {
  const timer = useStore((s) => s.timer);
  const stop = useStore((s) => s.stopTimer);
  const open = useStore((s) => s.openDrawer);
  const now = useNow(!!timer);
  if (!timer) return null;
  return (
    <div className="timer-chip">
      <button className="timer-title ellipsis" title={`Open ${timer.title}`} onClick={() => open({ kind: "grant", id: timer.folder })}>
        <span className="timer-dot" aria-hidden />
        {timer.title}
      </button>
      <span className="num">{fmtElapsed(now - timer.start)}</span>
      <button className="btn small" onClick={() => void stop()}>Stop</button>
    </div>
  );
}
