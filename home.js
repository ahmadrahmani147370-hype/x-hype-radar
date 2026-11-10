/* Home dashboard — every number comes from data/top500.json, data/paper/trades.json
   or live public exchange APIs (Binance → Bybit → OKX klines). Missing values show "—". */
(() => {
  "use strict";
  const VER = "h13";
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
  async function loadData() {
    const [a, c, g, q, uu] = await Promise.allSettled([getJSON("data/top500.json?t=" + Date.now()), getJSON("data/paper/trades.json?t=" + Date.now()), getJSON("data/agent.json?t=" + Date.now()), getJSON("data/quality.json?t=" + Date.now()), getJSON("data/ultra.json?t=" + Date.now())]);
    if (q.status === "fulfilled" && q.value && q.value.counts) QG = q.value;
    if (uu.status === "fulfilled" && uu.value && uu.value.version) UL = uu.value;
    if (a.status === "fulfilled" && Array.isArray(a.value.coins)) T5 = a.value;
    if (c.status === "fulfilled" && c.value.trades) LED = c.value;
    if (g.status === "fulfilled" && g.value && (g.value.picks || g.value.mood)) AG = g.value;
    lastData = Date.now();
    await livePrices();
  }
  async function livePrices() {
    // live Binance price for open paper trades + BTC (one small request)
    const pairs = new Set(["BTCUSDT"]);
    (LED?.trades || []).forEach((t) => { if (!t.void && t.binance_pair) pairs.add(t.binance_pair); });
    try { const q = await getJSON("https://data-api.binance.vision/api/v3/ticker/price?symbols=" + encodeURIComponent(JSON.stringify([...pairs])), 12000);
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
  function renderUL() { const el = $("#usBody"); if (!el || !window.Ultra) return; Ultra.render(el, UL); if (UL) $("#usVer").textContent = UL.version; }
  function renderQG() { const el = $("#qgBody"); if (!el || !window.QGate) return; QGate.render(el, QG, "compact"); if (QG) $("#qgVer").textContent = QG.version; }

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
    $("#statusTxt").textContent = !T5 ? "Data load fail" : fresh ? "Bot Running" : "Data stale";
    st.title = `Top 500 data: ${t5At ? pkt(t5At) : "—"} · Paper ledger: ${ledAt ? pkt(ledAt) : "—"}`;
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
  let sigK = "all";
  function renderSignals() {
    const sg = allSignals().filter((s) => sigK === "all" || (sigK === "long" ? s.dir === "LONG" : sigK === "short" ? s.dir === "SHORT" : s.book === sigK));
    const n = listN(), shown = sg.slice(0, n);
    $("#sigCount").textContent = sg.length ? shown.length + " / " + sg.length + " signals" : "0 signals";
    $("#sigList").innerHTML = shown.length ? shown.map(rowSig).join("") : '<div class="empty">Is filter mein koi signal nahi</div>';
  }
  function renderScanner() {
    const cs = T5?.coins || [], cnt = (f) => cs.filter(f).length, code = (k) => (c) => (c.signal || {}).code === k;
    const n = listN();
    const strong = { pump: 0, breakout: 0, dump: 0, breakdown: 0, early: 1, overheated: 1, overbought: 2, oversold: 2, hype: 3 };
    const rows = cs.filter((c) => !c.kind).slice()
      .sort((a, b) => (strong[(a.signal || {}).code] ?? 9) - (strong[(b.signal || {}).code] ?? 9) || Math.abs(N(b.change_24h) || 0) - Math.abs(N(a.change_24h) || 0))
      .slice(0, n);
    const list = rows.map((c) => {
      const s = c.signal || {}, ta = c.ta || {}, dir = T5DIR[s.code];
      const badge = dir ? `<span class="badge ${dir === "LONG" ? "b-long" : dir === "SHORT" ? "b-short" : "b-info"}">${esc(s.label || dir)}</span>` : (ta.trend ? `<span class="badge ${ta.trend === "Uptrend" ? "b-long" : ta.trend === "Downtrend" ? "b-short" : "b-info"}">${esc(ta.trend)}</span>` : "");
      return `<div class="row" data-open="top500:${esc(c.id)}"><div class="a">#${c.rank ?? "—"} ${esc(c.symbol)}<small>${esc(c.name || "")}</small>${badge}</div>
        <div class="b">$${fmtP(c.price)} <span class="${cls(c.change_24h)}">${pct(c.change_24h, 1)}</span></div>
        <div class="c">${esc(s.label || ta.trend || "—")} · RSI ${N(ta.rsi) != null ? ta.rsi.toFixed(0) : "—"} · 24h ${pct(c.change_24h, 1)}</div></div>`;
    }).join("");
    $("#scanT5").innerHTML = T5 ? `<div class="kv"><div><b>${cnt((c) => ["pump", "breakout"].includes((c.signal || {}).code))}</b>Pump / Breakout</div><div><b>${cnt((c) => ["dump", "breakdown"].includes((c.signal || {}).code))}</b>Dump / Breakdown</div><div><b>${cnt(code("hype"))}</b>X Hype</div>
      <div><b>${cnt(code("oversold"))}</b>Oversold</div><div><b>${cnt(code("overbought"))}</b>Overbought</div><div><b>${cnt((c) => (c.ta || {}).trend === "Uptrend")}</b>Uptrend</div></div>
      <div class="muted">Data: ${pkt(ts(T5.generated_at))} · ${T5.coverage?.zones ?? "—"} coins ke zones ready · list ${rows.length}/${n}</div>
      <div class="rows">${list || '<div class="empty">Is list mein koi coin nahi</div>'}</div>` : '<div class="empty">Data load nahi hua</div>';
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
  function renderAll() { if (!T5 && !LED && !AG) return; renderHeader(); renderStats(); renderLive(); renderUL(); renderJudge(); renderQG(); renderPerf(); renderPnl(); renderSignals(); renderScanner(); renderAnalysis(); renderStatus(); }
  document.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]"); if (!o) return;
    const [book, id] = o.dataset.open.split(/:(.*)/s);
    location.href = "top500.html?v=" + VER + "#coin=" + encodeURIComponent(id);
  });
  $("#sigSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; sigK = b.dataset.k; $$("#sigSeg button").forEach((x) => x.classList.toggle("on", x === b)); renderSignals(); });
  $("#aq").addEventListener("input", renderAnalysis);
  $("#paperChip").addEventListener("click", () => (location.href = "paper.html?v=" + VER));

  // ---------- views ----------
  function go(v, push = true) {
    if (!$("#v-" + v)) v = "dashboard";
    $$(".view").forEach((x) => x.classList.toggle("on", x.id === "v-" + v));
    $$("#pills button[data-v], #bbar button[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    if (push && history.replaceState) history.replaceState(null, "", v === "dashboard" ? location.pathname + location.search : "#" + v);
    scrollTo(0, 0); if (v === "dashboard") { drawChart(); renderPnl(); }
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("#pills button, #bbar button"); if (!b) return; haptic(); if (b.dataset.href) location.href = b.dataset.href + "?v=" + VER; else go(b.dataset.v); });

  // ---------- candlestick chart ----------
  let pair = (() => { try { return JSON.parse(localStorage.getItem("hr_pair")) || null; } catch (e) { return null; } })() || { sym: "BTC", pair: "BTCUSDT", src: "binance", rank: 1 };
  let tf = localStorage.getItem("hr_tf") || "5m", candles = [], chartAt = 0, chartSrc = "", chartBusy = false, chartErr = "";
  const TFB = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "1h": "60", "4h": "240" }, TFO = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H" };
  const base = (p) => p.pair.replace(/[-_]?USDT$/i, "").replace(/[-_]/g, "");
  async function fetchK(src, p) {
    const b = base(p), L = 120;
    if (src === "binance") { const r = await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=${b}USDT&interval=${tf}&limit=${L}`, 10000); return r.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })); }
    if (src === "bybit") { const r = await getJSON(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${b}USDT&interval=${TFB[tf]}&limit=${L}`, 10000); if (r.retCode) throw new Error(r.retMsg);
      return r.result.list.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse(); }
    if (src === "okx") { const r = await getJSON(`https://www.okx.com/api/v5/market/candles?instId=${b}-USDT&bar=${TFO[tf]}&limit=${L}`, 10000); if (r.code !== "0") throw new Error(r.msg);
      return r.data.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse(); }
    throw new Error("src");
  }
  async function loadChart() {
    if (chartBusy) return; chartBusy = true;
    // verified exchange first; other exchanges only for top-50 tickers (avoid same-ticker different coin)
    const order = [pair.src, ...((pair.rank || 999) <= 50 ? ["binance", "bybit", "okx"] : [])].filter((s, i, a) => ["binance", "bybit", "okx"].includes(s) && a.indexOf(s) === i);
    let ok = false;
    for (const s of order) { try { const k = await fetchK(s, pair); if (k.length > 5) { candles = k; chartSrc = { binance: "Binance", bybit: "Bybit", okx: "OKX" }[s]; chartAt = Date.now(); chartErr = ""; ok = true; break; } } catch (e) {} }
    if (!ok) chartErr = order.length ? "Is waqt candles nahi mil sakin (exchange API fail/limit). Thori der baad khud try hoga." : "Is coin ki candles Binance/Bybit/OKX par nahi — chart available nahi.";
    chartBusy = false; drawChart();
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
  $("#tfs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; tf = b.dataset.tf; localStorage.setItem("hr_tf", tf); candles = []; haptic(); drawChart(); loadChart(); });
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
    pair = { sym: c.symbol, pair: c.ta.pair, src: c.ta.src, rank: c.rank }; localStorage.setItem("hr_pair", JSON.stringify(pair)); candles = []; closeSheet(); drawChart(); loadChart(); });

  // ---------- refresh loop ----------
  let busy = null, seen = (() => { try { return new Set(JSON.parse(localStorage.getItem("hr_seen") || "[]")); } catch (e) { return new Set(); } })(), firstSeen = !seen.size;
  function checkNew() {
    const ids = trades().map((t) => t.id), fresh = ids.filter((i) => !seen.has(i));
    if (fresh.length && !firstSeen && P("vib")) { const t = trades().find((x) => x.id === fresh[fresh.length - 1]); toast("Naya paper signal: " + t.symbol + " " + t.side); try { tg && tg.HapticFeedback ? tg.HapticFeedback.notificationOccurred("success") : navigator.vibrate && navigator.vibrate(120); } catch (e) {} }
    ids.forEach((i) => seen.add(i)); firstSeen = false; try { localStorage.setItem("hr_seen", JSON.stringify([...seen].slice(-300))); } catch (e) {}
  }
  function refresh(manual) {
    if (busy) return busy;
    busy = (async () => { await Promise.all([loadData(), loadChart()]); checkNew(); renderAll(); if (manual) toast("Refreshed · " + pktS(Date.now())); })().finally(() => (busy = null));
    return busy;
  }
  renderToggles();
  if (window.ListN) ListN.fill();
  addEventListener("listn-change", () => { renderAll(); });
  go((location.hash || "").replace("#", "") || "dashboard", false);
  drawChart(); refresh();
  setInterval(() => { if (!document.hidden && P("auto")) loadChart(); }, 10000);
  setInterval(() => { if (!document.hidden && P("auto")) refresh(); }, 60000);
  setInterval(() => { if (!document.hidden && P("auto")) livePrices().then(() => { renderHeader(); renderStats(); renderLive(); }); }, 20000);
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
