/* Ultra Strong card — reads data/ultra.json (box-side, scripts/paper.py + scripts/ultra.py). Numbers only from the file.
   Win rate is shown only after >= 5 closed Ultra trades; it is past paper results, never a promise. */
(() => {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pkt = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit" }) + " PKT" : "—");
  const fp = (p) => { p = +p; if (!isFinite(p) || p === 0) return "—"; const a = Math.abs(p); return "$" + (a >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 0 }) : a >= 1 ? p.toFixed(3) : a >= 0.01 ? p.toFixed(5) : p.toPrecision(3)); };
  const pc = (v) => (v == null || !isFinite(+v) ? "—" : (v >= 0 ? "+" : "") + (+v).toFixed(2) + "%");
  function row(x) {
    const up = x.side === "LONG", st = x.status === "closed" ? (x.exit_reason || "closed") : "open";
    return `<div class="us-row" data-open="top500:${esc(x.key)}"><div class="us-l"><b>${esc(x.symbol)}</b><span class="${up ? "up" : "down"}">${up ? "▲ LONG" : "▼ SHORT"}</span><span class="us-sc">score ${esc(x.score)}</span></div>
      <div class="us-lv">Entry ${fp(x.entry)} · SL ${fp(x.sl_now || x.sl)} · TP ${fp(x.tp)} · R:R ${esc(x.rr)}</div>
      <div class="us-why">${esc((x.reasons || []).slice(0, 5).join(" · "))}</div>
      <div class="us-ft"><span>${pkt(x.at)}</span><span class="${(x.pnl_pct || 0) >= 0 ? "up" : "down"}">${pc(x.pnl_pct)} · ${esc(st)}</span></div></div>`;
  }
  function render(el, u) {
    if (!el) return;
    if (!u) { el.innerHTML = '<div class="qg-empty">Ultra data abhi load nahi hua</div>'; return; }
    const r = u.record || {}, d24 = r.dir_24h || {};
    const list = (u.active && u.active.length ? u.active : u.today) || [];
    let h = `<div class="us-cnt"><div class="us-big"><b>${u.today_count ?? 0}</b><span>/ ${u.cap ?? 5} aaj</span></div><div class="us-bar">${Array.from({ length: u.cap || 5 }, (_, i) => `<i class="${i < (u.today_count || 0) ? "on" : ""}"></i>`).join("")}</div>
      <small>Poora Quality Gate + score ≥ ${esc(u.min_score)}/100 · kam ya zero bhi theek</small></div>`;
    if (list.length) h += `<div class="us-list">${list.slice(0, 5).map(row).join("")}</div>`;
    else {
      const c = (u.candidates || []).slice(0, 3);
      h += `<div class="qg-empty">Aaj abhi koi Ultra signal nahi — koi setup itna mazboot nahi.${c.length ? "<br>Qareeb-tareen: " + c.map((x) => `<b>${esc(x.symbol)}</b> ${esc(x.score)}`).join(" · ") + ` (sab ${esc(u.candidates_n)} candidates mein se ${esc(u.eligible_n)} eligible)` : ""}</div>`;
    }
    const box = (l, v, s) => `<div class="qg-st"><span>${l}</span><b>${v}</b><small>${s}</small></div>`;
    h += `<div class="qg-grid us-grid">${box("Ultra win rate", r.win_rate != null ? r.win_rate + "%" : "—", r.closed ? `${r.wins}/${r.closed} closed${r.closed < 20 ? " · chhota sample" : ""}` : "0 closed · ≥5 chahiye")}
      ${box("Avg R", r.avg_r != null ? (r.avg_r >= 0 ? "+" : "") + r.avg_r + "R" : "—", `open ${r.open || 0} · realized ${r.realized_usd >= 0 ? "+" : ""}$${(r.realized_usd || 0).toFixed(2)}`)}
      ${box("24h direction", d24.win_rate != null ? d24.win_rate + "%" : "—", `${d24.n || 0} scored`)}</div>`;
    h += `<p class="qg-note">⚠ Ultra bhi haar sakta hai. Win rate = pichle paper results, guarantee nahi · % sirf ≥ 5 closed ke baad. Update ${pkt(u.generated_at)}.</p>`;
    el.innerHTML = h;
  }
  async function load() { const r = await fetch("data/ultra.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return r.json(); }
  window.Ultra = { render, load };
})();
