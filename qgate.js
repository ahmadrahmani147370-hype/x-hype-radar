/* Quality Gate card — reads data/quality.json (written box-side by scripts/paper.py). Shared by home.html and paper.html.
   Every number is from the file; missing values show "—". Win rates are past paper results, not a promise. */
(() => {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NAMES = { data: "Data quality", liquidity: "Liquidity / risk", regime: "BTC regime", timeframe: "Timeframes ulte", volume: "Volume kam", chase: "Late entry / RSI", rr: "Reward:Risk kam", cooldown: "Cooldown", paused: "Type paused" };
  const pkt = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit" }) + " PKT" : "—");
  const fp = (p) => { p = +p; if (!isFinite(p) || p === 0) return "—"; const a = Math.abs(p); return "$" + (a >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 0 }) : a >= 1 ? p.toFixed(3) : a >= 0.01 ? p.toFixed(5) : p.toPrecision(3)); };
  function wr(x) {
    if (!x || !x.n) return { v: "—", s: "0 closed" };
    return { v: x.win_rate + "%", s: x.wins + "/" + x.n + " closed" + (x.n < 20 ? " · chhota sample" : "") };
  }
  function sh(x) {
    const v = (x && x["24h"]) || {};
    return v.win_rate != null ? { v: v.win_rate + "%", s: v.wins + "/" + v.n + " · 24h direction" } : { v: "—", s: (v.n || 0) + " scored · ≥5 chahiye" };
  }
  function render(el, q, mode) {
    if (!el) return;
    if (!q) { el.innerHTML = '<div class="qg-empty">Quality Gate data abhi load nahi hua</div>'; return; }
    const c = q.counts || {}, ba = q.before_after || {}, b = q.btc || {};
    const reasons = Object.entries(q.reasons || {});
    const box = (lab, o, cls) => `<div class="qg-st ${cls || ""}"><span>${lab}</span><b>${esc(o.v)}</b><small>${esc(o.s)}</small></div>`;
    const passed = (q.signals || []).filter((x) => x.pass);
    let h = `<div class="qg-top"><div class="qg-n"><b>${c.signals ?? "—"}</b><span>signals</span></div><div class="qg-n up"><b>${c.pass ?? "—"}</b><span>pass</span></div><div class="qg-n down"><b>${c.blocked ?? "—"}</b><span>blocked</span></div>
      <div class="qg-btc"><span class="qg-tag ${b.label === "weak" ? "down" : b.label === "strong" ? "up" : ""}">BTC ${esc(b.label || "n/a")}</span><small>${esc(b.text || "")}</small></div></div>`;
    h += reasons.length ? `<div class="qg-chips">${reasons.map(([k, n]) => `<span class="qg-chip">${esc(NAMES[k] || k)} <b>${n}</b></span>`).join("")}</div>` : "";
    h += `<div class="qg-grid">${box("Gate se pehle", wr(ba.pre_gate))}${box("Gate ke baad", wr(ba.gate), "hl")}${box("Pass signals", sh(ba.shadow_pass))}${box("Blocked signals", sh(ba.shadow_blocked))}</div>`;
    if (passed.length) h += `<div class="qg-pass">${passed.slice(0, mode === "full" ? 12 : 4).map((x) => `<div class="qg-pr"><b>${esc(x.symbol)}</b><span class="${x.side === "LONG" ? "up" : "down"}">${x.side === "LONG" ? "▲" : "▼"} ${esc(x.side)}</span><small>TP ${fp(x.tp)} · SL ${fp(x.sl)} · R:R ${esc(x.rr)}</small></div>`).join("")}</div>`;
    else h += `<div class="qg-empty">Abhi koi signal gate pass nahi karta — paper trade aur Telegram alert sirf pass signals par.</div>`;
    if (mode === "full") {
      const tr = q.track_record || [], pz = q.paused || {}, rule = q.pause_rule || {};
      h += `<h4 class="qg-h4">Signal type track record <small>(closed paper trades, fees ke baad)</small></h4>`;
      h += tr.length ? `<table class="qg-tb"><thead><tr><th>Type</th><th>Side</th><th>Trades</th><th>Win</th><th>Pehle</th><th>Gate</th><th>Status</th></tr></thead><tbody>${tr.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.side)}</td><td>${r.n}</td><td>${r.win_rate != null ? r.win_rate + "%" : "—"}</td><td>${r.pre_wins}/${r.pre_n}</td><td>${r.qg_wins}/${r.qg_n}</td><td>${pz[r.code] ? '<span class="down">paused</span>' : r.n < (rule.min_n || 20) ? `<span class="muted">${r.n}/${rule.min_n || 20} data</span>` : "active"}</td></tr>`).join("")}</tbody></table>`
        : '<div class="qg-empty">Abhi koi closed trade nahi</div>';
      h += `<p class="qg-small">Auto-pause: jis type ke ≥${rule.min_n || 20} closed trades aur jeet &lt; ${rule.below_wr || 45}% ho woh nayi entries ke liye ruk jata hai. Gate khud se kabhi dheela nahi hota.${Object.keys(pz).length ? " Paused: " + esc(Object.entries(pz).map(([k, v]) => k + " (" + v.why + ")").join(", ")) : ""}</p>`;
      h += `<h4 class="qg-h4">Filters (${esc(q.version)})</h4><ul class="qg-rules">${(q.thresholds || []).map(([k, t]) => `<li><b>${esc(k)}:</b> ${esc(t)}</li>`).join("")}</ul>`;
    }
    h += `<p class="qg-note">⚠ Win rate = pichle paper results, future ki guarantee nahi. Koi filter 80% pakka nahi karta. 20 se kam trades par % par bharosa na karein. Update ${pkt(q.generated_at)}.</p>`;
    el.innerHTML = h;
  }
  async function load() {
    const r = await fetch("data/quality.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  window.QGate = { render, load, NAMES };
})();
