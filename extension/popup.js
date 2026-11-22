import { ENDPOINT, findAmounts, findDates, flush, getCode, queue, send } from "./shared.js";

const $ = (id) => document.getElementById(id);
const msg = (text, cls = "") => { $("msg").textContent = text; $("msg").className = cls; };

async function status() {
  const code = await getCode();
  try {
    const r = await fetch(`${ENDPOINT}/ping`, { headers: { "X-Pairing-Code": code } });
    const j = await r.json();
    $("status").textContent = j.paired ? "Connected" : "Not paired";
    if (!j.paired) $("pair").hidden = false;
    if (j.paired) {
      const n = await flush();
      if (n) msg(`Sent ${n} saved grant${n === 1 ? "" : "s"} from the queue.`, "ok");
    }
  } catch {
    $("status").textContent = "App closed";
    if (!code) $("pair").hidden = false;
  }
}

function suggest(text) {
  const box = $("suggest");
  box.textContent = "";
  for (const d of findDates(text).slice(0, 3)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${d.label}: ${d.raw}`;
    b.onclick = () => ($("deadline").value = d.iso);
    box.appendChild(b);
  }
  for (const a of findAmounts(text).slice(0, 3)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${a.max ? "Up to " : ""}$${a.value.toLocaleString()}`;
    b.onclick = () => ($("amount").value = String(a.value));
    box.appendChild(b);
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("title").value = (tab?.title || "").replace(/\s*[|–-]\s*[^|–-]+$/, "").trim() || tab?.title || "";
  $("url").value = tab?.url || "";
  let pageText = "";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ sel: String(window.getSelection() || ""), text: document.body ? document.body.innerText.slice(0, 20000) : "" }),
    });
    $("selection").value = result.sel.trim();
    pageText = result.text;
  } catch {
    /* chrome:// pages etc. */
  }
  suggest(($("selection").value || "") + "\n" + pageText);
  $("selection").addEventListener("input", (e) => suggest(e.target.value + "\n" + pageText));
  await status();
}

$("saveCode").onclick = async () => {
  await chrome.storage.local.set({ pairingCode: $("code").value.trim() });
  $("pair").hidden = true;
  await status();
};
$("repair").onclick = async () => {
  $("pair").hidden = !$("pair").hidden;
  $("code").value = await getCode();
};

$("form").onsubmit = async (e) => {
  e.preventDefault();
  const target = document.querySelector('input[name="target"]:checked').value;
  const sel = $("selection").value.trim();
  const amount = parseFloat($("amount").value.replace(/[^0-9.]/g, ""));
  const grant = {
    title: $("title").value.trim(),
    url: $("url").value.trim(),
    funder: $("funder").value.trim() || undefined,
    deadline: $("deadline").value || undefined,
    amount: isNaN(amount) ? null : amount,
    status: $("statusSel").value,
    tags: $("tags").value.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
    [target]: sel || undefined,
  };
  if (!grant.title) return;
  try {
    await send(grant, await getCode());
    msg("Saved to Many Apply.", "ok");
    setTimeout(() => window.close(), 900);
  } catch (err) {
    if (err.offline) {
      await queue(grant);
      msg("Many Apply is closed. Saved here, and it'll be sent when the app opens.", "warn");
    } else {
      msg(err.message, "err");
      $("pair").hidden = false;
    }
  }
};

void init();
