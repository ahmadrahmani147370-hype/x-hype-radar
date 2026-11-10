/* X Hype Radar — dashboard + Telegram Mini App */
(() => {
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
  const inTG = !!(tg && tg.platform && tg.platform !== "unknown");
  const $ = (s) => document.querySelector(s);
  const TZ = "Asia/Karachi";
  let snap = null, kind = "all", sortBy = "default", openSymbol = null;
  const REFRESH_MS = 60_000;
  let refreshPromise = null, nextRefresh = Date.now() + REFRESH_MS;
  let cgPauseUntil = 0, cgBackoff = 120000;
  let pricesAsOf = null, snapshotFailed = false, firstLoad = true;
  const marketCache = new Map();
  const cgId = (t) => { const m = t.market || {}; return m.coingecko_id || t.coingecko_id || (/coingecko id ([a-z0-9-]+)/i.exec(m.match || "") || [])[1]; };
  const marketKey = (t) => [t.symbol, t.market?.chain || t.chain || "", t.market?.token_address || t.contract_address || "", cgId(t) || ""].join(":");
  const clock = (iso, seconds = false) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });
  const priceClass = (m) => m._direction > 0 ? "price-up" : m._direction < 0 ? "price-down" : "";
  const marketState = (m) => `<span class="market-state ${m._stale ? "is-stale" : ""}" title="${m._asOf ? new Date(m._asOf).toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi" }) + " PKT" : ""}">${m._stale ? "Last known · stale" + (m._asOf ? " · " + new Date(m._asOf).toLocaleTimeString("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit" }) : "") : "Live" + (m._via && /Binance/.test(m._via) ? " · Binance fallback" : "") + " · " + (m.source || "market")}</span>`;

  // ---------- Telegram integration ----------
  if (inTG) {
    tg.ready(); tg.expand();
    try { tg.setHeaderColor("#f2f6fc"); tg.setBackgroundColor("#f2f6fc"); tg.setBottomBarColor && tg.setBottomBarColor("#ffffff"); } catch (e) {}
    const setVh = () => document.documentElement.style.setProperty("--tg-viewport-stable-height", (tg.viewportStableHeight || window.innerHeight) + "px");
    setVh(); tg.onEvent("viewportChanged", setVh);
    tg.BackButton.onClick(closeSheet);
    document.documentElement.classList.add("tg", "tg-" + (tg.colorScheme || "dark"));
  }
  const haptic = (t = "light") => { try { inTG && tg.HapticFeedback.impactOccurred(t); } catch (e) {} };
  const openLink = (url) => {
    if (inTG) { /^https:\/\/t\.me\//.test(url) ? tg.openTelegramLink(url) : tg.openLink(url); }
    else window.open(url, "_blank", "noopener");
  };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https:\/\//.test(u || "") ? u : "#");
  const NA = '<span class="muted">n/a</span>';
  const num = (n, d = 1) => {
    if (n == null || isNaN(n)) return null;
    const a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(d) + "T";
    if (a >= 1e9) return (n / 1e9).toFixed(d) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(d) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(d) + "K";
    return (+n).toFixed(a < 10 && a % 1 ? 1 : 0);
  };
  const usd = (n) => (n == null ? NA : "$" + num(n));
  const price = (p) => {
    if (p == null) return NA;
    if (p >= 1000) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (p >= 1) return "$" + p.toFixed(2);
    if (p >= 0.01) return "$" + p.toFixed(4);
    const s = p.toExponential(2).split("e-"); const z = +s[1] - 1;
    return `$0.0<sub>${z}</sub>${p.toFixed(z + 4).slice(2 + z)}`;
  };
  const pct = (v) => (v == null ? NA : `<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${(+v).toFixed(Math.abs(v) >= 100 ? 0 : 1)}%</span>`);
  const mult = (r) => (r >= 100 ? "100+" : r >= 10 ? r.toFixed(0) : r.toFixed(1));
  const pkt = (iso, opts) => new Date(iso).toLocaleString("en-GB", Object.assign({ timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true }, opts || {}));
  const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago"; };
  const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 1600); };

  function sparkSVG(vals, w = 200, h = 44, id = "s") {
    const v = vals.length ? vals : [0]; const max = Math.max(1, ...v); const n = v.length - 1 || 1;
    const pts = v.map((x, i) => [(i / n) * w, h - 3 - (x / max) * (h - 8)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark-svg" width="100%" height="100%">
      <defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b7ddd" stop-opacity=".18"/><stop offset="1" stop-color="#3b7ddd" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#g${id})"/>
      <path d="${d}" fill="none" stroke="#3b7ddd" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="#fff" stroke="#3b7ddd" stroke-width="2"/></svg>`;
  }
  function ring(score) {
    const r = 20, c = 2 * Math.PI * r, off = c * (1 - score / 100);
    return `<div class="ring" title="Hype score"><svg width="48" height="48"><circle cx="24" cy="24" r="${r}" stroke="#e7f0fd" stroke-width="4" fill="none"/>
      <circle cx="24" cy="24" r="${r}" stroke="url(#ringG)" stroke-width="4" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg><b>${score}</b></div>`;
  }
  const avatar = (t) => { const img = t.market && t.market.image; return img ? `<div class="avatar" style="background-image:url('${esc(safeUrl(img))}')"></div>` : `<div class="avatar">${esc(t.symbol.slice(0, 2))}</div>`; };
  const tokenName = (t) => esc(t.note ? "pump.fun launchpad (PUMP)" : (t.market && t.market.name) || (t.kind === "major" ? "Major" : "Unpriced token"));
  const xSearch = (t) => "https://x.com/search?q=" + encodeURIComponent("$" + t.symbol) + "&f=live";

  // ---------- Pump/Dump signal, risk score, hype momentum (mirror of scripts/signals.py) ----------
  const N = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const fp = (v) => (v >= 0 ? "+" : "") + (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)) + "%";
  function marketFromPairs(pairs, address, preferUrl) {
    const same = (a, b) => a && b && (a.startsWith("0x") && b.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);
    const ps = (pairs || []).filter((p) => same(p.baseToken?.address, address) && N(p.priceUsd) > 0);
    if (!ps.length) return null;
    const real = (x) => (x.volume?.h24 || 0) >= 0.01 * (x.liquidity?.usd || 0);
    ps.sort((a, b) => real(b) - real(a) || (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const p = ps.find((x) => preferUrl && (x.url || "").toLowerCase() === preferUrl.toLowerCase()) || ps[0];
    const pc = p.priceChange || {}, tx = p.txns || {}, vol = p.volume || {};
    const chg = (w) => { if (pc[w] != null) return pc[w]; const t = tx[w]; return t && typeof t === "object" && (t.buys || 0) + (t.sells || 0) === 0 ? 0 : null; };
    const liq = p.liquidity?.usd, tot = ps.reduce((a, x) => a + (x.liquidity?.usd || 0), 0);
    return { num: { price_usd: p.priceUsd, change_5m: chg("m5"), change_1h: chg("h1"), change_6h: chg("h6"), change_24h: chg("h24"),
        volume_5m: vol.m5, volume_1h: vol.h1, volume_6h: vol.h6, volume_24h: vol.h24, liquidity_usd: liq, market_cap: p.marketCap || p.fdv, fdv: p.fdv,
        pairs_count: ps.length, top_pair_liq_share: liq && tot ? +(liq / tot).toFixed(3) : null },
      obj: { txns_5m: tx.m5, txns_1h: tx.h1, txns_6h: tx.h6, txns_24h: tx.h24 } };
  }
  function buyRatio(m) {
    for (const [k, l] of [["txns_1h", "1h"], ["txns_6h", "6h"], ["txns_24h", "24h"]]) {
      const t = m[k] || {}, b = N(t.buys) || 0, s = N(t.sells) || 0;
      if (b + s >= 20) return [b / (b + s), l, b, s];
    }
    return [null, null];
  }
  function momentumFor(t) {
    const h = t.hourly || [], prior = h.slice(-4, -2);
    const priorRate = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
    const now = N(t.recent_rate_per_h) || 0, accel = priorRate != null ? +(now / Math.max(priorRate, 0.5)).toFixed(2) : null;
    const prev = N(t.prev_spike_ratio), spike = N(t.spike_ratio) || 0, dropped = prev != null && spike < prev * 0.6;
    let state = "steady";
    if (accel == null) state = "n/a";
    else if (accel >= 1.5 && (prev == null || spike >= prev * 0.8)) state = "accelerating";
    else if (accel < 0.7 || (dropped && accel < 1.5)) state = "fading";
    return { accel, prior_rate_per_h: priorRate != null ? +priorRate.toFixed(1) : null, state };
  }
  function signalFor(t) {
    const m = t.market || {}, mo = t.momentum || momentumFor(t);
    const spike = N(t.spike_ratio) || 0, rate = N(t.recent_rate_per_h) || 0;
    const [p5, p1, p6, p24] = ["change_5m", "change_1h", "change_6h", "change_24h"].map((k) => N(m[k]));
    const [br, brw] = buyRatio(m);
    const hypeUp = spike >= 1.5 && rate >= 5 && mo.state !== "fading", fading = mo.state === "fading" || spike < 1.2;
    const bs = br != null ? `buys ${(br * 100).toFixed(0)}% (${brw})` : "buy/sell n/a";
    const hype = `X ${spike.toFixed(1)}x` + (mo.state !== "n/a" ? `, ${mo.state}` : "");
    const R = (code, label, ...parts) => ({ code, label, reason: parts.filter(Boolean).join(" · ") });
    if (p1 == null && p6 == null && p24 == null) return spike >= 2 && rate >= 5 ? R("early", "Hype bina price", hype, "market data n/a") : R("neutral", "Neutral", hype, "market data n/a");
    if (p1 == null) {
      const [lw, lv] = p24 != null ? ["24h", p24] : ["6h", p6], ch = `${lw} ${fp(lv)}`;
      if (lv <= -8) return R("dump", "DUMP chal raha", ch, hype);
      if (lv >= 15 && fading) return R("overheated", "Overheated / Dump risk", ch, hype);
      if (lv >= 6 && hypeUp) return R("pump", "PUMP shuru", ch, hype);
      if (spike >= 2 && rate >= 5 && Math.abs(lv) < 3) return R("early", "Hype bina price", hype, ch);
      return R("neutral", "Neutral", hype, ch);
    }
    const sellsWin = br != null && br < 0.5;
    const moves = [["5m", p5], ["1h", p1], ["6h", p6]].filter(([, v]) => v != null && Math.abs(v) >= 1).map(([w, v]) => `${w} ${fp(v)}`).join(", ");
    if (p1 <= -30 || (p6 != null && p6 <= -50) || ((p1 <= -15 || (p5 != null && p5 <= -8)) && (br == null || sellsWin))) return R("dump", "DUMP chal raha", moves, bs, hype);
    const hot = p1 >= 30 || (p6 != null && p6 >= 80) || (p24 != null && p24 >= 150);
    if (hot && (fading || (br != null && br < 0.48) || (p5 != null && p5 <= -5))) {
      const big = p1 >= 30 ? `1h ${fp(p1)}` : p6 != null && p6 >= 80 ? `6h ${fp(p6)}` : `24h ${fp(p24)}`;
      return R("overheated", "Overheated / Dump risk", big, bs, hype);
    }
    if (hypeUp && (p1 >= 5 || (p5 != null && p5 >= 3)) && (br == null || br >= 0.52)) return R("pump", "PUMP shuru", moves, bs, hype);
    if (spike >= 2 && rate >= 5 && Math.abs(p1) < 5 && (p6 == null || p6 < 20)) return R("early", "Hype bina price", hype, `price 1h ${fp(p1)} (abhi move nahi hua)`);
    if (hot) return R("overheated", "Overheated / Dump risk", `1h ${fp(p1)}` + (p6 != null ? `, 6h ${fp(p6)}` : ""), bs, hype);
    return R("neutral", "Neutral", hype, `1h ${fp(p1)}`, bs);
  }
  function riskFor(t) {
    const m = t.market || {}, why = []; let pts = 0;
    const add = (n, txt) => { pts += n; why.push(`+${n} ${txt}`); };
    if (t.kind === "major" && m.source === "CoinGecko") {
      const cap = N(m.market_cap); if (cap != null && cap < 1e9) add(10, "market cap < $1B");
      return { score: pts, level: pts < 30 ? "Low" : "Medium", reasons: why.length ? why : ["Large-cap major (CoinGecko)"] };
    }
    const liq = N(m.liquidity_usd);
    if (liq == null) add(20, "no DEX liquidity data"); else if (liq < 1e4) add(30, "liquidity < $10K"); else if (liq < 5e4) add(20, "liquidity < $50K"); else if (liq < 2e5) add(10, "liquidity < $200K");
    const age = N(m.pair_created_at);
    if (age) { const h = (Date.now() - age) / 3.6e6; if (h < 6) add(20, "pair < 6h old"); else if (h < 24) add(15, "pair < 24h old"); else if (h < 72) add(8, "pair < 3 days old"); }
    const fdv = N(m.fdv) || N(m.market_cap);
    if (fdv && liq) { const r = fdv / liq; if (r > 100) add(15, `FDV/liquidity ${r.toFixed(0)}x`); else if (r > 30) add(8, `FDV/liquidity ${r.toFixed(0)}x`); }
    const [br, brw] = buyRatio(m);
    if (br != null) { if (br < 0.4) add(15, `sells ${(100 - br * 100).toFixed(0)}% (${brw})`); else if (br < 0.47) add(8, `sells ${(100 - br * 100).toFixed(0)}% (${brw})`); }
    const v24 = N(m.volume_24h);
    if (liq && liq > 1e6 && v24 != null && liq > 100 * Math.max(v24, 1)) add(15, "huge liquidity but tiny volume (pool may be fake/unverified)");
    const v1 = N(m.volume_1h);
    if (v1 && liq && v1 / liq > 20) add(8, `1h volume ${(v1 / liq).toFixed(0)}x liquidity (churn)`);
    const share = N(m.top_pair_liq_share);
    if (share != null && (m.pairs_count || 0) > 1 && share > 0.95) add(4, "liquidity concentrated in 1 pair");
    const flags = (t.risk_flags || []).join(" ");
    if (flags.includes("shill")) add(10, "few accounts posting most mentions");
    if (flags.includes("Airdrop")) add(15, "scam-link patterns in posts");
    if ((m.match || "").startsWith("symbol")) add(10, "matched by symbol only");
    pts = Math.min(100, pts);
    return { score: pts, level: pts < 30 ? "Low" : pts < 60 ? "Medium" : "High", reasons: why.length ? why : ["No automatic risk points"] };
  }
  const enrich = (t) => { t.momentum = momentumFor(t); t.signal = signalFor(t); t.risk = riskFor(t);
    const m = t.market || {};
    if (m.rejected) t.signal.reason += " · market match reject (symbol-only, kam liquidity)";
    else if ((m.match || "").startsWith("symbol search (") && t.signal.code !== "neutral") t.signal.reason += " · ⚠ sirf symbol match — CA verify karein";
    return t; };
  const SIG = { pump: ["🚀", "sig-pump"], overheated: ["🔥", "sig-hot"], dump: ["🩸", "sig-dump"], early: ["👀", "sig-early"], neutral: ["•", "sig-neutral"] };
  const sigBadge = (t) => { const s = t.signal || { code: "neutral", label: "Neutral" }; const [ic, cl] = SIG[s.code] || SIG.neutral; return `<span class="sig ${cl}">${ic} ${esc(s.label)}</span>`; };
  const riskChip = (t) => { const r = t.risk; if (!r) return ""; return `<span class="risk-chip risk-${r.level.toLowerCase()}" title="${esc(r.reasons.join(" · "))}">Risk ${r.score}<em>${r.level}</em></span>`; };
  const momo = (t) => { const s = t.momentum?.state; return s === "accelerating" ? '<span class="momo up" title="Mentions accelerating vs 2h before">▲ tez</span>' : s === "fading" ? '<span class="momo down" title="Mentions slowing">▼ thanda</span>' : ""; };
  const PUMP_RANK = { pump: 0, early: 1, neutral: 2, overheated: 3, dump: 4 }, DUMP_RANK = { dump: 0, overheated: 1, neutral: 2, early: 3, pump: 4 };

  // ---------- render ----------
  function render() {
    const s = snap.stats, toks = snap.tokens;
    const gen = snap.x_data_as_of || snap.generated_at;
    updatePill();
    const spiking = toks.filter((t) => t.is_spiking);
    $("#heroLine").innerHTML = `${s.posts_analyzed} real X posts scanned · ${s.tokens_tracked} tokens checked for hourly mention velocity. <b class="hl">${spiking.length}</b> token${spiking.length === 1 ? "" : "s"} abhi normal se zyada discuss ho rahe hain.`;

    const top = spiking[0] || toks[0];
    if (top) {
      const m = top.market || {};
      $("#spotlight").innerHTML = `<div class="sp-tags"><span class="sp-tag">Top spike right now</span>${sigBadge(top)}</div>
        <div class="sp-row"><div><div class="sp-sym">$${esc(top.symbol)}</div><div class="sp-name">${tokenName(top)}${m.chain ? " · " + esc(m.chain) : ""}</div></div>
        <div class="sp-mult">${mult(top.spike_ratio)}<small>×</small></div></div>
        <div class="sp-chart">${sparkSVG(top.hourly, 300, 64, "hero")}</div>
        <div class="sp-price ${priceClass(m)}">${price(m.price_usd)} ${marketState(m)}</div>
        <div class="sp-meta"><div><b>${num(top.recent_rate_per_h)}/h</b><span>mentions now</span></div>
        <div><b>${num(top.baseline_per_h, 1)}/h</b><span>24h baseline</span></div>
        <div><b>${m.change_1h != null ? pct(m.change_1h) : m.change_24h != null ? pct(m.change_24h) : "n/a"}</b><span>price ${m.change_1h != null ? "1h" : "24h"}</span></div></div>`;
      $("#spotlight").insertAdjacentHTML("beforeend", `<div class="sp-market"><span>24h ${pct(m.change_24h)}</span><span>Liq ${usd(m.liquidity_usd)}</span><span>Cap ${usd(m.market_cap)}</span><span>Vol 24h ${usd(m.volume_24h)}</span></div>`);
      $("#spotlight").onclick = () => openSheet(top);
    }

    const maxSpike = toks.reduce((a, t) => Math.max(a, t.spike_ratio), 0);
    $("#stats").innerHTML = [
      [s.posts_analyzed, "X posts"], [s.tokens_tracked, "Tokens checked"],
      [mult(maxSpike) + "×", "Top spike"], [num(s.mentions_24h_tracked), "Mentions 24h"],
    ].map(([b, l]) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`).join("");

    const cnt = (c) => toks.filter((t) => c.includes(t.signal?.code)).length;
    $("#sigBoard").innerHTML = [["pump", "🚀", "PUMP shuru", ["pump"], "Hype + price + buys upar"], ["early", "👀", "Hype bina price", ["early"], "Mentions upar, price abhi flat"],
      ["dump", "🩸", "Dump / Overheated", ["dump", "overheated"], "Price gir raha ya bahut garam"], ["all", "📡", "Sab tokens", null, "Pura radar"]]
      .map(([k, ic, l, codes, sub]) => `<button class="sb sb-${k} ${kind === k ? "on" : ""}" data-kind="${k}"><span class="sb-ic">${ic}</span><b>${codes ? cnt(codes) : toks.length}</b><span class="sb-l">${l}</span><span class="sb-s">${sub}</span></button>`).join("");
    renderList();
    $("#also").innerHTML = (snap.also_seen || []).map((a) =>
      `<a class="chip" href="https://x.com/search?q=${encodeURIComponent("$" + a.symbol)}&f=live" data-link>$${esc(a.symbol)}<em>${a.posts}p · ${a.authors}a</em></a>`).join("") || '<span class="muted">—</span>';
    $("#method").innerHTML = `<div class="panel-h"><h3>How the radar works</h3><span class="muted small">Source: ${esc(snap.source)}</span></div>
      <p><b class="hl">Spike ratio</b> — ${esc(snap.method.spike_ratio)}.</p>
      <p><b class="hl">Hype score</b> — ${esc(snap.method.hype_score)}.</p>
      <p><b class="hl">Pump/Dump signal</b> — ${esc(snap.method.signal || "")}. Live prices se har minute dobara calculate hota hai.</p>
      <p><b class="hl">Risk score</b> — ${esc(snap.method.risk || "")}. Yeh sirf automatic andaza hai — DYOR.</p>
      <p><b class="hl">Momentum</b> — ▲ tez = mentions/h abhi pichle 2 ghante se 1.5× zyada; ▼ thanda = 0.7× se kam ya spike pichle scan se kafi gira.</p>
      <p><b class="hl">Spiking</b> = spike ≥ 1.5× and ≥ 5 mentions/hour. Counts come from X's full post-count endpoint; top posts, authors and engagement come from the scanned sample. Prices refresh every 60 seconds while visible via DexScreener / CoinGecko. X mentions update hourly, independently. Missing values stay n/a; failed market refreshes keep last known values and show stale. Symbol-search matches are unverified: check the contract before trading.</p>`;
  }

  function updatePill() {
    if (!snap) return;
    const gen = snap.x_data_as_of || snap.generated_at;
    const stale = snap.tokens.some((t) => t.market?._stale);
    $("#priceAge").textContent = pricesAsOf ? `Prices live · ${clock(pricesAsOf, true)} PKT` : "Prices · awaiting live feed";
    $("#snapAge").textContent = `X data: ${clock(gen)} PKT`;
    $("#feedStatus").textContent = snapshotFailed ? "X refresh delayed" : stale ? "Some markets stale" : "";
    $("#livePill").classList.toggle("stale", stale || snapshotFailed);
    $("#snapAge").classList.toggle("is-stale", snapshotFailed || Date.now() - new Date(gen) > 3 * 3600e3);
  }
  function updateCountdown() {
    const left = Math.max(0, Math.ceil((nextRefresh - Date.now()) / 1000));
    $("#countdown").style.setProperty("--remaining", left / 60);
    $("#countdownNumber").textContent = refreshPromise ? "↻" : left;
    $("#countdown").title = document.hidden ? "Refresh resumes when visible" : `Next refresh in ${left}s`;
  }
  function sorted() {
    let t = snap.tokens.slice();
    const sc = (x) => x.signal?.code || "neutral";
    if (kind === "spiking") t = t.filter((x) => x.is_spiking);
    else if (kind === "pump") t = t.filter((x) => sc(x) === "pump");
    else if (kind === "dump") t = t.filter((x) => sc(x) === "dump" || sc(x) === "overheated");
    else if (kind === "early") t = t.filter((x) => sc(x) === "early");
    else if (kind !== "all") t = t.filter((x) => x.kind === kind);
    const k = { spike: "spike_ratio", score: "hype_score", rate: "recent_rate_per_h", m24: "mentions_24h" }[sortBy];
    if (k) t.sort((a, b) => b[k] - a[k]);
    else if (sortBy === "pump") t.sort((a, b) => PUMP_RANK[sc(a)] - PUMP_RANK[sc(b)] || b.spike_ratio - a.spike_ratio);
    else if (sortBy === "dump") t.sort((a, b) => DUMP_RANK[sc(a)] - DUMP_RANK[sc(b)] || (N(a.market?.change_1h) ?? 0) - (N(b.market?.change_1h) ?? 0));
    else if (sortBy === "risk") t.sort((a, b) => (a.risk?.score ?? 101) - (b.risk?.score ?? 101));
    else if (sortBy === "accel") t.sort((a, b) => (b.momentum?.accel ?? -1) - (a.momentum?.accel ?? -1));
    return t;
  }

  function card(t, i) {
    const m = t.market || {};
    const up = t.spike_ratio >= 1.5;
    const flags = (t.risk_flags || []).slice(0, 3).map((f) => `<span class="flag">⚠ ${esc(f)}</span>`).join("");
    return `<article class="card ${t.is_spiking ? "hot" : ""}" data-sym="${esc(t.symbol)}" style="animation-delay:${Math.min(i, 12) * 45}ms">
      <div class="c-top"><div class="rank">${String(i + 1).padStart(2, "0")}</div>${avatar(t)}
        <div class="c-id"><div class="c-sym">$${esc(t.symbol)} ${t.is_spiking ? '<span class="badge fire">Spiking</span>' : `<span class="badge">${t.kind}</span>`}</div>
        <div class="c-name">${tokenName(t)}${m.chain ? " · " + esc(m.chain) : ""}</div></div>${ring(t.hype_score)}</div>
      <div class="sig-row">${sigBadge(t)}${riskChip(t)}</div>
      <div class="sig-why">${esc(t.signal?.reason || "")}</div>
      <div class="c-mid"><div><div class="mult ${up ? "up" : "flat"}">${mult(t.spike_ratio)}× ${momo(t)}</div><div class="mult-l">vs 24h baseline${t.prev_spike_ratio != null ? ` · last scan ${mult(t.prev_spike_ratio)}×` : ""}</div></div>
        <div class="spark">${sparkSVG(t.hourly, 200, 44, t.symbol)}</div></div>
      <div class="c-grid">
        <div><span>Now</span><b>${num(t.recent_rate_per_h)}/h</b></div>
        <div><span>24h</span><b>${num(t.mentions_24h)}</b></div>
        <div><span>Price</span><b class="${priceClass(m)}">${price(m.price_usd)}</b></div>
        <div><span>${m.change_1h != null ? "1h / 24h" : "24h"}</span><b>${m.change_1h != null ? pct(m.change_1h) + " / " : ""}${pct(m.change_24h)}</b></div>
        <div><span>Liquidity</span><b>${usd(m.liquidity_usd)}</b></div>
        <div><span>Market cap</span><b>${usd(m.market_cap)}</b></div>
        <div><span>Vol 24h</span><b>${usd(m.volume_24h)}</b></div>
      </div>
      <div class="c-foot">${marketState(m)}<div class="quick">${(m.token_address || t.contract_address) ? `<button class="qbtn" data-copy="${esc(m.token_address || t.contract_address)}" title="Copy contract">⧉ CA</button>` : ""}${m.pair_url ? `<a class="qbtn" href="${esc(safeUrl(m.pair_url))}" data-link>Chart</a>` : ""}<a class="qbtn" href="${xSearch(t)}" data-link>X</a></div></div>
      ${flags ? `<div class="flags">${flags}</div>` : ""}
    </article>`;
  }

  function renderList() {
    const t = sorted();
    $("#list").innerHTML = t.length ? t.map(card).join("") : '<div class="empty">Is filter mein abhi koi token nahi.</div>';
    document.querySelectorAll(".card").forEach((el) => (el.onclick = (e) => { if (e.target.closest(".qbtn")) return; openSheet(snap.tokens.find((x) => x.symbol === el.dataset.sym)); }));
  }

  function signalPanel(t) {
    const m = t.market || {}, r = t.risk || { score: 0, level: "Low", reasons: [] }, mo = t.momentum || {};
    const [br, brw, b, sl] = buyRatio(m);
    const bar = br != null ? `<div class="bsbar"><div class="bs-b" style="width:${(br * 100).toFixed(1)}%"></div></div>
      <div class="bs-l"><span class="pos">Buys ${num(b, 1)} · ${(br * 100).toFixed(0)}%</span><span class="muted">${brw} txns</span><span class="neg">${(100 - br * 100).toFixed(0)}% · ${num(sl, 1)} Sells</span></div>` : '<p class="muted small">Buy/sell txns: n/a</p>';
    const ch = [["5m", m.change_5m], ["1h", m.change_1h], ["6h", m.change_6h], ["24h", m.change_24h]].filter(([, v]) => v != null);
    const mom = mo.accel != null ? `${num(t.recent_rate_per_h)}/h abhi vs ${num(mo.prior_rate_per_h, 1)}/h 2 ghante pehle (${mo.accel >= 10 ? mo.accel.toFixed(0) : mo.accel.toFixed(1)}×)` : "n/a";
    return `<div class="sigpanel ${(SIG[t.signal?.code] || SIG.neutral)[1]}">
      <div class="sp-h"><span class="muted small">PUMP / DUMP SIGNAL</span>${sigBadge(t)}</div>
      <div class="sig-why big">${esc(t.signal?.reason || "")}</div>
      ${ch.length ? `<div class="chg">${ch.map(([w, v]) => `<div><span>${w}</span><b>${pct(v)}</b></div>`).join("")}</div>` : ""}
      ${bar}
      <div class="mom"><span>Hype momentum ${momo(t)}</span><b>${mom}</b>${t.prev_spike_ratio != null ? `<b>Spike: pichla scan ${mult(t.prev_spike_ratio)}× → ab ${mult(t.spike_ratio)}×</b>` : ""}</div>
    </div>
    <div class="riskpanel risk-${r.level.toLowerCase()}">
      <div class="sp-h"><span class="muted small">RUG / RISK SCORE</span><b class="rk">${r.score}<small>/100 · ${r.level}</small></b></div>
      <div class="rmeter"><i style="left:${r.score}%"></i></div>
      <ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="muted small">Automatic andaza hai, guarantee nahi. Zyada score = zyada khatra. DYOR — kharidne se pehle contract, holders aur liquidity lock khud check karein.</p>
    </div>`;
  }
  function openSheet(t, updating = false) {
    if (!t) return;
    openSymbol = t.symbol;
    const scroll = $("#sheet").scrollTop;
    if (!updating) haptic("medium");
    const m = t.market || {};
    const hrs = t.hourly.length;
    const start = new Date(t.hourly_start);
    const posts = (t.top_posts || []).map((p) => `<a class="post" href="${esc(safeUrl(p.url))}" data-link>
      <div class="post-h"><span><b>@${esc(p.author || "unknown")}</b>${p.followers != null ? " · " + num(p.followers) + " followers" : ""}</span><span>${p.created_at ? pkt(p.created_at, { day: "numeric", month: "short" }) : ""}</span></div>
      <div class="post-t">${esc(p.text)}</div>
      <div class="post-m"><span>♥ ${p.metrics.like_count ?? 0}</span><span>↻ ${p.metrics.retweet_count ?? 0}</span><span>💬 ${p.metrics.reply_count ?? 0}</span><span>👁 ${num(p.metrics.impression_count ?? 0)}</span></div></a>`).join("") || '<p class="muted small">No posts in the scanned sample.</p>';
    const ca = m.token_address || t.contract_address;
    $("#sheetBody").innerHTML = `
      <div class="d-head">${avatar(t)}<div><div class="d-sym">$${esc(t.symbol)}</div><div class="muted small">${tokenName(t)}${m.chain ? " · " + esc(m.chain) + (m.dex ? " / " + esc(m.dex) : "") : ""}</div></div></div>
      ${signalPanel(t)}
      <div class="kv">
        <div><span>Spike ratio</span><b class="red">${mult(t.spike_ratio)}×</b></div><div><span>Hype score</span><b>${t.hype_score}/100</b></div>
        <div><span>Mentions now</span><b>${num(t.recent_rate_per_h)}/h</b></div><div><span>Baseline</span><b>${t.baseline_per_h}/h</b></div>
        <div><span>Last 6h</span><b>${num(t.mentions_6h)}</b></div><div><span>Last 24h</span><b>${num(t.mentions_24h)}</b></div>
        <div><span>Sample authors</span><b>${t.unique_authors} / ${t.sample_posts} posts</b></div><div><span>Sample engagement</span><b>${num(t.sample_engagement)}</b></div>
      </div>
      <div class="d-chart">${sparkSVG(t.hourly, 400, 120, "d" + t.symbol)}
        <div class="axis"><span>${pkt(start.toISOString())}</span><span>hourly mentions · PKT</span><span>now</span></div></div>
      <div class="sec-t">Market ${marketState(m)}</div>
      <div class="kv">
        <div><span>Price</span><b class="${priceClass(m)}">${price(m.price_usd)}</b></div><div><span>Mkt cap</span><b>${usd(m.market_cap)}</b></div>
        <div><span>Change 1h / 24h</span><b>${pct(m.change_1h)} / ${pct(m.change_24h)}</b></div><div><span>Liquidity</span><b>${usd(m.liquidity_usd)}</b></div>
        <div><span>Volume 24h</span><b>${usd(m.volume_24h)}</b></div><div><span>Pair age</span><b>${m.pair_created_at ? ago(new Date(m.pair_created_at).toISOString()).replace(" ago", "") : NA}</b></div>
      </div>
      <p class="muted small" style="margin-top:6px">${m.source ? "Source: " + esc(m.source) + " — " + esc(m.match || "") : "Market data unavailable for this token."}</p>
      ${ca ? `<div class="sec-t">Contract</div><div class="ca" id="caBox" title="Copy">${esc(ca)}</div>` : ""}
      <div class="flags">${(t.risk_flags || []).map((f) => `<span class="flag">⚠ ${esc(f)}</span>`).join("") || '<span class="flag ok">No automatic red flags — still DYOR</span>'}</div>
      <div class="btns"><a class="btn primary" href="${xSearch(t)}" data-link>Live on X</a>${m.pair_url ? `<a class="btn" href="${esc(safeUrl(m.pair_url))}" data-link>DexScreener</a>` : ""}${ca && m.chain === "solana" ? `<a class="btn" href="https://rugcheck.xyz/tokens/${encodeURIComponent(ca)}" data-link>RugCheck</a>` : ""}${ca ? `<button class="btn" data-copy="${esc(ca)}">⧉ Copy CA</button>` : ""}</div>
      <div class="sec-t">Top posts in sample</div>${posts}
      <p class="muted small" style="margin-top:14px">X count query: <span class="mono">${esc(t.count_query)}</span></p>`;
    const cb = $("#caBox"); if (cb) cb.onclick = () => copyText(ca);
    $("#sheet").classList.add("on"); $("#backdrop").classList.add("on"); $("#sheet").setAttribute("aria-hidden", "false"); $("#sheet").scrollTop = updating ? scroll : 0;
    if (inTG) tg.BackButton.show();
  }
  function closeSheet() {
    openSymbol = null;
    $("#sheet").classList.remove("on"); $("#backdrop").classList.remove("on"); $("#sheet").setAttribute("aria-hidden", "true");
    if (inTG) tg.BackButton.hide();
  }

  // links → Telegram-aware
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]"); if (!a) return;
    e.preventDefault(); e.stopPropagation(); if (a.href && !a.href.endsWith("#")) openLink(a.href);
  });
  $("#backdrop").onclick = closeSheet; $("#sheetClose").onclick = closeSheet;
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeSheet());
  $("#kindSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; haptic("light");
    setKind(b.dataset.kind); };
  function setKind(k) { kind = k; document.querySelectorAll("#kindSeg button, #sigBoard .sb").forEach((x) => x.classList.toggle("on", x.dataset.kind === k)); renderList(); }
  $("#sigBoard").onclick = (e) => { const b = e.target.closest(".sb"); if (!b) return; haptic("light"); setKind(b.dataset.kind);
    document.querySelector(".controls").scrollIntoView({ behavior: "smooth", block: "start" }); };
  const copyText = (txt) => {
    const done = () => { haptic(); toast("Contract copied"); };
    const fallback = () => { const ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed"); } ta.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback); else fallback();
  };
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-copy]"); if (!b) return; e.preventDefault(); e.stopPropagation(); copyText(b.dataset.copy); }, true);
  $("#sortSel").onchange = (e) => { sortBy = e.target.value; renderList(); };
  $("#reloadBtn").onclick = () => { const b = $("#reloadBtn"); b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin"); load(true); };

  // ring gradient defs
  document.body.insertAdjacentHTML("beforeend", '<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="ringG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb0f2"/><stop offset="1" stop-color="#3b7ddd"/></linearGradient></defs></svg>');

  async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  const finite = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  function applyMarket(t, values, sourceTime = Date.now()) {
    const m = t.market || (t.market = {}), oldPrice = m.price_usd;
    for (const [key, value] of Object.entries(values)) if (finite(value)) m[key] = Number(value);
    m._direction = oldPrice != null && m.price_usd !== oldPrice ? Math.sign(m.price_usd - oldPrice) : 0;
    m._asOf = sourceTime;
    m._stale = Date.now() - sourceTime > 180000;
    marketCache.set(marketKey(t), { ...m });
  }
  async function refreshMarkets() {
    const groups = new Map(), cgTokens = [];
    for (const t of snap.tokens) {
      t.market = t.market || {};
      t.market._stale = true; t.market._direction = 0;
      if (cgId(t)) { cgTokens.push(t); continue; }
      const chain = t.market.chain || t.chain, address = t.market.token_address || t.contract_address;
      if (!chain || !address) continue;
      if (!groups.has(chain)) groups.set(chain, []);
      groups.get(chain).push(t);
    }
    const jobs = [];
    for (const [chain, tokens] of groups) {
      // DexScreener allows at most 30 token addresses per request.
      const addresses = [...new Set(tokens.map(t => t.market.token_address || t.contract_address))];
      for (let i = 0; i < addresses.length; i += 30) {
        const batch = addresses.slice(i, i + 30);
        jobs.push((async () => {
          const pairs = await fetchJSON(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chain)}/${batch.map(encodeURIComponent).join(",")}`);
          if (!Array.isArray(pairs)) throw new Error("Invalid market response");
          for (const t of tokens.filter(t => batch.includes(t.market.token_address || t.contract_address))) {
            const address = t.market.token_address || t.contract_address;
            // EVM addresses are case insensitive; Solana and other chains are not.
            const same = (a, b) => a && b && (a.startsWith("0x") && b.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);
            const mk = marketFromPairs(pairs.filter(p => p.chainId === chain), address, t.market.pair_url);
            if (!mk) continue;
            for (const [k, v] of Object.entries(mk.obj)) if (v && typeof v === "object") t.market[k] = v;
            applyMarket(t, mk.num);
          }
        })());
      }
    }
    if (cgTokens.length) jobs.push((async () => {
      const ids = [...new Set(cgTokens.map(cgId))].join(",");
      let data = null;
      if (Date.now() >= cgPauseUntil) {
        try { data = await fetchJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`); cgBackoff = 120000; }
        catch (e) { cgPauseUntil = Date.now() + cgBackoff; cgBackoff = Math.min(cgBackoff * 2, 600000); } // 429 arrives as a CORS error: back off
      }
      for (const t of cgTokens) {
        const q = data && data[cgId(t)];
        if (q && finite(q.usd) && Number(q.usd) > 0) { t.market._via = "CoinGecko"; applyMarket(t, { price_usd: q.usd, change_24h: q.usd_24h_change, market_cap: q.usd_market_cap, volume_24h: q.usd_24h_vol }, q.last_updated_at ? q.last_updated_at * 1000 : Date.now()); continue; }
        // fallback: Binance <SYMBOL>USDT, accepted only if within 15% of the snapshot's CoinGecko price (guards against ticker collisions)
        try {
          const pair = t.symbol.toUpperCase() + "USDT", ref = N(t.market.price_usd);
          const x = await fetchJSON(`https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${pair}`);
          if (ref && finite(x.lastPrice) && Math.abs(x.lastPrice / ref - 1) < 0.15) { t.market._via = "Binance " + pair + " (fallback)"; applyMarket(t, { price_usd: x.lastPrice, change_24h: x.priceChangePercent }, N(x.closeTime) || Date.now()); }
        } catch (e) { /* stays stale */ }
      }
    })());
    await Promise.allSettled(jobs);
    snap.tokens.forEach(enrich); // re-score pump/dump + risk with the fresh market data
    const times = snap.tokens.filter(t => !t.market._stale).map(t => t.market._asOf);
    if (times.length) pricesAsOf = Math.max(...times);
  }
  function load(manual = false) {
    if (refreshPromise) return refreshPromise;
    nextRefresh = Date.now() + REFRESH_MS;
    $("#reloadBtn").classList.add("spinning");
    refreshPromise = (async () => {
      try {
        const incoming = await fetchJSON("data/snapshot.json?t=" + Date.now());
        if (!Array.isArray(incoming.tokens) || !incoming.stats || !incoming.method) throw new Error("Invalid snapshot");
        for (const t of incoming.tokens) {
          const cached = marketCache.get(marketKey(t));
          if (cached) t.market = { ...t.market, ...cached, _direction: 0 };
          else t.market = { ...t.market, _stale: true };
        }
        incoming.tokens.forEach(enrich);
        snap = incoming; snapshotFailed = false;
      } catch (e) { snapshotFailed = true; }
      if (!snap) {
        $("#list").innerHTML = '<div class="empty">Snapshot load nahi ho saka. Refresh to retry.</div>';
        return;
      }
      render(); // Keep the dashboard usable while the live feeds are loading.
      await refreshMarkets();
      render();
      document.body.classList.add("has-refreshed");
      if (openSymbol) openSheet(snap.tokens.find(t => t.symbol === openSymbol), true);
      if (firstLoad) {
        firstLoad = false;
        const want = (new URLSearchParams(location.search).get("token") || (inTG && tg.initDataUnsafe?.start_param) || "").toUpperCase();
        const hit = snap.tokens.find(t => t.symbol === want); if (hit) openSheet(hit);
      }
      if (manual) toast(snapshotFailed ? "X snapshot delayed · last known data kept" : snap.tokens.some(t => t.market._stale) ? "Refreshed · some markets stale" : "Live prices refreshed");
    })().catch(() => { if (snap) { snap.tokens.forEach(t => t.market._stale = true); updatePill(); } })
      .finally(() => { refreshPromise = null; $("#reloadBtn").classList.remove("spinning"); updateCountdown(); });
    return refreshPromise;
  }
  load();
  setInterval(() => {
    updateCountdown();
    if (!document.hidden && !refreshPromise && Date.now() >= nextRefresh) load();
  }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

  // ---------- pull-to-refresh (mobile) ----------
  document.body.insertAdjacentHTML("afterbegin", '<div class="ptr" id="ptr"><div class="ptr-ring"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15"/></svg></div><span class="ptr-txt">Pull to refresh</span></div>');
  const ptr = $("#ptr"), ptrTxt = ptr.querySelector(".ptr-txt"), TH = 80;
  let y0 = null, dy = 0, busy = false;
  const setPull = (d) => { ptr.style.transform = `translate(-50%, ${Math.min(d, 110) - 70}px)`; ptr.style.opacity = Math.min(d / TH, 1);
    ptr.querySelector("svg").style.transform = `rotate(${d * 4}deg)`; ptr.classList.toggle("armed", d >= TH); ptrTxt.textContent = d >= TH ? "Release to refresh" : "Pull to refresh"; };
  addEventListener("touchstart", (e) => { if (!busy && scrollY <= 0 && !document.querySelector(".sheet.on")) { y0 = e.touches[0].clientY; dy = 0; ptr.classList.remove("snap"); } }, { passive: true });
  addEventListener("touchmove", (e) => { if (y0 == null) return; dy = (e.touches[0].clientY - y0) * 0.5; if (dy > 0) { setPull(dy); if (e.cancelable) e.preventDefault(); } else setPull(0); }, { passive: false });
  addEventListener("touchend", async () => { if (y0 == null) return; y0 = null; ptr.classList.add("snap");
    if (dy >= TH) { busy = true; ptr.classList.add("spin"); ptrTxt.textContent = "Refreshing…"; setPull(TH); if (inTG && tg.HapticFeedback) tg.HapticFeedback.impactOccurred("medium");
      await load(true); await new Promise((r) => setTimeout(r, 400)); ptr.classList.remove("spin"); busy = false; }
    setPull(0); });
})();
