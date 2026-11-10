/* Paper Trades — reads data/paper/trades.json (box-side ledger) and marks OPEN trades with live prices every 60 s.
   Virtual money only. Closed trades are shown exactly as recorded in the ledger. */
(() => {
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
  const inTG = !!(tg && tg.platform && tg.platform !== "unknown");
  if (inTG) { tg.ready(); tg.expand(); try { tg.setHeaderColor("#0A0A0B"); tg.setBackgroundColor("#0A0A0B"); tg.setBottomBarColor && tg.setBottomBarColor("#0A0A0B"); } catch (e) {} document.documentElement.classList.add("tg"); }
  const $ = (s) => document.querySelector(s), TZ = "Asia/Karachi", REFRESH_MS = 60000, STALE_MS = 10 * 60000;
  let led = null, book = "all", st = "open", nextRefresh = Date.now() + REFRESH_MS, busy = null, cgPauseUntil = 0, cgBackoff = 120000, feed = "";
  const live = new Map(); // trade id -> {p, src, at}
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const N = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const pkt = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) + " PKT";
  const hm = (t) => new Date(t).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) + " PKT";
  const price = (p) => { if (p == null) return "n/a"; if (p >= 1000) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 }); if (p >= 1) return "$" + p.toFixed(2); if (p >= 0.01) return "$" + p.toFixed(4); return "$" + p.toPrecision(3); };
  const usd = (v) => v == null ? "n/a" : `<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}</span>`;
  const pc = (v) => v == null ? "n/a" : `<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${v.toFixed(2)}%</span>`;
  const hold = (h) => h == null ? "n/a" : h < 1 ? Math.round(h * 60) + "m" : h < 48 ? h.toFixed(1) + "h" : (h / 24).toFixed(1) + "d";
  const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 1700); };
  const FEE = () => (led ? led.fee_pct_per_side : 0.1) / 100;
  function pnl(t, p) { const g = t.side === "LONG" ? t.qty * (p - t.entry_price) : t.qty * (t.entry_price - p); const net = g - FEE() * t.stake_usd - FEE() * t.qty * p; return [net, net / t.stake_usd * 100]; }
  function mark(t) { // best available mark: live (if fresher) else ledger's box-side mark
    const l = live.get(t.id), boxAt = t.mark_at ? new Date(t.mark_at).getTime() : 0;
    if (l && l.at >= boxAt) return { p: l.p, src: l.src, at: l.at };
    return { p: t.mark_price, src: (t.mark_src || "") + " (box)", at: boxAt };
  }
  async function getJSON(url, ms = 15000) { const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(url, { cache: "no-store", signal: c.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(tm); } }
  async function livePrices() {
    const open = led.trades.filter((t) => t.status === "open"); if (!open.length) { feed = ""; return; }
    const t5 = open.filter((t) => t.book === "top500"), cg = new Map();
    open.filter((t) => t.book === "meme" && t.market_ref && t.market_ref.coingecko_id).forEach((t) => cg.set(t.id, t.market_ref.coingecko_id));
    t5.forEach((t) => cg.set(t.id, t.key));
    let cgOk = false;
    if (cg.size && Date.now() >= cgPauseUntil) {
      try { const q = await getJSON("https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_last_updated_at=true&ids=" + [...new Set(cg.values())].join(","));
        for (const [id, cid] of cg) { const v = q[cid]; if (v && N(v.usd) > 0) live.set(id, { p: +v.usd, src: "CoinGecko live", at: v.last_updated_at ? v.last_updated_at * 1000 : Date.now() }); }
        cgOk = true; cgBackoff = 120000;
      } catch (e) { cgPauseUntil = Date.now() + cgBackoff; cgBackoff = Math.min(cgBackoff * 2, 600000); } // 429 = CORS error: back off
    }
    const bn = t5.filter((t) => t.binance_pair && !(live.get(t.id) && Date.now() - live.get(t.id).at < 120000));
    if (bn.length) { try { const rows = await getJSON(bn.length === 1 ? "https://data-api.binance.vision/api/v3/ticker/price?symbol=" + bn[0].binance_pair : "https://data-api.binance.vision/api/v3/ticker/price", 20000); const arr = Array.isArray(rows) ? rows : [rows];
      const m = new Map(arr.map((r) => [r.symbol, +r.price])); bn.forEach((t) => { const p = m.get(t.binance_pair); if (p > 0) live.set(t.id, { p, src: "Binance " + t.binance_pair, at: Date.now() }); }); } catch (e) {} }
    const dex = open.filter((t) => t.book === "meme" && t.market_ref && t.market_ref.chain && t.market_ref.token_address);
    for (const t of dex) { try { const ps = await getJSON(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(t.market_ref.chain)}/${encodeURIComponent(t.market_ref.token_address)}`);
      const p = (ps || []).find((x) => x.url === t.market_ref.pair_url) || (ps || [])[0]; if (p && N(p.priceUsd) > 0) live.set(t.id, { p: +p.priceUsd, src: "DexScreener", at: Date.now() }); } catch (e) {} }
    feed = cg.size && !cgOk ? "CoinGecko busy — Binance/box prices" : "";
  }
  function stats(trs) {
    const cl = trs.filter((t) => t.status === "closed" && !t.void), op = trs.filter((t) => t.status === "open");
    const w = cl.filter((t) => t.pnl_usd > 0), real = cl.reduce((a, t) => a + t.pnl_usd, 0);
    const unr = op.reduce((a, t) => { const m = mark(t); return a + (m.p ? pnl(t, m.p)[0] : 0); }, 0);
    const best = cl.length ? cl.reduce((a, t) => (t.pnl_pct > a.pnl_pct ? t : a)) : null, worst = cl.length ? cl.reduce((a, t) => (t.pnl_pct < a.pnl_pct ? t : a)) : null;
    return { n: cl.length + op.length, void: trs.filter((t) => t.void).length, cl: cl.length, op: op.length, wr: cl.length ? w.length / cl.length * 100 : null, real, unr, avg: cl.length ? cl.reduce((a, t) => a + t.hold_h, 0) / cl.length : null, best, worst };
  }
  const TAG = { "top500:trend": ["🏆 Top 500", "sig-pump"], "top500:mean-reversion": ["↩ Mean-rev", "sig-early"], "meme:trend": ["🔴 Meme", "sig-hot"] };
  function row(t) {
    const tag = TAG[t.book + ":" + t.strategy] || ["", ""], m = mark(t), isOpen = t.status === "open";
    const [pu, pp] = isOpen ? (m.p ? pnl(t, m.p) : [null, null]) : [t.pnl_usd, t.pnl_pct];
    const stale = isOpen && (!m.at || Date.now() - m.at > STALE_MS);
    const link = t.book === "top500" ? `top500.html#coin=${encodeURIComponent(t.key)}` : "home.html";
    return `<a class="t5row pp-row ${isOpen ? "" : "closed"}" href="${link}">
      <div class="pp-l"><div class="r-sym">${esc(t.symbol)} <span class="pp-side ${t.side === "LONG" ? "long" : "short"}">${t.side}</span> <span class="sig ${tag[1]}">${tag[0]}</span>${t.void ? ' <span class="sig sig-neutral">VOID · stats se bahar</span>' : ""}${t.tier === "ultra" ? ' <span class="qg-mini ul">🔥 ULTRA ' + esc(t.ultra_score) + '</span>' : ""}${t.gate_version ? ` <span class="qg-mini ok">${esc(t.gate_version)} · R:R ${esc(t.rr)}</span>` : ""}</div>
        <div class="r-why">↳ ${esc(t.signal_label)}: ${esc(t.signal_reason || "")}</div>
        <div class="pp-meta">Entry ${price(t.entry_price)} · ${pkt(t.entry_at)} · ${esc(t.entry_src)}</div>
        <div class="pp-meta">${t.levels_note ? `<em>${esc(t.levels_note)}</em><br>` : ""}${isOpen ? `TP ${price(t.tp)} <em>(${esc(t.tp_basis)})</em> · SL ${price(t.sl)} <em>(${esc(t.sl_basis)})</em> · expiry ${pkt(t.expires_at)}`
          : `Exit ${price(t.exit_price)} · ${pkt(t.exit_at)} · <b>${esc(t.exit_reason)}</b> · hold ${hold(t.hold_h)}`}</div></div>
      <div class="pp-r"><b>${usd(pu)}</b><span>${pc(pp)}</span>${isOpen ? `<small class="${stale ? "stale-tag" : "muted"}">${m.p ? price(m.p) : "n/a"} · ${m.at ? hm(m.at) : "n/a"}${stale ? " · purani" : ""}</small>` : ""}</div></a>`;
  }
  function render() {
    const all = led.trades, trs = all.filter((t) => book === "all" || t.book + ":" + t.strategy === book), s = stats(trs);
    $("#heroLine").innerHTML = `Ledger shuru: <b>${pkt(led.started_at)}</b> · ${led.baseline_signals ?? 0} signals jo start par pehle se chal rahe the un par trade nahi khuli (sirf naye signals). Last box update ${led.updated_at ? pkt(led.updated_at) : "n/a"}.`;
    const tot = s.real + s.unr;
    $("#stats").innerHTML = [[s.n, "Total trades" + (s.void ? ` <small>(+${s.void} void)</small>` : "")], [`${s.op} / ${s.cl}`, "Open / Closed"], [s.wr == null ? "—" : s.wr.toFixed(0) + "%", "Win rate (closed)"],
      [usd(tot), `Total P&L <small>(real ${s.real.toFixed(2)} + open ${s.unr.toFixed(2)})</small>`], [s.avg == null ? "—" : hold(s.avg), "Avg hold"],
      [s.best ? `${esc(s.best.symbol)} ${pc(s.best.pnl_pct)}` : "—", "Best"], [s.worst ? `${esc(s.worst.symbol)} ${pc(s.worst.pnl_pct)}` : "—", "Worst"]]
      .map(([b, l]) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`).join("");
    const xs = trs.filter((t) => t.status === st).sort((a, b) => (st === "open" ? b.entry_at.localeCompare(a.entry_at) : b.exit_at.localeCompare(a.exit_at)));
    $("#list").innerHTML = xs.map(row).join("") || `<div class="empty">${st === "open" ? "Abhi koi open paper trade nahi. Naya Pump/Dump (ya Oversold/Overbought) signal shuru hote hi yahan $100 ki virtual trade khulegi — box har ~15 min check karta hai." : "Abhi koi closed trade nahi."}</div>`;
    const lv = [...live.values()]; $("#priceAge").textContent = lv.length ? `Prices · live ${hm(Math.max(...lv.map((x) => x.at)))}` : "Prices · box marks";
    $("#snapAge").textContent = `Ledger: ${led.updated_at ? hm(led.updated_at) : "n/a"}`; $("#feedStatus").textContent = feed;
    $("#livePill").classList.toggle("stale", !!feed || (led.updated_at && Date.now() - new Date(led.updated_at) > 45 * 60000));
  }
  function load(manual) {
    if (busy) return busy; nextRefresh = Date.now() + REFRESH_MS; $("#reloadBtn").classList.add("spinning");
    busy = (async () => {
      try { const d = await getJSON("data/paper/trades.json?t=" + Date.now()); if (!Array.isArray(d.trades)) throw new Error("bad"); led = d; }
      catch (e) { if (!led) { $("#list").innerHTML = '<div class="empty">Ledger load nahi ho saka. Refresh karein.</div>'; return; } }
      if (window.QGate) QGate.load().then((q) => QGate.render($("#qgBody"), q, "full")).catch(() => QGate.render($("#qgBody"), null));
      render(); await livePrices(); render(); if (manual) toast(feed || "Refreshed");
    })().finally(() => { busy = null; $("#reloadBtn").classList.remove("spinning"); });
    return busy;
  }
  $("#bookSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; book = b.dataset.book; document.querySelectorAll("#bookSeg button").forEach((x) => x.classList.toggle("on", x === b)); render(); };
  $("#statusSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st = b.dataset.st; document.querySelectorAll("#statusSeg button").forEach((x) => x.classList.toggle("on", x === b)); render(); };
  $("#reloadBtn").onclick = () => load(true);
  document.body.insertAdjacentHTML("beforeend", '<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="ringG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D4C09A"/><stop offset="1" stop-color="#C6B08A"/></linearGradient></defs></svg>');
  load();
  setInterval(() => { const left = Math.max(0, Math.ceil((nextRefresh - Date.now()) / 1000)); $("#countdown").style.setProperty("--remaining", left / 60); $("#countdownNumber").textContent = busy ? "↻" : left;
    if (!document.hidden && !busy && Date.now() >= nextRefresh) load(); }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() > nextRefresh - 50000) load(); });
  // pull-to-refresh
  document.body.insertAdjacentHTML("afterbegin", '<div class="ptr" id="ptr"><div class="ptr-ring"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15"/></svg></div><span class="ptr-txt">Pull to refresh</span></div>');
  const ptr = $("#ptr"), TH = 80; let y0 = null, dy = 0;
  const setPull = (d) => { ptr.style.transform = `translate(-50%, ${Math.min(d, 110) - 70}px)`; ptr.style.opacity = Math.min(d / TH, 1); ptr.classList.toggle("armed", d >= TH); };
  addEventListener("touchstart", (e) => { if (scrollY <= 0) { y0 = e.touches[0].clientY; dy = 0; ptr.classList.remove("snap"); } }, { passive: true });
  addEventListener("touchmove", (e) => { if (y0 == null) return; dy = (e.touches[0].clientY - y0) * 0.5; if (dy > 0) { setPull(dy); if (e.cancelable) e.preventDefault(); } else setPull(0); }, { passive: false });
  addEventListener("touchend", async () => { if (y0 == null) return; y0 = null; ptr.classList.add("snap"); if (dy >= TH) { ptr.classList.add("spin"); setPull(TH); await load(true); ptr.classList.remove("spin"); } setPull(0); });
})();
