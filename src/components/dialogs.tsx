import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Modal } from "./ui";

interface Ask {
  kind: "prompt" | "confirm";
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  okLabel?: string;
  danger?: boolean;
  resolve: (v: string | null) => void;
}

const useDialogs = create<{ current: Ask | null }>(() => ({ current: null }));

export function askText(title: string, opts: { placeholder?: string; initial?: string; message?: string; okLabel?: string } = {}) {
  return new Promise<string | null>((resolve) => useDialogs.setState({ current: { kind: "prompt", title, ...opts, resolve } }));
}

export function confirmAction(title: string, message?: string, opts: { okLabel?: string; danger?: boolean } = {}) {
  return new Promise<boolean>((resolve) =>
    useDialogs.setState({ current: { kind: "confirm", title, message, ...opts, resolve: (v) => resolve(v !== null) } }),
  );
}

export function DialogHost() {
  const cur = useDialogs((s) => s.current);
  const [v, setV] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setV(cur?.initial ?? "");
    setTimeout(() => ref.current?.focus(), 20);
  }, [cur]);
  if (!cur) return null;
  const done = (val: string | null) => {
    useDialogs.setState({ current: null });
    cur.resolve(val);
  };
  const ok = () => (cur.kind === "prompt" ? v.trim() && done(v.trim()) : done("ok"));
  return (
    <Modal
      title={cur.title}
      onClose={() => done(null)}
      actions={
        <>
          <button className="btn ghost" onClick={() => done(null)}>
            Cancel
          </button>
          <button className={`btn primary`} style={cur.danger ? { background: "var(--danger)", borderColor: "var(--danger)" } : undefined} onClick={ok}>
            {cur.okLabel ?? "OK"}
          </button>
        </>
      }
    >
      {cur.message && <p className="soft" style={{ marginTop: 0 }}>{cur.message}</p>}
      {cur.kind === "prompt" && (
        <input
          ref={ref}
          className="input"
          value={v}
          placeholder={cur.placeholder}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ok()}
        />
      )}
    </Modal>
  );
}
