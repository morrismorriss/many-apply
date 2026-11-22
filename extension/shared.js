// Shared by the popup and the background worker.
export const ENDPOINT = "http://127.0.0.1:47321";

export async function getCode() {
  return (await chrome.storage.local.get("pairingCode")).pairingCode || "";
}

/** Send one grant to the desktop app. Throws {offline:true} if the app isn't running. */
export async function send(grant, code) {
  let res;
  try {
    res = await fetch(`${ENDPOINT}/grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pairing-Code": code },
      body: JSON.stringify(grant),
    });
  } catch {
    throw Object.assign(new Error("Many Apply isn't open"), { offline: true });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
}

export async function queue(grant) {
  const { queue = [] } = await chrome.storage.local.get("queue");
  queue.push({ ...grant, queuedAt: Date.now() });
  await chrome.storage.local.set({ queue });
  await updateBadge();
}

/** Try to send everything queued while the app was closed. */
export async function flush() {
  const { queue = [] } = await chrome.storage.local.get("queue");
  if (!queue.length) return 0;
  const code = await getCode();
  const left = [];
  let sent = 0;
  for (const g of queue) {
    try {
      const { queuedAt, ...grant } = g;
      await send(grant, code);
      sent++;
    } catch (e) {
      left.push(g);
      if (e.offline) {
        left.push(...queue.slice(queue.indexOf(g) + 1));
        break;
      }
    }
  }
  await chrome.storage.local.set({ queue: left });
  await updateBadge();
  return sent;
}

export async function updateBadge() {
  const { queue = [] } = await chrome.storage.local.get("queue");
  await chrome.action.setBadgeText({ text: queue.length ? String(queue.length) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#8a1c2b" });
}

// ---- Pattern matching for dates and dollar amounts (same rules as the desktop app). No AI.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function findDates(text) {
  const out = [];
  const seen = new Set();
  const today = new Date();
  const push = (y, m, d, raw, index) => {
    let dt = new Date(y ?? today.getFullYear(), m, d);
    if (dt.getMonth() !== m) return;
    if (y === undefined && dt < today) dt = new Date(today.getFullYear() + 1, m, d);
    const s = iso(dt);
    if (seen.has(s)) return;
    seen.add(s);
    const before = text.slice(Math.max(0, index - 60), index).toLowerCase();
    const last = (re) => Math.max(-1, ...[...before.matchAll(re)].map((x) => x.index));
    const dl = last(/deadline|due|submit|close|apply by|postmark/g);
    const dc = last(/notif|decision|announce|results/g);
    const label = dl < 0 && dc < 0 ? "Date" : dl > dc ? "Deadline" : "Decision";
    out.push({ iso: s, raw, label });
  };
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?`, "gi")))
    push(m[3] ? +m[3] : undefined, MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2], m[0], m.index);
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?(?:\\s+(\\d{4}))?`, "gi")))
    push(m[3] ? +m[3] : undefined, MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1], m[0], m.index);
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(+m[1], +m[2] - 1, +m[3], m[0], m.index);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) push(+m[3], +m[1] - 1, +m[2], m[0], m.index);
  return out.sort((a, b) => (a.label === "Deadline" ? -1 : 0) - (b.label === "Deadline" ? -1 : 0));
}

export function findAmounts(text) {
  const out = [];
  const seen = new Set();
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*(k|K|thousand|m|M|million)?\b/g;
  for (const m of text.matchAll(re)) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    const u = (m[2] || "").toLowerCase();
    if (u === "k" || u === "thousand") v *= 1000;
    if (u === "m" || u === "million") v *= 1e6;
    if (!v || seen.has(v)) continue;
    seen.add(v);
    const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    out.push({ value: v, raw: m[0].trim(), max: /up to|maximum|max\.?|not to exceed|no more than|awards? of|grants? of/.test(before) });
  }
  return out;
}
