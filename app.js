/* X Hype Radar — dashboard + Telegram Mini App */
(() => {
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
  const inTG = !!(tg && tg.platform && tg.platform !== "unknown");
  const $ = (s) => document.querySelector(s);
  const TZ = "Asia/Karachi";
  let snap = null, kind = "all", sortBy = "default", openSymbol = null;
  const REFRESH_MS = 60_000;
  let refreshPromise = null, nextRefresh = Date.now() + REFRESH_MS;
  let pricesAsOf = null, snapshotFailed = false, firstLoad = true;
  const marketCache = new Map();
  const cgId = (t) => { const m = t.market || {}; return m.coingecko_id || t.coingecko_id || (/coingecko id ([a-z0-9-]+)/i.exec(m.match || "") || [])[1]; };
  const marketKey = (t) => [t.symbol, t.market?.chain || t.chain || "", t.market?.token_address || t.contract_address || "", cgId(t) || ""].join(":");
  const clock = (iso, seconds = false) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });
  const priceClass = (m) => m._direction > 0 ? "price-up" : m._direction < 0 ? "price-down" : "";
  const marketState = (m) => `<span class="market-state ${m._stale ? "is-stale" : ""}">${m._stale ? "Last known · stale" : "Live market"}</span>`;

  // ---------- Telegram integration ----------
  if (inTG) {
    tg.ready(); tg.expand();
    try { tg.setHeaderColor("#050505"); tg.setBackgroundColor("#050505"); tg.setBottomBarColor && tg.setBottomBarColor("#050505"); } catch (e) {}
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
      <defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2a3d" stop-opacity=".45"/><stop offset="1" stop-color="#ff2a3d" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#g${id})"/>
      <path d="${d}" fill="none" stroke="#ff2a3d" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="#fff" stroke="#ff2a3d" stroke-width="2"/></svg>`;
  }
  function ring(score) {
    const r = 20, c = 2 * Math.PI * r, off = c * (1 - score / 100);
    return `<div class="ring" title="Hype score"><svg width="48" height="48"><circle cx="24" cy="24" r="${r}" stroke="rgba(255,255,255,.07)" stroke-width="4" fill="none"/>
      <circle cx="24" cy="24" r="${r}" stroke="url(#ringG)" stroke-width="4" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg><b>${score}</b></div>`;
  }
  const avatar = (t) => { const img = t.market && t.market.image; return img ? `<div class="avatar" style="background-image:url('${esc(safeUrl(img))}')"></div>` : `<div class="avatar">${esc(t.symbol.slice(0, 2))}</div>`; };
  const tokenName = (t) => esc(t.note ? "pump.fun launchpad (PUMP)" : (t.market && t.market.name) || (t.kind === "major" ? "Major" : "Unpriced token"));
  const xSearch = (t) => "https://x.com/search?q=" + encodeURIComponent("$" + t.symbol) + "&f=live";

  // ---------- render ----------
  function render() {
    const s = snap.stats, toks = snap.tokens;
    const gen = snap.x_data_as_of || snap.generated_at;
    updatePill();
    const spiking = toks.filter((t) => t.is_spiking);
    $("#heroLine").innerHTML = `${s.posts_analyzed} real X posts scanned · ${s.tokens_tracked} tokens checked for hourly mention velocity. <b style="color:#fff">${spiking.length}</b> token${spiking.length === 1 ? "" : "s"} abhi normal se zyada discuss ho rahe hain.`;

    const top = spiking[0] || toks[0];
    if (top) {
      const m = top.market || {};
      $("#spotlight").innerHTML = `<span class="sp-tag">🔥 Top spike right now</span>
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
      [s.posts_analyzed, "X posts analyzed"], [s.tokens_tracked, "Tokens velocity-checked"],
      [mult(maxSpike) + "×", "Biggest mention spike"], [num(s.mentions_24h_tracked), "Mentions tracked (24h)"],
    ].map(([b, l]) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`).join("");

    renderList();
    $("#also").innerHTML = (snap.also_seen || []).map((a) =>
      `<a class="chip" href="https://x.com/search?q=${encodeURIComponent("$" + a.symbol)}&f=live" data-link>$${esc(a.symbol)}<em>${a.posts}p · ${a.authors}a</em></a>`).join("") || '<span class="muted">—</span>';
    $("#method").innerHTML = `<div class="panel-h"><h3>How the radar works</h3><span class="muted small">Source: ${esc(snap.source)}</span></div>
      <p><b style="color:#fff">Spike ratio</b> — ${esc(snap.method.spike_ratio)}.</p>
      <p><b style="color:#fff">Hype score</b> — ${esc(snap.method.hype_score)}.</p>
      <p><b style="color:#fff">Spiking</b> = spike ≥ 1.5× and ≥ 5 mentions/hour. Counts come from X's full post-count endpoint; top posts, authors and engagement come from the scanned sample. Prices refresh every 60 seconds while visible via DexScreener / CoinGecko. X mentions update hourly, independently. Missing values stay n/a; failed market refreshes keep last known values and show stale. Symbol-search matches are unverified: check the contract before trading.</p>`;
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
    if (kind === "spiking") t = t.filter((x) => x.is_spiking);
    else if (kind !== "all") t = t.filter((x) => x.kind === kind);
    const k = { spike: "spike_ratio", score: "hype_score", rate: "recent_rate_per_h", m24: "mentions_24h" }[sortBy];
    if (k) t.sort((a, b) => b[k] - a[k]);
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
      <div class="c-mid"><div><div class="mult ${up ? "up" : "flat"}">${mult(t.spike_ratio)}×</div><div class="mult-l">vs 24h baseline</div></div>
        <div class="spark">${sparkSVG(t.hourly, 200, 44, t.symbol)}</div></div>
      <div class="c-grid">
        <div><span>Now</span><b>${num(t.recent_rate_per_h)}/h</b></div>
        <div><span>24h</span><b>${num(t.mentions_24h)}</b></div>
        <div><span>Price</span><b class="${priceClass(m)}">${price(m.price_usd)}</b></div>
        <div><span>1h / 24h</span><b>${pct(m.change_1h)} / ${pct(m.change_24h)}</b></div>
        <div><span>Liquidity</span><b>${usd(m.liquidity_usd)}</b></div>
        <div><span>Market cap</span><b>${usd(m.market_cap)}</b></div>
        <div><span>Vol 24h</span><b>${usd(m.volume_24h)}</b></div>
      </div>
      ${marketState(m)}
      ${flags ? `<div class="flags">${flags}</div>` : ""}
    </article>`;
  }

  function renderList() {
    const t = sorted();
    $("#list").innerHTML = t.length ? t.map(card).join("") : '<div class="empty">Is filter mein abhi koi token nahi.</div>';
    document.querySelectorAll(".card").forEach((el) => (el.onclick = () => openSheet(snap.tokens.find((x) => x.symbol === el.dataset.sym))));
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
      <div class="btns"><a class="btn primary" href="${xSearch(t)}" data-link>Live on X</a>${m.pair_url ? `<a class="btn" href="${esc(safeUrl(m.pair_url))}" data-link>DexScreener</a>` : ""}</div>
      <div class="sec-t">Top posts in sample</div>${posts}
      <p class="muted small" style="margin-top:14px">X count query: <span class="mono">${esc(t.count_query)}</span></p>`;
    const cb = $("#caBox"); if (cb) cb.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(ca); haptic(); toast("Contract copied"); };
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
    kind = b.dataset.kind; document.querySelectorAll("#kindSeg button").forEach((x) => x.classList.toggle("on", x === b)); renderList(); };
  $("#sortSel").onchange = (e) => { sortBy = e.target.value; renderList(); };
  $("#reloadBtn").onclick = () => { const b = $("#reloadBtn"); b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin"); load(true); };

  // ring gradient defs
  document.body.insertAdjacentHTML("beforeend", '<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="ringG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a68"/><stop offset="1" stop-color="#b80018"/></linearGradient></defs></svg>');

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
            const matches = pairs.filter(p => p.chainId === chain && same(p.baseToken?.address, address) && finite(p.priceUsd) && Number(p.priceUsd) > 0);
            matches.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
            const p = matches.find(p => (p.url || "").toLowerCase() === (t.market.pair_url || "").toLowerCase()) || matches[0];
            if (!p) continue;
            applyMarket(t, { price_usd: p.priceUsd, change_1h: p.priceChange?.h1, change_24h: p.priceChange?.h24, liquidity_usd: p.liquidity?.usd, market_cap: p.marketCap, volume_24h: p.volume?.h24, volume_1h: p.volume?.h1 });
          }
        })());
      }
    }
    if (cgTokens.length) jobs.push((async () => {
      const ids = [...new Set(cgTokens.map(cgId))].join(",");
      const data = await fetchJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`);
      for (const t of cgTokens) {
        const q = data[cgId(t)];
        if (!q || !finite(q.usd) || Number(q.usd) <= 0) continue;
        applyMarket(t, { price_usd: q.usd, change_24h: q.usd_24h_change, market_cap: q.usd_market_cap, volume_24h: q.usd_24h_vol }, q.last_updated_at ? q.last_updated_at * 1000 : Date.now());
      }
    })());
    await Promise.allSettled(jobs);
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
