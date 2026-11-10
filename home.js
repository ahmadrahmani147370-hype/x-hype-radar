/* Home dashboard — every number comes from data/top500.json, data/paper/trades.json
   or live public exchange APIs (Binance → Bybit → OKX klines). Missing values show "—". */
(() => {
  "use strict";
  const VER = "h15";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const N = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
  const tg = window.Telegram && window.Telegram.WebApp, inTG = !!(tg && tg.initData);
  if (tg) { try { tg.ready(); tg.expand(); tg.setHeaderColor("#0A0A0B"); tg.setBackgroundColor("#0A0A0B"); tg.setBottomBarColor && tg.setBottomBarColor("#0A0A0B"); } catch (e) {} }
  const haptic = (k) => { try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(k || "light"); } catch (e) {} };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2600); };
  const pkt = (ms) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit" }) + " PKT";
  const pktS = (ms) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " PKT";
  const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "abhi" : m < 60 ? m + "m pehle" : Math.round(m / 60) + "h pehle"; };
  const ts = (iso) => (iso ? new Date(iso).getTime() : null);
  const fmtP = (p) => { p = N(p); if (p == null) return "—"; const a = Math.abs(p); const d = a >= 1000 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8;
    return p.toLocaleString("en-US", { minimumFractionDigits: a >= 1000 ? 2 : 2, maximumFractionDigits: d }); };
  const pct = (v, d = 2) => (N(v) == null ? "—" : (v >= 0 ? "+" : "") + (+v).toFixed(d) + "%");
  const usd = (v) => (N(v) == null ? "—" : (v < 0 ? "-$" : "+$") + Math.abs(v).toFixed(2));
  const cls = (v) => (N(v) == null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down");
  const C = { up: "#1F9E58", down: "#D4393F", upWick: "#187A44", downWick: "#B22E33", accent: "#7EAFCB", accent2: "#C6B08A", grid: "#22262C", axis: "#7A7E86", ink: "#0C0E10", cream: "#F0EDE8" };
  const listN = () => (window.ListN ? ListN.get() : 20);

  // ---------- controls (localStorage, display-only) ----------
  const TOG = [
    ["auto", "Auto Refresh", "Data har 60 s, chart har 10 s", true],
    ["risk", "Risk Filter", "High-risk coins ke signals chhupayein", true],
    ["vib", "Vibrate Alert", "Naya paper signal aaye to vibrate + note", true],
  ];
  const prefs = (() => { try { return JSON.parse(localStorage.getItem("hr_prefs") || "{}"); } catch (e) { return {}; } })();
  const P = (k) => (prefs[k] == null ? TOG.find((t) => t[0] === k)[3] : !!prefs[k]);
  function renderToggles() {
    $$("[data-toggles]").forEach((box) => {
      const big = box.classList.contains("big");
      box.innerHTML = TOG.map(([k, l, d]) => `<div class="tg"><span>${big ? `<div>${l}<small>${d}</small></div>` : l}</span><button class="sw ${P(k) ? "on" : ""}" data-k="${k}" role="switch" aria-checked="${P(k)}" aria-label="${l}"></button></div>`).join("");
    });
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".sw"); if (!b) return;
    prefs[b.dataset.k] = !P(b.dataset.k); try { localStorage.setItem("hr_prefs", JSON.stringify(prefs)); } catch (er) {}
    haptic(); renderToggles(); renderAll(); if (b.dataset.k === "auto") toast(P("auto") ? "Auto refresh on" : "Auto refresh off — neeche khench kar refresh karein");
  });

  // ---------- data ----------
  let T5 = null, LED = null, AG = null, QG = null, UL = null, liveP = new Map(), lastData = 0;
  async function getJSON(url, ms = 15000) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(url, { cache: "no-store", signal: c.signal }); if (!r.ok) { const e = new Error(r.status); e.status = r.status; throw e; } return await r.json(); }
    finally { clearTimeout(t); }
  }
  const FAIL = {}; // which data files failed on the last attempt (cards show "data unavailable" instead of eternal Loading)
  let rafQ = 0;
  const renderSoon = () => { if (rafQ) return; rafQ = setTimeout(() => { rafQ = 0; renderAll(); }, 30); };
  async function loadData() {
    const one = (key, url, ok, set) => getJSON(url + "?t=" + Date.now(), 12000)
      .then((v) => { if (ok(v)) { set(v); FAIL[key] = 0; } else FAIL[key] = "bad data"; })
      .catch((e) => { FAIL[key] = (e && e.name === "AbortError") ? "timeout" : String((e && e.message) || e); })
      .finally(renderSoon);
    await Promise.allSettled([
      one("t5", "data/top500.json", (v) => v && Array.isArray(v.coins), (v) => (T5 = v)),
      one("led", "data/paper/trades.json", (v) => v && Array.isArray(v.trades), (v) => (LED = v)),
      one("ag", "data/agent.json", (v) => v && (v.picks || v.mood), (v) => (AG = v)),
      one("qg", "data/quality.json", (v) => v && v.counts, (v) => (QG = v)),
      one("ul", "data/ultra.json", (v) => v && v.version, (v) => (UL = v)),
    ]);
    lastData = Date.now();
    livePrices().then(() => { safe(renderHeader); safe(renderStats); safe(renderLive); safe(renderTop); });  // background, never blocks cards
  }
  async function livePrices() {
    // live Binance price for open paper trades + BTC (one small request)
    const pairs = new Set(["BTCUSDT"]);
    (LED?.trades || []).forEach((t) => { if (!t.void && t.binance_pair) pairs.add(t.binance_pair); });
    try { const q = await getJSON("https://data-api.binance.vision/api/v3/ticker/price?symbols=" + encodeURIComponent(JSON.stringify([...pairs])), 6000);
      q.forEach((x) => liveP.set(x.symbol, { p: +x.price, at: Date.now() })); } catch (e) { /* keep ledger marks */ }
  }
  const coinById = () => new Map((T5?.coins || []).map((c) => [c.id, c]));
  const trades = () => (LED?.trades || []).filter((t) => !t.void);
  const livePx = (t) => { const l = t.binance_pair && liveP.get(t.binance_pair); return l && Date.now() - l.at < 180000 ? l.p : null; };
  function tradePnlPct(t) { // direction-aware % since signal (before fees), live if possible
    if (t.status === "closed") return { v: N(t.pnl_pct), src: "closed" };
    const lp = livePx(t), e = N(t.entry_price);
    if (lp && e) return { v: (t.side === "SHORT" ? -1 : 1) * (lp / e - 1) * 100, src: "live" };
    const mp = N(t.mark_price); if (mp && e) return { v: (t.side === "SHORT" ? -1 : 1) * (mp / e - 1) * 100, src: "mark " + (t.mark_at ? pkt(ts(t.mark_at)) : "") };
    return { v: null, src: "" };
  }

  // ---------- quality gate ----------
  const gateOf = (id, code) => (QG && QG.signals ? QG.signals.find((x) => x.id === id && x.code === code) || null : null);
  const gateTag = (g) => (!g ? "" : g.pass ? '<span class="qg-mini ok">✓ Gate pass</span>' : '<span class="qg-mini no">⛔ Filtered</span>');
  const gateWhy = (g) => (!g ? "" : g.pass ? `<span class="qg-why">Gate pass · TP ${fmtP(g.tp)} · SL ${fmtP(g.sl)} · R:R ${esc(g.rr)}</span>` : `<span class="qg-why">⛔ ${esc(g.reasons.slice(0, 2).map((r) => r.t).join(" · "))}${g.reasons.length > 2 ? " · +" + (g.reasons.length - 2) : ""}</span>`);
  const ultraKeys = () => new Set([...(UL?.active || []), ...(UL?.today || [])].map((x) => x.key));
  function renderUL() { const el = $("#usBody"); if (!el || !window.Ultra || (!UL && !FAIL.ul)) return; Ultra.render(el, UL); if (UL) $("#usVer").textContent = UL.version; }
  function renderQG() { const el = $("#qgBody"); if (!el || !window.QGate || (!QG && !FAIL.qg)) return; QGate.render(el, QG, "compact"); if (QG) $("#qgVer").textContent = QG.version; }

  // ---------- signals ----------
  const T5DIR = { pump: "LONG", breakout: "LONG", oversold: "LONG", dump: "SHORT", breakdown: "SHORT", overbought: "SHORT", hype: "HYPE" };
  function allSignals() {
    const out = [], uk = ultraKeys();
    for (const c of T5?.coins || []) {
      const s = c.signal || {}; const dir = T5DIR[s.code]; if (!dir) continue;
      if (P("risk") && (c.risk || {}).level === "High") continue;
      const gk = gateOf(c.id, s.code);
      out.push({ ultra: uk.has(c.id), gate: gk, book: "top500", code: s.code, id: c.id, sym: c.symbol, name: c.name, dir, label: s.label, reason: s.reason, ch: N(c.change_24h), chL: "24h", risk: c.risk, rank: c.rank });
    }
    return out;
  }

  // ---------- render ----------
  function renderHeader() {
    const t5At = ts(T5?.generated_at), ledAt = ts(LED?.updated_at);
    const fresh = t5At && Date.now() - t5At < 40 * 60000;
    const st = $("#status"); st.classList.toggle("warn", !fresh);
    $("#statusTxt").textContent = !T5 ? (FAIL.t5 ? "Data load fail" : "Loading…") : fresh ? "Bot Running" : "Data stale";
    st.title = `Top 500 data: ${t5At ? pkt(t5At) : "—"} · Paper ledger: ${ledAt ? pkt(ledAt) : "—"}`;
    const dot = $("#lvDot"); if (dot) dot.className = "lv-dot " + (!T5 ? "" : fresh ? "ok" : "warn");
    const stt = $("#statusTxt"); if (stt) stt.title = st.title;
    PaperChip.render($("#paperChip"), LED, livePx);
  }
  function renderStats() {
    // Market: breadth of non-stable top-500 coins + BTC 24h / 4h trend
    const cs = (T5?.coins || []).filter((c) => !c.kind && N(c.change_24h) != null);
    const btc = (T5?.coins || []).find((c) => c.id === "bitcoin");
    if (cs.length && btc) {
      const up = cs.filter((c) => c.change_24h > 0).length, br = (up / cs.length) * 100, b24 = N(btc.change_24h), t4 = (btc.ta || {}).trend_4h;
      let m = "NEUTRAL";
      if (br >= 60 && b24 > 0 && t4 !== "Downtrend") m = "BULLISH"; else if (br <= 40 && b24 < 0 && t4 !== "Uptrend") m = "BEARISH";
      const el = $("#sMarket"); el.textContent = m; el.className = "st-v " + (m === "BULLISH" ? "up" : m === "BEARISH" ? "down" : "flat");
      $("#sMarketS").textContent = Math.round(br) + "% coins up";
      $("#sMarketS").parentNode.parentNode.title = `${up}/${cs.length} coins 24h mein upar · BTC 24h ${pct(b24)} · BTC 4h trend ${t4 || "—"}`;
    }
    const sg = allSignals(); $("#sSignals").textContent = T5 ? sg.length : "—";
    $("#sSignalsS").textContent = T5 ? sg.filter((s) => s.dir === "LONG").length + "▲ " + sg.filter((s) => s.dir === "SHORT").length + "▼" + (QG ? " · " + (QG.counts.pass || 0) + "✓" : " abhi") : "";
    const tr = trades(), closed = tr.filter((t) => t.status === "closed"), wins = closed.filter((t) => N(t.pnl_usd) > 0).length;
    $("#sWin").textContent = closed.length ? ((wins / closed.length) * 100).toFixed(1) + "%" : "—";
    $("#sWinS").textContent = closed.length ? wins + "/" + closed.length + " paper" : "0 closed";
    // P&L 24h: realized (closed in last 24h) + unrealized of open, after fees, on $100 stakes
    const d24 = Date.now() - 864e5; let pnl = 0, stake = 0, n = 0;
    for (const t of tr) {
      if (t.status === "closed") { if (ts(t.exit_at) >= d24) { pnl += N(t.pnl_usd) || 0; stake += N(t.stake_usd) || 100; n++; } }
      else { const lp = livePx(t), fee = (t.fee_pct || 0.1) / 100;
        pnl += lp ? (t.side === "SHORT" ? -1 : 1) * (lp - t.entry_price) * t.qty - fee * t.entry_price * t.qty - fee * lp * t.qty : N(t.mark_pnl_usd) || 0;
        stake += N(t.stake_usd) || 100; n++; }
    }
    const el = $("#sPnl");
    if (n) { const p = (pnl / stake) * 100; el.textContent = pct(p); el.className = "st-v " + cls(p); $("#sPnlS").textContent = usd(pnl) + " · " + n + "T"; }
    else { el.textContent = "—"; el.className = "st-v"; $("#sPnlS").textContent = "koi trade nahi"; }
  }
  function renderLive() {
    const rows = [];
    for (const t of trades().filter((t) => t.status !== "closed").sort((a, b) => ts(b.entry_at) - ts(a.entry_at))) {
      if (t.book === "meme") continue;
      const r = tradePnlPct(t); rows.push({ sym: t.symbol, dir: t.side, v: r.v, sub: (t.tier === "ultra" ? "🔥 ULTRA " : "") + "paper · " + pkt(ts(t.entry_at)) + " se", id: t.key, book: t.book });
    }
    // fill with current signals (24h / 1h change, no entry → not "since signal")
    const strong = { pump: 0, breakout: 0, dump: 0, breakdown: 0, early: 1, overheated: 1, overbought: 2, oversold: 2, hype: 3 };
    const sg = allSignals().filter((s) => !rows.some((r) => r.sym === s.sym)).sort((a, b) => (strong[a.code] ?? 1) - (strong[b.code] ?? 1) || Math.abs(b.ch || 0) - Math.abs(a.ch || 0));
    for (const s of sg) { if (rows.length >= listN()) break; rows.push({ sym: s.sym, dir: s.dir, v: s.ch, sub: (s.ultra ? "🔥 ULTRA · " : "") + (s.gate ? (s.gate.pass ? "✓ gate · " : "⛔ filtered · ") : "") + s.label + " · " + s.chL + " change", id: s.id, book: s.book }); }
    const col = (d) => (d === "LONG" ? C.up : d === "SHORT" ? C.down : C.accent);
    const n = listN();
    $("#liveSignals").innerHTML = rows.length ? rows.slice(0, n).map((r) => `<div class="r" data-open="${esc(r.book)}:${esc(r.id)}"><i class="bul" style="background:${col(r.dir)}33;border:1.5px solid ${col(r.dir)}"></i><span class="sym">${esc(r.sym)}</span>
      <span class="dir" style="color:${col(r.dir)}">${r.dir === "LONG" ? "▲ LONG" : r.dir === "SHORT" ? "▼ SHORT" : "◆ HYPE"}</span><span class="pc ${cls(r.v)}">${pct(r.v)}</span><span class="src">${esc(r.sub)}</span></div>`).join("")
      : '<div class="empty">Abhi koi active signal nahi</div>';
  }
  function renderPerf() {
    const tr = trades(), closed = tr.filter((t) => t.status === "closed"), wins = closed.filter((t) => N(t.pnl_usd) > 0).length;
    const holds = closed.map((t) => N(t.hold_h)).filter((v) => v != null), avg = holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null;
    const hold = avg == null ? "—" : avg < 1 ? Math.round(avg * 60) + "m" : avg < 48 ? Math.floor(avg) + "h " + Math.round((avg % 1) * 60) + "m" : (avg / 24).toFixed(1) + "d";
    $("#perf").innerHTML = [["Total Trades", tr.length, ""], ["Wins", closed.length ? wins : "—", "up"], ["Losses", closed.length ? closed.length - wins : "—", "down"],
      ["Win Rate", closed.length ? ((wins / closed.length) * 100).toFixed(1) + "%" : "—", "up"], ["Avg. Hold Time", hold, ""]]
      .map(([l, v, c]) => `<div class="pr"><span>${l}</span><b class="${v === "—" ? "" : c}">${v}</b></div>`).join("") +
      (closed.length ? "" : `<div class="em">Abhi koi closed trade nahi · ${tr.length - closed.length} open</div>`);
  }
  function renderPnl() {
    const closed = trades().filter((t) => t.status === "closed" && t.exit_at).sort((a, b) => ts(a.exit_at) - ts(b.exit_at));
    const cv = $("#pnlChart"), msg = $("#pnlMsg"), pill = $("#pnlPill");
    const b = PaperChip.calc(LED, livePx);
    if (!closed.length) {
      const ctx = setupCanvas(cv); ctx && ctx.clearRect(0, 0, cv.width, cv.height);
      msg.innerHTML = "<div>Abhi koi closed trade nahi.</div><div>Trade band hote hi yahan P&amp;L graph aayega.</div>" + (b.open ? `<div><b class="${cls(b.unreal)}">Open P&amp;L: ${usd(b.unreal)}</b></div>` : "");
      pill.textContent = b.have ? pct(b.pct) : "—"; pill.className = "pnl-pill " + cls(b.pct); return;
    }
    msg.textContent = "";
    let cum = 0; const pts = [{ t: ts(LED.started_at) || ts(closed[0].entry_at), v: 0 }, ...closed.map((t) => ({ t: ts(t.exit_at), v: (cum += N(t.pnl_usd) || 0) }))];
    const stake = closed.length * 100, p = (cum / stake) * 100;
    pill.textContent = pct(p); pill.className = "pnl-pill " + cls(p);
    const ctx = setupCanvas(cv); if (!ctx) return;
    const W = cv.clientWidth, H = cv.clientHeight, ax = 34;
    const vs = pts.map((x) => x.v), lo = Math.min(0, ...vs), hi = Math.max(0.01, ...vs), t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
    const X = (t) => 4 + ((t - t0) / (t1 - t0)) * (W - ax - 10), Y = (v) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 18);
    ctx.font = "9px Outfit,sans-serif"; ctx.fillStyle = C.axis; ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const v = lo + ((hi - lo) * i) / 3, y = Y(v); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - ax, y); ctx.stroke(); ctx.fillText((v >= 0 ? "+$" : "-$") + Math.abs(v).toFixed(Math.abs(hi - lo) < 5 ? 2 : 0), W - ax + 3, y + 3); }
    const up = cum >= 0, c1 = up ? C.up : C.down;
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, up ? "rgba(31,158,88,.35)" : "rgba(212,57,63,.30)"); g.addColorStop(1, "rgba(10,10,11,0)");
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v)))); ctx.lineTo(X(pts[pts.length - 1].t), H); ctx.lineTo(X(pts[0].t), H); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v)))); ctx.strokeStyle = c1; ctx.lineWidth = 2; ctx.stroke();
    const l = pts[pts.length - 1]; ctx.beginPath(); ctx.arc(X(l.t), Y(l.v), 3.5, 0, 7); ctx.fillStyle = c1; ctx.fill();
  }
  function rowSig(s) {
    return `<div class="row" data-open="${esc(s.book)}:${esc(s.id)}"><div class="a">${esc(s.sym)}<small>${esc(s.name || "")}</small>${s.ultra ? '<span class="qg-mini ul">🔥 Ultra</span>' : ""}${gateTag(s.gate)}<span class="badge ${s.dir === "LONG" ? "b-long" : s.dir === "SHORT" ? "b-short" : "b-info"}">${s.dir === "LONG" ? "▲ LONG" : s.dir === "SHORT" ? "▼ SHORT" : "◆ HYPE"}</span></div>
      <div class="b ${cls(s.ch)}">${pct(s.ch)} <small class="muted">${s.chL}</small></div><div class="c">${esc(s.label)} · ${esc(s.reason || "")}${s.risk ? " · risk " + esc(s.risk.score) + " (" + esc(s.risk.level) + ")" : ""} · Top 500 #${s.rank ?? "—"}${gateWhy(s.gate)}</div></div>`;
  }
  // ---------- Live signal cards (h15) ----------
  let fK = "all";
  const favs = (() => { try { return new Set(JSON.parse(localStorage.getItem("hr_fav") || "[]")); } catch (e) { return new Set(); } })();
  const openWhy = new Set();
  const STRONG_MIN = 62; // = Signal Judge strict min agreement score (agent.py), not a win chance
  const PD = { pump: 1, dump: 1, breakout: 1, breakdown: 1 };
  const fmtV = (v) => { v = N(v); if (v == null) return "—"; return v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? Math.round(v / 1e6) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "K" : Math.round(v) + ""; };
  function judgeOf(id) { return AG && AG.coins ? AG.coins[id] || null : null; }
  function cardData() {
    const byId = coinById();
    return allSignals().filter((s) => s.dir === "LONG" || s.dir === "SHORT").map((s) => {
      const c = byId.get(s.id) || {}, j = judgeOf(s.id), x = c.x || {};
      const opp = j && j.verdict === (s.dir === "LONG" ? "SELL" : "BUY");
      const jsc = j && N(j.score) != null ? N(j.score) : null;
      return Object.assign({}, s, { c, j, score: jsc, strong: jsc != null && jsc >= STRONG_MIN && !opp, xs: x.fresh ? N(x.spike) : null, vol: N(c.volume_24h), price: N(c.price) });
    });
  }
  function passF(d) {
    switch (fK) { case "gate": return d.gate && d.gate.pass; case "ultra": return d.ultra; case "strong": return d.strong; case "long": return d.dir === "LONG"; case "short": return d.dir === "SHORT";
      case "pd": return !!PD[d.code]; case "x": return d.xs != null && d.xs >= 1.8; default: return true; }
  }
  function ring(score, dir) {
    const v = score == null ? 0 : Math.max(0, Math.min(100, score)), r = 17, cf = 2 * Math.PI * r, col = dir === "LONG" ? C.up : C.down;
    return `<div class="lv-ring" title="Indicator agreement score (Signal Judge) — jeetne ka chance nahi"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="${r}" class="rg-bg"/><circle cx="22" cy="22" r="${r}" class="rg-fg" style="stroke:${col};stroke-dasharray:${(cf * v / 100).toFixed(1)} ${cf.toFixed(1)}"/></svg><b>${score == null ? "—" : score}</b><small>score</small></div>`;
  }
  function levels(d) {
    const g = d.gate || {}, ta = d.c.ta || {};
    if (N(g.tp) != null && N(g.sl) != null) return { e: N(g.price) ?? d.price, tp: N(g.tp), sl: N(g.sl), src: g.pass ? "qg1 gate levels" : "qg1 levels (signal gate-blocked)", rr: g.rr };
    // no gate levels: show existing zones only (never invented)
    const bz = ta.buy_zone, sz = ta.sell_zone;
    if (bz || sz) return { e: d.price, zb: bz, zs: sz, src: "support / resistance zones" };
    return null;
  }
  function whyHtml(d) {
    const g = d.gate, j = d.j, li = (t, cls) => `<li class="${cls || ""}">${esc(t)}</li>`;
    let h = `<div class="lv-why"><div class="wy-h">Signal</div><ul>${li(d.label + (d.reason ? " · " + d.reason : ""))}${li("Top 500 #" + (d.rank ?? "—") + (d.risk ? " · risk " + d.risk.score + " (" + d.risk.level + ")" : ""))}</ul>`;
    h += `<div class="wy-h">Quality Gate (qg1)</div><ul>${!g ? li("gate data abhi nahi", "mu") : g.pass ? li("✓ saare checks pass" + (g.rr ? " · R:R " + g.rr : ""), "ok") : g.reasons.map((r) => li("⛔ " + r.t, "no")).join("")}</ul>`;
    h += `<div class="wy-h">Signal Judge (Strict)</div><ul>${!j ? li("Judge data abhi nahi", "mu") : li("Verdict " + j.verdict + " · agreement score " + (j.score ?? "—") + (j.skip_reason ? " · " + j.skip_reason : "")) + (j.reasons || []).slice(0, 4).map((r) => li(r)).join("")}</ul>`;
    const uc = (UL?.candidates || []).find((u) => u.key === d.id);
    if (uc) h += `<div class="wy-h">Ultra score ${esc(uc.score)}/100</div><ul>${(uc.why_not || []).length ? uc.why_not.slice(0, 3).map((w) => li("• " + w, "mu")).join("") : li("eligible", "ok")}</ul>`;
    return h + `<p class="wy-n">Score = indicators kitna agree karte hain, jeetne ka chance nahi. Pichle results guarantee nahi.</p></div>`;
  }
  function card(d) {
    const up = d.dir === "LONG", col = up ? "lg" : "sh", lv = levels(d), fav = favs.has(d.id), init = esc((d.sym || "?").slice(0, 1).toUpperCase());
    const box = (k, v, c2) => `<span class="lv-box ${c2 || ""}"><i>${k}</i>${esc(v)}</span>`;
    const lvl = !lv ? "" : lv.tp != null ? `<div class="lv-lvls" title="${esc(lv.src)}">${box("E", fmtP(lv.e))}${box("TP", fmtP(lv.tp))}${box("SL", fmtP(lv.sl))}</div>`
      : `<div class="lv-lvls" title="${esc(lv.src)}">${lv.zb ? box("BZ", fmtP(lv.zb[0]) + "–" + fmtP(lv.zb[1])) : ""}${lv.zs ? box("SZ", fmtP(lv.zs[0]) + "–" + fmtP(lv.zs[1])) : ""}</div>`;
    const tags = (d.ultra ? '<span class="lv-tag t-ul">🔥 ULTRA</span>' : "") + (d.gate && d.gate.pass ? '<span class="lv-tag t-gp">✓ GATE PASS</span>' : "") + (d.strong ? '<span class="lv-tag t-st">✦ STRONG</span>' : "")
      + (d.gate && !d.gate.pass ? '<span class="lv-tag t-bl">⛔ filtered</span>' : "") + (d.xs != null && d.xs >= 1.8 ? `<span class="lv-tag t-x">X ${d.xs.toFixed(1)}x</span>` : "");
    return `<article class="lv-card ${col}${d.ultra ? " ul" : ""}">
      <div class="lv-top"><button class="lv-star ${fav ? "on" : ""}" data-fav="${esc(d.id)}" aria-label="Watch">${fav ? "★" : "☆"}</button><span class="lv-av">${init}</span>
        <div class="lv-id"><div class="lv-sym">${esc(d.sym)}<small>USDT</small></div><div class="lv-side ${col}">${up ? "↗ LONG" : "↘ SHORT"} <span>· vol ${fmtV(d.vol)}</span></div></div>${ring(d.score, d.dir)}</div>
      ${tags ? `<div class="lv-tags">${tags}</div>` : ""}
      <div class="lv-mid"><div class="lv-px"><b>$${fmtP(d.price)}</b><span class="${cls(d.ch)}">${pct(d.ch)}</span></div>${lvl}</div>
      <div class="lv-act"><button class="lv-go ${col}" data-open="top500:${esc(d.id)}">View ${up ? "LONG" : "SHORT"} setup →</button><button class="lv-whyb ${openWhy.has(d.id) ? "on" : ""}" data-why="${esc(d.id)}">WHY?</button></div>
      ${openWhy.has(d.id) ? whyHtml(d) : ""}
    </article>`;
  }
  function renderCards() {
    const box = $("#cards"); if (!box) return;
    if (!T5) { if (FAIL.t5) box.innerHTML = UNAV(FAIL.t5); return; }
    const all = cardData(), q = ($("#lq").value || "").trim().toLowerCase();
    const rows = all.filter(passF).filter((d) => !q || d.sym.toLowerCase().includes(q) || (d.name || "").toLowerCase().includes(q) || d.id.includes(q))
      .sort((a, b) => favs.has(b.id) - favs.has(a.id) || b.ultra - a.ultra || !!(b.gate && b.gate.pass) - !!(a.gate && a.gate.pass) || b.strong - a.strong || (b.score ?? -1) - (a.score ?? -1) || Math.abs(b.ch || 0) - Math.abs(a.ch || 0));
    const n = listN(), shown = rows.slice(0, n);
    const cnt = (f) => all.filter(f).length;
    $("#countLine").innerHTML = `<b>${all.length}</b> signals · <b>${cnt((d) => d.dir === "LONG")}</b> long · <b>${cnt((d) => d.dir === "SHORT")}</b> short · <b>${cnt((d) => d.gate && d.gate.pass)}</b> gate pass · <b>${cnt((d) => d.ultra)}</b> ultra · <b>${cnt((d) => d.strong)}</b> strong` + (rows.length > n ? ` <span class="mu">· showing ${n}/${rows.length}</span>` : "");
    box.innerHTML = shown.length ? shown.map(card).join("") : '<div class="lv-empty">Is filter mein abhi koi signal nahi.</div>';
  }
  function marketMood() {
    const cs = (T5?.coins || []).filter((c) => !c.kind && N(c.change_24h) != null), btc = (T5?.coins || []).find((c) => c.id === "bitcoin");
    if (!cs.length || !btc) return null;
    const up = cs.filter((c) => c.change_24h > 0).length, br = (up / cs.length) * 100, b24 = N(btc.change_24h), t4 = (btc.ta || {}).trend_4h;
    let m = "NEUTRAL"; if (br >= 60 && b24 > 0 && t4 !== "Downtrend") m = "BULLISH"; else if (br <= 40 && b24 < 0 && t4 !== "Uptrend") m = "BEARISH";
    return { m, br, up, n: cs.length, btc, b24, t4 };
  }
  function renderTop() {
    const mm = marketMood(), el = $("#regime"); if (!el) return;
    if (!mm) { el.innerHTML = `<span class="rg-pill">${T5 ? "BTC data n/a" : FAIL.t5 ? "data unavailable" : "Loading…"}</span>`; return; }
    const ta = mm.btc.ta || {}, lp = liveP.get("BTCUSDT"), bp = lp && Date.now() - lp.at < 180000 ? lp.p : N(mm.btc.price);
    const tr = (lab, t) => { const k = t === "Uptrend" ? "up" : t === "Downtrend" ? "down" : "flat"; return `<span class="rg-pill"><i>${lab}</i><b class="${k}">${t === "Uptrend" ? "UP" : t === "Downtrend" ? "DOWN" : t ? "RANGE" : "n/a"}</b></span>`; };
    const c1 = N(mm.btc.change_1h);
    el.innerHTML = `<span class="rg-pill rg-m ${mm.m === "BULLISH" ? "up" : mm.m === "BEARISH" ? "down" : "flat"}">${mm.m === "BULLISH" ? "▲" : mm.m === "BEARISH" ? "▼" : "◆"} ${mm.m}</span>
      <span class="rg-pill"><i>BTC</i><b>${fmtP(bp)}</b><b class="${cls(mm.b24)}">${pct(mm.b24)}</b><i>24H</i></span>
      <span class="rg-pill"><i>1H</i><b class="${cls(c1)}">${pct(c1, 1)}</b></span>${tr("4H", ta.trend_4h)}${tr("1D", ta.trend)}`;
    const b = $("#breadth"); if (b) { b.innerHTML = `<i class="b-up" style="width:${mm.br.toFixed(1)}%"></i><i class="b-dn" style="width:${(100 - mm.br).toFixed(1)}%"></i>`; b.title = `${mm.up}/${mm.n} coins 24h mein upar (${Math.round(mm.br)}%)`; }
  }
  function renderAnalysis() {
    const q = $("#aq").value.trim().toLowerCase();
    const cs = (T5?.coins || []).filter((c) => !q || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.id.includes(q)).slice(0, listN());
    $("#aList").innerHTML = cs.map((c) => { const ta = c.ta || {};
      return `<div class="row" data-open="top500:${esc(c.id)}"><div class="a">#${c.rank} ${esc(c.symbol)}<small>${esc(c.name)}</small>${ta.trend ? `<span class="badge ${ta.trend === "Uptrend" ? "b-long" : ta.trend === "Downtrend" ? "b-short" : "b-info"}">${esc(ta.trend)}</span>` : ""}</div>
      <div class="b">$${fmtP(c.price)} <span class="${cls(c.change_24h)}">${pct(c.change_24h, 1)}</span></div>
      <div class="c">RSI ${N(ta.rsi) != null ? ta.rsi.toFixed(0) : "—"} · buy zone ${N(ta.buy_dist_pct) != null ? ta.buy_dist_pct.toFixed(1) + "% door" : "—"} · sell zone ${N(ta.sell_dist_pct) != null ? ta.sell_dist_pct.toFixed(1) + "% door" : "—"} · risk ${esc((c.risk || {}).score ?? "—")}</div></div>`; }).join("") || '<div class="empty">Koi coin nahi mila</div>';
  }
  function renderStatus() {
    const r = (l, v) => `<div class="pr"><span>${l}</span><b>${v}</b></div>`;
    $("#dataStatus").innerHTML = r("Top 500 data", T5 ? pkt(ts(T5.generated_at)) + " (" + ago(ts(T5.generated_at)) + ")" : "—") +
      r("Paper ledger", LED ? pkt(ts(LED.updated_at)) : "—") + r("Signal Judge", AG ? pkt(ts(AG.generated_at || AG.data_at)) : "—") + r("Chart", chartAt ? chartSrc + " · " + pktS(chartAt) : "—") + r("App refresh", lastData ? pktS(lastData) : "—");
  }
  function renderJudge() {
    const acc = $("#judgeAcc"), mood = $("#judgeMood"), box = $("#judgePicks");
    if (!acc || !mood || !box) return;
    if (!AG) { acc.textContent = "—"; mood.innerHTML = '<span class="muted">Signal Judge data abhi load nahi hua</span>'; box.innerHTML = ""; return; }
    const a4 = (AG.track_record && AG.track_record.agent && AG.track_record.agent["4h"]) || {};
    const a24 = (AG.track_record && AG.track_record.agent && AG.track_record.agent["24h"]) || {};
    const accTxt = (slot, lab) => slot.accuracy_pct != null ? lab + " " + slot.accuracy_pct + "% (" + slot.correct + "/" + slot.n + ")" : lab + " —";
    acc.textContent = (a4.accuracy_pct != null || a24.accuracy_pct != null) ? accTxt(a4, "4h") + " · " + accTxt(a24, "24h") : "Accuracy —";
    acc.title = (a4.note || "") + " · " + (a24.note || "abhi data kam hai");
    const m = AG.mood || {}, lab = m.label || "—";
    const tagC = lab === "BULLISH" ? "mood-bull" : lab === "BEARISH" ? "mood-bear" : "mood-caut";
    mood.innerHTML = `<span class="mood-tag ${tagC}">${esc(lab)}</span> ${esc(m.summary || "")}`;
    const n = listN();
    const col = (title, rows, empty) => {
      const xs = (rows || []).slice(0, n);
      const body = xs.length
        ? xs.map((j) => `<div class="jp" data-open="top500:${esc(j.id)}"><span class="a">${esc(j.symbol)}<small class="muted"> #${j.rank ?? ""}</small></span><span class="b">score ${j.score ?? "—"}</span><span class="c">${esc((j.reasons && j.reasons[0]) || "")} · 24h ${pct(j.change_24h, 1)}</span></div>`).join("")
        : `<div class="empty">${empty}</div>`;
      return `<div class="judge-col"><h4>${title}</h4>${body}</div>`;
    };
    box.innerHTML = col("🟢 BUY picks", (AG.picks || {}).buy, "abhi koi mazboot setup nahi") + col("🔴 SELL picks", (AG.picks || {}).sell, "abhi koi mazboot setup nahi");
  }
  function safe(fn) { try { fn(); } catch (e) { (window.__bootErr || (window.__bootErr = [])).push(fn.name + ": " + (e && e.message)); try { console.warn("render", fn.name, e); } catch (x) {} } }
  const UNAV = (why) => `<div class="empty">Data abhi load nahi hua (${esc(why)}). Neeche khench kar refresh karein.</div>`;
  function renderFallbacks() {
    const set = (sel, html) => { const el = $(sel); if (el && /Loading/.test(el.textContent)) el.innerHTML = html; };
    if (!T5 && FAIL.t5) { set("#liveSignals", UNAV(FAIL.t5)); $("#statusTxt").textContent = "Data load fail"; $("#status").classList.add("warn"); }
    if (!AG && FAIL.ag) { set("#judgeMood", '<span class="muted">Signal Judge data unavailable (' + esc(FAIL.ag) + ")</span>"); $("#judgeAcc").textContent = "—"; }
    if (!UL && FAIL.ul) set("#usBody", '<div class="qg-empty">Ultra data unavailable (' + esc(FAIL.ul) + ") — thori der baad khud try hoga</div>");
    if (!QG && FAIL.qg) set("#qgBody", '<div class="qg-empty">Quality Gate data unavailable (' + esc(FAIL.qg) + ")</div>");
  }
  function renderAll() {
    window.__homeBoot = true;
    if (T5 || LED || AG) [renderHeader, renderStats, renderLive, renderUL, renderJudge, renderQG, renderPerf, renderPnl, renderTop, renderCards, renderAnalysis, renderStatus].forEach(safe);
    else { safe(renderUL); safe(renderQG); safe(renderTop); safe(renderCards); }
    safe(renderFallbacks);
  }
  document.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]"); if (!o) return;
    const [book, id] = o.dataset.open.split(/:(.*)/s);
    location.href = "top500.html?v=" + VER + "#coin=" + encodeURIComponent(id);
  });
  $("#chips").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (!b) return; haptic(); fK = b.dataset.f; $$("#chips button").forEach((x) => x.classList.toggle("on", x === b)); safe(renderCards); });
  $("#lq").addEventListener("input", () => safe(renderCards));
  $("#cards").addEventListener("click", (e) => {
    const w = e.target.closest("[data-why]"), f = e.target.closest("[data-fav]");
    if (w) { const id = w.dataset.why; openWhy.has(id) ? openWhy.delete(id) : openWhy.add(id); haptic(); safe(renderCards); }
    if (f) { const id = f.dataset.fav; favs.has(id) ? favs.delete(id) : favs.add(id); try { localStorage.setItem("hr_fav", JSON.stringify([...favs].slice(-50))); } catch (er) {} haptic(); safe(renderCards); }
  });
  let subV = "signals";
  function goSub(v) { subV = v === "dash" ? "dash" : "signals"; $$(".sub-v").forEach((x) => x.classList.toggle("on", x.id === "sv-" + subV)); $$("#lvSeg button").forEach((b) => b.classList.toggle("on", b.dataset.sv === subV)); if (subV === "dash") { safe(drawChart); safe(renderPnl); } }
  $("#lvSeg").addEventListener("click", (e) => { const b = e.target.closest("button[data-sv]"); if (!b) return; haptic(); go("live"); goSub(b.dataset.sv); });
  $("#aq").addEventListener("input", renderAnalysis);
  $("#paperChip").addEventListener("click", () => (location.href = "paper.html?v=" + VER));

  // ---------- views ----------
  const ALIAS = { dashboard: "live", signals: "live", scanner: "live", settings: "live", home: "live", research: "analysis" };
  function go(v, push = true) {
    const want = v; v = ALIAS[v] || v;
    if (!$("#v-" + v)) v = "live";
    $$(".view").forEach((x) => x.classList.toggle("on", x.id === "v-" + v));
    $$("#bbar button[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    const seg = $("#lvSeg"); if (seg) seg.style.display = v === "live" ? "" : "none";
    if (push && history.replaceState) history.replaceState(null, "", v === "live" ? location.pathname + location.search : "#" + v);
    scrollTo(0, 0);
    if (v === "live" && (want === "dashboard" || want === "settings")) goSub("dash");
    if (v === "live" && subV === "dash") { drawChart(); renderPnl(); }
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("#bbar button"); if (!b) return; haptic(); if (b.dataset.href) location.href = b.dataset.href + "?v=" + VER; else go(b.dataset.v); });

  // ---------- candlestick chart ----------
  let pair = (() => { try { return JSON.parse(localStorage.getItem("hr_pair")) || null; } catch (e) { return null; } })() || { sym: "BTC", pair: "BTCUSDT", src: "binance", rank: 1 };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let tf = lsGet("hr_tf") || "5m", candles = [], chartAt = 0, chartSrc = "", chartBusy = false, chartErr = "";
  const TFB = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "1h": "60", "4h": "240" }, TFO = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H" };
  const base = (p) => p.pair.replace(/[-_]?USDT$/i, "").replace(/[-_]/g, "");
  async function fetchK(src, p) {
    const b = base(p), L = 120;
    if (src === "binance") { const r = await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=${b}USDT&interval=${tf}&limit=${L}`, 7000); return r.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })); }
    if (src === "bybit") { const r = await getJSON(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${b}USDT&interval=${TFB[tf]}&limit=${L}`, 7000); if (r.retCode) throw new Error(r.retMsg);
      return r.result.list.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse(); }
    if (src === "okx") { const r = await getJSON(`https://www.okx.com/api/v5/market/candles?instId=${b}-USDT&bar=${TFO[tf]}&limit=${L}`, 7000); if (r.code !== "0") throw new Error(r.msg);
      return r.data.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse(); }
    throw new Error("src");
  }
  async function loadChart() {
    if (chartBusy) return; chartBusy = true;
    try { await loadChart0(); } catch (e) { chartErr = "Chart load error: " + (e && e.message); } finally { chartBusy = false; safe(drawChart); }
  }
  async function loadChart0() {
    // verified exchange first; other exchanges only for top-50 tickers (avoid same-ticker different coin)
    const order = [pair.src, ...((pair.rank || 999) <= 50 ? ["binance", "bybit", "okx"] : [])].filter((s, i, a) => ["binance", "bybit", "okx"].includes(s) && a.indexOf(s) === i);
    let ok = false;
    const res = await Promise.allSettled(order.map((s) => fetchK(s, pair)));  // parallel, each with its own 7 s timeout
    for (let i = 0; i < order.length; i++) { const r = res[i]; if (r.status === "fulfilled" && r.value.length > 5) { candles = r.value; chartSrc = { binance: "Binance", bybit: "Bybit", okx: "OKX" }[order[i]]; chartAt = Date.now(); chartErr = ""; ok = true; break; } }
    if (!ok) chartErr = order.length ? "Is waqt candles nahi mil sakin (exchange API fail/limit). Thori der baad khud try hoga." : "Is coin ki candles Binance/Bybit/OKX par nahi — chart available nahi.";
  }
  function ema(vals, n) { const k = 2 / (n + 1); let e = null; return vals.map((v, i) => (e = i === 0 ? v : v * k + e * (1 - k))); }
  function setupCanvas(cv) { const r = cv.getBoundingClientRect(); if (!r.width) return null; const d = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); const ctx = cv.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0); return ctx; }
  function drawChart() {
    $("#pairName").textContent = base(pair) + "/USDT";
    $$("#tfs button").forEach((b) => b.classList.toggle("on", b.dataset.tf === tf));
    $("#pairTag").textContent = "Live " + tf;
    const cv = $("#chart"), msg = $("#chartMsg"), ctx = setupCanvas(cv); if (!ctx) return;
    if (!candles.length) { msg.textContent = chartErr || "Candles load ho rahi hain…"; $("#chartInfo").textContent = "—"; return; }
    msg.textContent = chartErr && Date.now() - chartAt > 120000 ? "⚠ " + chartErr : "";
    const W = cv.clientWidth, H = cv.clientHeight, ax = 50, vh = 34, ph = H - vh - 6;
    const ce = candles.map((c) => c.c), e9 = ema(ce, 9), e21 = ema(ce, 21);
    const n = Math.min(candles.length, Math.max(30, Math.floor((W - ax) / 5.2))), s0 = candles.length - n, cs = candles.slice(s0);
    let lo = Infinity, hi = -Infinity; cs.forEach((c, i) => { lo = Math.min(lo, c.l, e21[s0 + i]); hi = Math.max(hi, c.h, e21[s0 + i]); });
    const pad = (hi - lo) * 0.06 || hi * 0.001; lo -= pad; hi += pad;
    const cw = (W - ax - 4) / n, Y = (p) => 4 + (1 - (p - lo) / (hi - lo)) * (ph - 8), X = (i) => 2 + i * cw + cw / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "9.5px Outfit,sans-serif"; ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) { const p = lo + ((hi - lo) * i) / 5, y = Y(p); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - ax, y); ctx.stroke(); ctx.fillStyle = C.axis; ctx.fillText(fmtP(p), W - ax + 5, y + 3); }
    ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(W - ax + 0.5, 0); ctx.lineTo(W - ax + 0.5, H); ctx.stroke();
    const vmax = Math.max(...cs.map((c) => c.v)) || 1;
    cs.forEach((c, i) => { const up = c.c >= c.o, x = X(i), bw = Math.max(1.8, cw * 0.62), col = up ? C.up : C.down, wick = up ? C.upWick : C.downWick;
      ctx.fillStyle = up ? "rgba(31,158,88,.30)" : "rgba(212,57,63,.30)"; const vhh = (c.v / vmax) * vh; ctx.fillRect(x - bw / 2, H - vhh, bw, vhh);
      ctx.strokeStyle = wick; ctx.lineWidth = 1.35; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c)), bh = Math.max(1.6, y2 - y1);
      ctx.fillStyle = col; ctx.fillRect(x - bw / 2, y1, bw, bh);
      ctx.lineWidth = 1; ctx.strokeRect(x - bw / 2, y1, bw, bh); });
    [[e21, C.accent2, 1.15], [e9, C.accent, 1.25]].forEach(([e, col, w]) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath(); for (let i = 0; i < n; i++) { const y = Y(e[s0 + i]); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); } ctx.stroke(); });
    const last = cs[cs.length - 1], ly = Math.min(Math.max(Y(last.c), 8), ph - 6), lc = last.c >= last.o ? C.up : C.down;
    ctx.setLineDash([3, 3]); ctx.strokeStyle = lc; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W - ax, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = lc; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W - ax + 1, ly - 8, ax - 2, 16, 4) : ctx.rect(W - ax + 1, ly - 8, ax - 2, 16); ctx.fill();
    ctx.fillStyle = C.ink; ctx.font = "600 9.5px Outfit,sans-serif"; ctx.fillText(fmtP(last.c), W - ax + 4, ly + 3.5);
    const first = candles[0], ch = (last.c / cs[0].o - 1) * 100;
    $("#chartInfo").innerHTML = `${chartSrc} live · <span class="${cls(ch)}">${pct(ch)}</span> · ${pktS(chartAt)}`;
  }
  $("#tfs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; tf = b.dataset.tf; lsSet("hr_tf", tf); candles = []; haptic(); drawChart(); loadChart(); });
  // pair picker
  const sheet = $("#pairSheet"), bd = $("#backdrop");
  const chartable = () => (T5?.coins || []).filter((c) => c.ta && ["binance", "bybit", "okx"].includes(c.ta.src) && c.ta.pair);
  function renderPairs() { const q = $("#pq").value.trim().toLowerCase();
    const cs = chartable().filter((c) => !q || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, 80);
    $("#pList").innerHTML = cs.map((c) => `<div class="row" data-pair="${esc(c.id)}"><div class="a">${esc(c.symbol)}/USDT<small>#${c.rank} ${esc(c.name)}</small></div><div class="b">$${fmtP(c.price)}</div><div class="c">${esc(c.ta.src)} · ${esc(c.ta.pair)}</div></div>`).join("") || '<div class="empty">Koi chart wala coin nahi mila</div>'; }
  const openSheet = () => { renderPairs(); sheet.classList.add("on"); bd.classList.add("on"); };
  const closeSheet = () => { sheet.classList.remove("on"); bd.classList.remove("on"); };
  $("#pairBtn").onclick = openSheet; $("#pairClose").onclick = closeSheet; bd.onclick = closeSheet; $("#pq").addEventListener("input", renderPairs);
  $("#pList").addEventListener("click", (e) => { const r = e.target.closest("[data-pair]"); if (!r) return; e.stopPropagation(); const c = chartable().find((x) => x.id === r.dataset.pair); if (!c) return;
    pair = { sym: c.symbol, pair: c.ta.pair, src: c.ta.src, rank: c.rank }; lsSet("hr_pair", JSON.stringify(pair)); candles = []; closeSheet(); drawChart(); loadChart(); });

  // ---------- refresh loop ----------
  let busy = null, seen = (() => { try { return new Set(JSON.parse(localStorage.getItem("hr_seen") || "[]")); } catch (e) { return new Set(); } })(), firstSeen = !seen.size;
  function checkNew() {
    const ids = trades().map((t) => t.id), fresh = ids.filter((i) => !seen.has(i));
    if (fresh.length && !firstSeen && P("vib")) { const t = trades().find((x) => x.id === fresh[fresh.length - 1]); toast("Naya paper signal: " + t.symbol + " " + t.side); try { tg && tg.HapticFeedback ? tg.HapticFeedback.notificationOccurred("success") : navigator.vibrate && navigator.vibrate(120); } catch (e) {} }
    ids.forEach((i) => seen.add(i)); firstSeen = false; try { localStorage.setItem("hr_seen", JSON.stringify([...seen].slice(-300))); } catch (e) {}
  }
  function refresh(manual) {
    if (busy) return busy;
    loadChart().catch(() => {});  // independent: a slow/blocked exchange never holds the cards
    busy = (async () => { await loadData(); safe(checkNew); renderAll(); if (manual) toast("Refreshed · " + pktS(Date.now())); })().finally(() => (busy = null));
    return busy;
  }
  renderToggles();
  if (window.ListN) ListN.fill();
  addEventListener("listn-change", () => { renderAll(); });
  go((location.hash || "").replace("#", "") || "live", false);
  drawChart(); refresh();
  setInterval(() => { if (!document.hidden && P("auto")) loadChart(); }, 10000);
  setInterval(() => { if (!document.hidden && P("auto")) refresh(); }, 60000);
  setInterval(() => { if (!document.hidden && P("auto")) livePrices().then(() => { safe(renderHeader); safe(renderStats); safe(renderLive); safe(renderTop); }); }, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && P("auto") && Date.now() - lastData > 45000) refresh(); });
  addEventListener("resize", () => { drawChart(); renderPnl(); });

  // ---------- pull-to-refresh ----------
  const ptr = $("#ptr"), TH = 75; let y0 = null, dy = 0;
  const setPull = (d) => { ptr.style.transform = `translate(-50%, ${Math.min(d, 100) - 60}px)`; ptr.style.opacity = Math.min(d / TH, 1); $("#ptrTxt").textContent = d >= TH ? "Release to refresh" : "Pull to refresh"; };
  addEventListener("touchstart", (e) => { if (scrollY <= 0 && !sheet.classList.contains("on") && !e.target.closest(".pills,.seg")) { y0 = e.touches[0].clientY; dy = 0; ptr.classList.remove("snap"); } }, { passive: true });
  addEventListener("touchmove", (e) => { if (y0 == null) return; dy = (e.touches[0].clientY - y0) * 0.5; if (dy > 0) { setPull(dy); if (e.cancelable) e.preventDefault(); } else setPull(0); }, { passive: false });
  addEventListener("touchend", async () => { if (y0 == null) return; y0 = null; ptr.classList.add("snap");
    if (dy >= TH) { ptr.classList.add("spin"); $("#ptrTxt").textContent = "Refreshing…"; setPull(TH); haptic("medium"); await refresh(true); ptr.classList.remove("spin"); } setPull(0); });
})();
