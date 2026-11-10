/* Top 500 Research — static app. Reads data/top500.json (+ data/reports/<id>.json lazily) and refreshes
   prices every 60 s from CoinGecko. Nothing is invented: missing data shows "data nahi mila". */
(() => {
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
  const inTG = !!(tg && tg.platform && tg.platform !== "unknown");
  const $ = (s) => document.querySelector(s);
  const TZ = "Asia/Karachi", REFRESH_MS = 60_000, PAGE = 40;
  let data = null, kind = "all", sortBy = "rank", query = "", shown = PAGE, openId = null, nextRefresh = Date.now() + REFRESH_MS,
      refreshPromise = null, pricesAt = null, priceFail = false, firstLoad = true;
  const reports = new Map();

  if (inTG) {
    tg.ready(); tg.expand();
    try { tg.setHeaderColor("#f2f6fc"); tg.setBackgroundColor("#f2f6fc"); tg.setBottomBarColor && tg.setBottomBarColor("#ffffff"); } catch (e) {}
    const setVh = () => document.documentElement.style.setProperty("--tg-viewport-stable-height", (tg.viewportStableHeight || window.innerHeight) + "px");
    setVh(); tg.onEvent("viewportChanged", setVh); tg.BackButton.onClick(() => closeSheet());
    document.documentElement.classList.add("tg");
  }
  const haptic = (t = "light") => { try { inTG && tg.HapticFeedback.impactOccurred(t); } catch (e) {} };
  const openLink = (url) => { if (inTG) { /^https:\/\/t\.me\//.test(url) ? tg.openTelegramLink(url) : tg.openLink(url); } else window.open(url, "_blank", "noopener"); };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https:\/\//.test(u || "") ? u : "#");
  const NM = '<span class="nodata">data nahi mila</span>';
  const NA = '<span class="muted">n/a</span>';
  const N = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const num = (n, d = 1) => { if (n == null) return "n/a"; const a = Math.abs(n);
    return a >= 1e12 ? (n / 1e12).toFixed(2) + "T" : a >= 1e9 ? (n / 1e9).toFixed(2) + "B" : a >= 1e6 ? (n / 1e6).toFixed(2) + "M" : a >= 1e3 ? (n / 1e3).toFixed(d) + "K" : (+n).toFixed(a < 10 ? 2 : 0); };
  const usd = (n) => (n == null ? NM : "$" + num(n));
  const price = (p) => { if (p == null) return NA; if (p >= 1000) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (p >= 1) return "$" + p.toFixed(2); if (p >= 0.01) return "$" + p.toFixed(4); return "$" + p.toPrecision(3); };
  const pct = (v, d = 1) => (v == null ? NA : `<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${(+v).toFixed(Math.abs(v) >= 100 ? 0 : d)}%</span>`);
  const pkt = (iso, o) => new Date(iso).toLocaleString("en-GB", Object.assign({ timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }, o || {})) + " PKT";
  const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? "abhi" : m < 60 ? m + "m pehle" : m < 1440 ? Math.round(m / 60) + "h pehle" : Math.round(m / 1440) + "d pehle"; };
  const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 1700); };
  const avatar = (c, cls = "") => c.image ? `<img class="t5av ${cls}" loading="lazy" src="${esc(safeUrl(c.image))}" alt="">` : `<div class="t5av ${cls}">${esc((c.symbol || "?").slice(0, 3))}</div>`;

  const SIG = { pump: ["🚀", "sig-pump"], breakout: ["🚀", "sig-pump"], dump: ["🩸", "sig-dump"], breakdown: ["🩸", "sig-dump"],
    overbought: ["🔥", "sig-hot"], oversold: ["🧊", "sig-cold"], hype: ["👀", "sig-early"], stable: ["💵", "sig-neutral"], neutral: ["•", "sig-neutral"] };
  const sigBadge = (s) => { s = s || { code: "neutral", label: "Neutral" }; const [ic, cl] = SIG[s.code] || SIG.neutral; return `<span class="sig ${cl}">${ic} ${esc(s.label)}</span>`; };
  const TRC = { Uptrend: "tr-up", Downtrend: "tr-down", Range: "tr-range" };
  const trendChip = (t, pre = "") => t && t !== "n/a" ? `<span class="trend ${TRC[t] || ""}">${pre}${t === "Uptrend" ? "▲" : t === "Downtrend" ? "▼" : "◆"} ${esc(t)}</span>` : `<span class="trend">${pre}trend n/a</span>`;
  const riskChip = (r) => !r ? "" : r.score == null ? `<span class="risk-chip risk-low">${esc(r.level)}</span>` : `<span class="risk-chip risk-${r.level.toLowerCase()}">Risk ${r.score}<em>${r.level}</em></span>`;

  const noTA = (c) => c.kind === "stable" || c.kind === "yield";
  function zoneDist(c) {
    const ta = c.ta; if (!ta || c.price == null) return;
    const p = c.price;
    if (ta.buy_zone) { const [lo, hi] = ta.buy_zone; ta.buy_dist_pct = p >= lo && p <= hi ? 0 : p > hi ? (p - hi) / p * 100 : (p - lo) / p * 100; }
    if (ta.sell_zone) { const [lo, hi] = ta.sell_zone; ta.sell_dist_pct = p >= lo && p <= hi ? 0 : p < lo ? (lo - p) / p * 100 : (hi - p) / p * 100; }
  }
  const inBuy = (c) => c.ta && c.ta.buy_dist_pct != null && c.ta.buy_dist_pct <= 3 && c.ta.buy_dist_pct >= -2;
  const inSell = (c) => c.ta && c.ta.sell_dist_pct != null && c.ta.sell_dist_pct <= 3 && c.ta.sell_dist_pct >= -2;
  const distTxt = (d, side) => d == null ? "n/a" : d === 0 ? (side === "buy" ? "zone ke andar" : "zone ke andar") : side === "buy" ? (d > 0 ? `${d.toFixed(1)}% upar` : `${(-d).toFixed(1)}% neeche (toot gaya)`) : (d > 0 ? `${d.toFixed(1)}% door` : `${(-d).toFixed(1)}% upar (cross)`);

  function sparkSVG(sp, w = 120, h = 34, cls = "") {
    if (!sp || !sp.v || sp.v.length < 2) return "";
    const n = sp.v.length - 1, pts = sp.v.map((y, i) => [(i / n) * w, h - 2 - (y / 100) * (h - 4)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const up = sp.v[sp.v.length - 1] >= sp.v[0];
    return `<svg class="t5spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${up ? "#1f9d63" : "#d9534f"}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  // ---------- filtering / sorting ----------
  const KIND = {
    all: () => true, pump: (c) => ["pump", "breakout"].includes(c.signal?.code), dump: (c) => ["dump", "breakdown"].includes(c.signal?.code),
    overbought: (c) => c.signal?.code === "overbought", oversold: (c) => c.signal?.code === "oversold", hype: (c) => c.signal?.code === "hype" || ((c.x || {}).fresh && (c.x.spike >= 3)),
    buyzone: inBuy, sellzone: inSell, up: (c) => c.ta?.trend === "Uptrend", down: (c) => c.ta?.trend === "Downtrend" };
  const big = -1e18;
  const SORT = {
    rank: (a, b) => (a.rank || 9999) - (b.rank || 9999), c24: (a, b) => (b.change_24h ?? big) - (a.change_24h ?? big), c24a: (a, b) => (a.change_24h ?? 1e18) - (b.change_24h ?? 1e18),
    c7: (a, b) => (b.change_7d ?? big) - (a.change_7d ?? big), vol: (a, b) => (b.ta?.vol_spike ?? big) - (a.ta?.vol_spike ?? big),
    xs: (a, b) => ((b.x || {}).spike ?? big) - ((a.x || {}).spike ?? big),
    buy: (a, b) => Math.abs(a.ta?.buy_dist_pct ?? 1e9) - Math.abs(b.ta?.buy_dist_pct ?? 1e9), sell: (a, b) => Math.abs(a.ta?.sell_dist_pct ?? 1e9) - Math.abs(b.ta?.sell_dist_pct ?? 1e9),
    rsi: (a, b) => (b.ta?.rsi ?? big) - (a.ta?.rsi ?? big), rsil: (a, b) => (a.ta?.rsi ?? 1e18) - (b.ta?.rsi ?? 1e18),
    risk: (a, b) => (a.risk?.score ?? 999) - (b.risk?.score ?? 999) };
  function filtered() {
    const q = query.trim().toLowerCase();
    let xs = data.coins.filter(KIND[kind] || KIND.all);
    if (q) xs = xs.filter((c) => c.symbol.toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q) || c.id.includes(q))
      .sort((a, b) => (b.symbol.toLowerCase() === q) - (a.symbol.toLowerCase() === q) || (a.rank || 9999) - (b.rank || 9999));
    else xs.sort(SORT[sortBy] || SORT.rank);
    return xs;
  }

  // ---------- render ----------
  function render() {
    const cov = data.coverage || {}, cs = data.coins;
    const tr = { Uptrend: 0, Downtrend: 0, Range: 0 }; cs.forEach((c) => c.ta && tr[c.ta.trend] != null && tr[c.ta.trend]++);
    const tot = tr.Uptrend + tr.Downtrend + tr.Range || 1;
    const btc = cs.find((c) => c.id === "bitcoin"), eth = cs.find((c) => c.id === "ethereum");
    $("#heroLine").innerHTML = `${cs.length} coins · trend/zones ${cov.zones} · reports ${cov.reports} · X hype ${cov.x_hype} — market data ${data.market_as_of ? pkt(data.market_as_of) : "n/a"}. <b class="red">Financial advice nahi, DYOR.</b>`;
    const mini = (c) => c ? `<div class="bmini" data-id="${esc(c.id)}">${avatar(c, "sm")}<div><b>${esc(c.symbol)}</b> <span class="mono">${price(c.price)}</span><div>${pct(c.change_24h)} · ${trendChip(c.ta?.trend)}</div></div></div>` : "";
    $("#breadth").innerHTML = `<span class="sp-tag">Market breadth · daily trend</span>
      <div class="bbar"><i class="b-up" style="width:${tr.Uptrend / tot * 100}%"></i><i class="b-range" style="width:${tr.Range / tot * 100}%"></i><i class="b-down" style="width:${tr.Downtrend / tot * 100}%"></i></div>
      <div class="blegend"><span><b class="pos">${tr.Uptrend}</b> Uptrend</span><span><b class="gold">${tr.Range}</b> Range</span><span><b class="neg">${tr.Downtrend}</b> Downtrend</span></div>
      <div class="bminis">${mini(btc)}${mini(eth)}</div>`;
    const cnt = (k) => cs.filter(KIND[k]).length;
    $("#stats").innerHTML = [[cs.length, "Coins"], [cov.zones, "Zones ready"], [cov.reports, "Reports"], [cov.x_hype, "X hype (26h)"]]
      .map(([b, s]) => `<div class="stat"><b>${b ?? 0}</b><span>${s}</span></div>`).join("");
    $("#sigBoard").innerHTML = [["pump", "🚀", "Pump / Breakout", "sig-pump"], ["dump", "🩸", "Dump / Breakdown", "sig-dump"], ["overbought", "🔥", "Overbought", "sig-hot"],
      ["oversold", "🧊", "Oversold", "sig-cold"], ["hype", "👀", "X Hype", "sig-early"], ["buyzone", "🟢", "Buy zone mein", "sig-pump"]]
      .map(([k, ic, l, cl]) => `<button class="sb ${cl} ${kind === k ? "on" : ""}" data-kind="${k}"><b>${ic} ${cnt(k)}</b><span>${l}</span></button>`).join("");
    renderList();
    updatePill();
  }
  function row(c, i) {
    const ta = c.ta, s = c.signal || {};
    const zone = noTA(c) ? `<span class="muted">${c.kind === "yield" ? "Tokenized yield asset" : "Stablecoin"} — zones apply nahi</span>` : ta ? `<span class="zb">Buy <b>${ta.buy_zone ? price(ta.buy_zone[0]) + "–" + price(ta.buy_zone[1]) : "data nahi mila"}</b> <em>${ta.buy_zone ? distTxt(ta.buy_dist_pct, "buy") : ""}</em></span><span class="zs">Sell <b>${ta.sell_zone ? price(ta.sell_zone[0]) + "–" + price(ta.sell_zone[1]) : "ATH zone"}</b> <em>${ta.sell_zone ? distTxt(ta.sell_dist_pct, "sell") : "price discovery"}</em></span>` : `<span class="muted">Zones: candles abhi load ho rahe hain (rotation)</span>`;
    const x = c.x && c.x.fresh ? `<span class="xh ${c.x.spike >= 3 ? "hot" : ""}">X ${c.x.spike.toFixed(1)}x</span>` : "";
    return `<div class="t5row ${["pump", "breakout", "dump", "breakdown"].includes(s.code) ? "hot" : ""}" data-id="${esc(c.id)}" style="animation-delay:${Math.min(i, 12) * 25}ms">
      <div class="r-rank">${c.rank ?? "—"}</div>${avatar(c)}
      <div class="r-id"><div class="r-sym">${esc(c.symbol)} <span>${esc(c.name)}</span></div><div class="r-tags">${trendChip(ta?.trend)}${sigBadge(s)}${x}</div></div>
      <div class="r-px"><b class="mono" data-px="${esc(c.id)}">${price(c.price)}</b><span>${pct(c.change_24h)} <em>24h</em></span><span class="r-7d">${pct(c.change_7d)} <em>7d</em></span></div>
      <div class="r-spark">${sparkSVG(ta?.spark)}</div>
      <div class="r-zone">${zone}${riskChip(c.risk)}</div>
    </div>`;
  }
  function renderList() {
    const xs = filtered();
    $("#list").innerHTML = xs.slice(0, shown).map(row).join("") || `<div class="empty">Is filter mein abhi koi coin nahi.${query ? " Search: " + esc(query) : ""}</div>`;
    $("#moreBtn").style.display = xs.length > shown ? "" : "none";
    $("#moreBtn").textContent = `Aur dikhayein (${xs.length - shown} baqi)`;
  }
  function updatePill() {
    if (!data) return;
    $("#priceAge").textContent = pricesAt ? `Prices · live ${new Date(pricesAt).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })} PKT` : "Prices · snapshot";
    $("#snapAge").textContent = `Data: ${ago(data.generated_at)}`;
    $("#feedStatus").textContent = priceFail ? "Live price feed busy — last known prices" : "";
    $("#livePill").classList.toggle("stale", priceFail || Date.now() - new Date(data.generated_at) > 45 * 60000);
  }
  function updateCountdown() {
    const left = Math.max(0, Math.ceil((nextRefresh - Date.now()) / 1000));
    $("#countdown").style.setProperty("--remaining", left / 60);
    $("#countdownNumber").textContent = refreshPromise ? "↻" : left;
  }

  // ---------- detail sheet ----------
  function chartSVG(c) {
    const ta = c.ta, sp = ta && ta.spark; if (!sp || !sp.v) return "";
    const W = 400, H = 150, lo0 = sp.lo, hi0 = sp.hi, span0 = hi0 - lo0 || hi0 * 0.05 || 1;
    let lo = lo0, hi = hi0;
    const inc = (v) => { if (v == null) return; if (v < lo && v > lo0 - span0 * 0.6) lo = v; if (v > hi && v < hi0 + span0 * 0.6) hi = v; };
    if (ta.buy_zone) inc(ta.buy_zone[0]); if (ta.sell_zone) inc(ta.sell_zone[1]); if (c.price) inc(c.price);
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const Y = (v) => H - ((v - lo) / (hi - lo)) * H, n = sp.v.length - 1;
    const pts = sp.v.map((y, i) => [(i / n) * W, Y(lo0 + (y / 100) * (hi0 - lo0))]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const band = (z, cl) => { if (!z) return ""; const y1 = Math.max(0, Math.min(H, Y(z[1]))), y2 = Math.max(0, Math.min(H, Y(z[0]))); return y2 - y1 > 0.5 ? `<rect class="${cl}" x="0" y="${y1}" width="${W}" height="${y2 - y1}"/>` : ""; };
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="zchart">${band(ta.sell_zone, "zband-s")}${band(ta.buy_zone, "zband-b")}
      <defs><linearGradient id="zg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(59,125,221,.20)"/><stop offset="1" stop-color="rgba(59,125,221,0)"/></linearGradient></defs>
      <path d="${d} L ${W} ${H} L 0 ${H} Z" fill="url(#zg)"/><path d="${d}" fill="none" stroke="#3b7ddd" stroke-width="2" stroke-linejoin="round"/>
      ${c.price ? `<line x1="0" x2="${W}" y1="${Y(c.price)}" y2="${Y(c.price)}" class="pxline"/>` : ""}</svg>
      <div class="axis"><span>${sp.v.length} din pehle</span><span><i class="lg-b"></i> buy zone <i class="lg-s"></i> sell zone</span><span>aaj</span></div>`;
  }
  const kv = (label, val) => `<div><span>${label}</span><b>${val}</b></div>`;
  function xSection(c) {
    const x = c.x;
    if (!x) return `<p class="muted small">X hype check abhi is coin tak nahi pohncha — har ghante ~20 coins rotation mein check hote hain.</p>`;
    const h = x.hourly || [], mx = Math.max(1, ...h);
    const bars = h.map((v) => `<i style="height:${Math.max(3, v / mx * 100)}%"></i>`).join("");
    return `<div class="kv">${kv("Spike (abhi vs normal)", `<span class="${x.spike >= 3 ? "red" : ""}">${x.spike.toFixed(2)}x</span>`)}${kv("Mentions / hour", `${num(x.rate)} <small class="muted">normal ${num(x.baseline)}</small>`)}
      ${kv("Mentions 24h", num(x.m24))}${kv("24h vs pichle 24h", x.m24_chg != null ? pct(x.m24_chg, 0) : NM)}</div>
      <div class="xbars">${bars}</div><div class="axis"><span>24h pehle</span><span>hourly X posts</span><span>abhi</span></div>
      <p class="muted small">Checked ${pkt(x.checked_at)}${x.fresh ? "" : " · <span class='gold'>purana (26h+), agle rotation mein update hoga</span>"} · query: <span class="mono">${esc(x.query)}</span></p>`;
  }
  function riskSection(r) {
    if (!r) return "";
    if (r.score == null) return `<div class="riskpanel"><p>${esc(r.reasons.join(" "))}</p></div>`;
    return `<div class="riskpanel risk-${r.level.toLowerCase()}"><div class="sp-h"><span class="muted small">RISK SCORE (data se)</span><b class="rk">${r.score}<small>/100 · ${r.level}</small></b></div>
      <div class="rmeter"><i style="left:${r.score}%"></i></div><ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${r.missing && r.missing.length ? `<p class="muted small">Data nahi mila: ${esc(r.missing.join(", "))}</p>` : ""}</div>`;
  }
  function reportHTML(c, rep) {
    if (rep === undefined) return `<div class="loading">Report load ho rahi hai…</div>`;
    if (rep === null) return `<p class="muted">Research report abhi nahi bani — reports rotation mein ban rahi hain (har ~15 min mein ~30 coins). Thori der baad dobara kholein.</p>`;
    const p = rep.project || {}, L = p.links || {}, t = rep.tokenomics || {}, df = rep.defi, tm = rep.team || {}, li = rep.listings || {}, pp = rep.paprika;
    const link = (u, l) => u ? `<a class="chip" href="${esc(safeUrl(u))}" data-link>${l}</a>` : "";
    const desc = p.description ? esc(p.description).replace(/\n+/g, "<br>") : NM;
    const capS = t.max_supply || t.total_supply;
    const bar = t.circulating_supply && capS ? `<div class="supbar"><i style="width:${Math.min(100, t.circulating_supply / capS * 100)}%"></i></div><div class="axis"><span>Circulating ${t.circulating_pct != null ? t.circulating_pct.toFixed(1) + "%" : ""}</span><span>${t.max_supply ? "max supply" : "total supply"}</span></div>` : "";
    return `
      <div class="sec-t">Project</div>
      <div class="desc" id="desc">${desc}</div>${p.description && p.description.length > 420 ? `<button class="linkbtn" id="descMore">Poora parhein</button>` : ""}
      <div class="chips cats">${(p.categories || []).map((x) => `<span class="chip">${esc(x)}</span>`).join("") || NM}</div>
      <div class="kv">${kv("Launch / genesis", p.genesis_date || (pp && pp.started_at ? pp.started_at.slice(0, 10) + " <small class='muted'>(CoinPaprika)</small>" : NM))}${kv("Consensus / type", esc([pp && pp.proof_type, p.hashing_algorithm].filter(Boolean).join(" · ")) || NM)}
        ${kv("Org structure", pp && pp.org_structure ? esc(pp.org_structure) : NM)}${kv("Chains / contracts", Object.keys(p.platforms || {}).length ? esc(Object.keys(p.platforms).slice(0, 4).join(", ")) + (Object.keys(p.platforms).length > 4 ? ` +${Object.keys(p.platforms).length - 4}` : "") : "native coin / " + NM)}</div>
      <div class="chips links">${(L.homepage || []).slice(0, 1).map((u) => link(u, "🌐 Website")).join("")}${link(L.whitepaper, "📄 Whitepaper")}${link(L.twitter, "𝕏 X")}${link(L.telegram, "✈ Telegram")}${link(L.discord, "Discord")}${link(L.reddit, "Reddit")}${(L.github || []).slice(0, 1).map((u) => link(u, "GitHub")).join("")}${(L.explorers || []).slice(0, 1).map((u) => link(u, "🔎 Explorer")).join("")}${link(L.coingecko, "CoinGecko")}</div>
      ${p.public_notice ? `<p class="notice">⚠ ${esc(p.public_notice)}</p>` : ""}
      <div class="sec-t">Team</div>
      ${tm.members && tm.members.length ? `<div class="team">${tm.members.map((m) => `<div><b>${esc(m.name)}</b><span>${esc(m.position || "")}</span></div>`).join("")}</div><p class="muted small">Source: <a href="${esc(safeUrl(tm.url))}" data-link>${esc(tm.source)}</a>${tm.total > tm.members.length ? ` · ${tm.total} mein se ${tm.members.length}` : ""} — public list, khud verify karein.</p>` : `<p>${NM} <span class="muted small">${tm.source ? "(" + esc(tm.source) + " par team list khaali)" : "(CoinPaprika par yeh coin nahi mila)"}</span></p>`}
      <div class="sec-t">Tokenomics</div>
      <div class="kv">${kv("Circulating", t.circulating_supply != null ? num(t.circulating_supply) : NM)}${kv("Total supply", t.total_supply != null ? num(t.total_supply) : NM)}
        ${kv("Max supply", t.max_supply != null ? num(t.max_supply) : "∞ / " + NM)}${kv("Abhi locked / non-circulating", t.not_circulating_supply != null ? num(t.not_circulating_supply) + (capS ? ` <small class="muted">(${(t.not_circulating_supply / capS * 100).toFixed(1)}%)</small>` : "") : NM)}
        ${kv("Market cap", usd(c.market_cap))}${kv("FDV", usd(c.fdv))}${kv("Mcap / FDV", c.market_cap && c.fdv ? (c.market_cap / c.fdv).toFixed(2) : NM)}${kv("Volume 24h / mcap", c.market_cap && c.volume_24h != null ? (c.volume_24h / c.market_cap * 100).toFixed(2) + "%" : NM)}</div>${bar}
      <div class="sec-t">Unlocks</div>
      <p><span class="nodata">${esc(rep.unlocks?.status || "data nahi mila")}</span> <span class="muted small">${esc(rep.unlocks?.note || "")}</span></p>
      ${rep.unlocks?.check_url ? `<div class="chips"><a class="chip" href="${esc(safeUrl(rep.unlocks.check_url))}" data-link>DefiLlama unlocks par check karein</a></div>` : ""}
      <div class="sec-t">DeFi data (DefiLlama)</div>
      ${df ? `<div class="kv">${kv("TVL", usd(df.tvl))}${kv("Mcap / TVL", df.mcap_tvl != null ? df.mcap_tvl.toFixed(2) : NM)}${kv("Fees 30d", usd(df.fees_30d))}${kv("Revenue 30d", usd(df.revenue_30d))}</div><p class="muted small">${esc(df.name || "")} · ${esc(df.category || "")} · <a href="${esc(safeUrl(df.url))}" data-link>DefiLlama</a></p>` : `<p>${NM} <span class="muted small">(DefiLlama par yeh coin protocol/chain ke taur par map nahi hua)</span></p>`}
      <div class="sec-t">Listings</div>
      <p>${li.exchanges != null ? `<b>${li.exchanges}</b> exchanges <span class="muted small">(${esc(li.basis)}; asal ginti zyada ho sakti hai)</span>` : NM}</p>
      <div class="chips">${(li.top || []).map((e) => `<span class="chip">${esc(e.name)}<em>${e.trust === "green" ? "✓" : ""}</em></span>`).join("")}</div>
      <p class="muted small" style="margin-top:10px">Report: ${pkt(rep.generated_at)} · sources: ${esc((rep.sources || []).join(", "))}</p>`;
  }
  function tvUrl(c) { const ta = c.ta || {}; if (!ta.pair || ta.src === "coingecko") return null;
    const pair = ta.pair.replace(/[-_]/g, ""); const ex = { binance: "BINANCE", bybit: "BYBIT", okx: "OKX", gate: "GATEIO", mexc: "MEXC" }[ta.src];
    return ex ? `https://www.tradingview.com/chart/?symbol=${ex}:${encodeURIComponent(pair)}` : null; }
  function openSheet(id, updating = false) {
    const c = data && data.coins.find((x) => x.id === id); if (!c) return;
    openId = id; if (!updating) haptic("medium");
    const sc = $("#sheet").scrollTop, ta = c.ta, s = c.signal || {};
    const [ic, cl] = SIG[s.code] || SIG.neutral;
    const tv = tvUrl(c);
    $("#sheetBody").innerHTML = `
      <div class="d-head">${avatar(c, "lg")}<div><div class="d-sym">${esc(c.symbol)} <small class="muted">#${c.rank ?? "—"}</small></div><div class="muted small">${esc(c.name)}${c.kind && c.kind !== "stable" ? " · " + esc({ yield: "tokenized yield", tokenized: "tokenized asset" }[c.kind] || c.kind + " token") : ""}</div></div>
        <div class="d-px"><b class="mono">${price(c.price)}</b><span>${pct(c.change_24h)} 24h</span></div></div>
      <div class="kv k4">${kv("1h", pct(c.change_1h))}${kv("7d", pct(c.change_7d))}${kv("30d", pct(c.change_30d))}${kv("ATH se", pct(c.ath_change_pct, 0))}</div>
      <div class="sigpanel ${cl}"><div class="sp-h"><span class="muted small">PUMP / DUMP SIGNAL</span>${riskChip(c.risk)}</div><div class="sig-big">${ic} ${esc(s.label || "Neutral")}</div><div class="sig-why big">${esc(s.reason || "")}</div></div>
      ${noTA(c) ? `<p class="muted">${c.kind === "yield" ? "Tokenized treasury/credit/yield asset" : "Stablecoin"} hai — trend aur buy/sell zones apply nahi hote.</p>` : ta ? `
      <div class="sec-t">Trend & zones</div>
      <div class="d-chart">${chartSVG(c)}</div>
      <div class="zones">
        <div class="zone zb"><span>🟢 BUY ZONE (support)</span><b>${ta.buy_zone ? price(ta.buy_zone[0]) + " – " + price(ta.buy_zone[1]) : NM}</b><em>${distTxt(ta.buy_dist_pct, "buy")}${ta.support_touches ? ` · ${ta.support_touches} touch` : ""}</em>${ta.support2 ? `<small>Agla support: ${price(ta.support2)}</small>` : ""}</div>
        <div class="zone zs"><span>🔴 SELL ZONE (resistance)</span><b>${ta.sell_zone ? price(ta.sell_zone[0]) + " – " + price(ta.sell_zone[1]) : "ATH ke paas — upar koi level nahi"}</b><em>${ta.sell_zone ? distTxt(ta.sell_dist_pct, "sell") : "price discovery"}${ta.resistance_touches ? ` · ${ta.resistance_touches} touch` : ""}</em>${ta.resistance2 ? `<small>Agla resistance: ${price(ta.resistance2)}</small>` : ""}</div>
      </div>
      <div class="kv">${kv("Trend (1D)", trendChip(ta.trend))}${kv("Trend (4H)", ta.trend_4h ? trendChip(ta.trend_4h) : NM)}
        ${kv("RSI 14 (1D / 4H)", `${ta.rsi != null ? ta.rsi.toFixed(0) : "n/a"} / ${ta.rsi_4h != null ? ta.rsi_4h.toFixed(0) : "n/a"}`)}${kv("ATR (daily)", ta.atr_pct != null ? ta.atr_pct.toFixed(1) + "% · " + price(ta.atr) : NM)}
        ${kv("EMA 20 / 50", price(ta.ema20) + " / " + price(ta.ema50))}${kv("EMA 200", ta.ema200 != null ? price(ta.ema200) : NM + ` <small class="muted">(${ta.candles_1d} candles)</small>`)}
        ${kv("Volume spike", ta.vol_spike != null ? ta.vol_spike.toFixed(2) + "x <small class='muted'>7d avg</small>" : NM)}${kv("180d range", price(ta.low_180d) + " – " + price(ta.high_180d))}</div>
      <p class="muted small">Candles: ${esc(ta.src)} ${esc(ta.pair || "")}${ta.src === "coingecko" ? " (sirf daily closes — 4h data nahi)" : ""} · ${ta.asof ? pkt(ta.asof) : ""}. Zones andaza hain, guarantee nahi — <b>financial advice nahi, DYOR</b>.</p>` : `<p class="muted">Is coin ke candles abhi load nahi hue (rotation chal rahi hai) — zones thori der mein aayenge.</p>`}
      <div class="sec-t">X hype</div>${xSection(c)}
      <div class="sec-t">Risk</div>${riskSection(c.risk)}
      <div id="repBox">${reportHTML(c, reports.get(id))}</div>
      <div class="btns"><a class="btn primary" href="https://x.com/search?q=${encodeURIComponent("$" + c.symbol)}&f=live" data-link>Live on X</a>${tv ? `<a class="btn" href="${esc(tv)}" data-link>Chart</a>` : ""}<a class="btn" href="https://www.coingecko.com/en/coins/${encodeURIComponent(c.id)}" data-link>CoinGecko</a></div>`;
    $("#sheet").classList.add("on"); $("#backdrop").classList.add("on"); $("#sheet").setAttribute("aria-hidden", "false"); $("#sheet").scrollTop = updating ? sc : 0;
    if (inTG) tg.BackButton.show();
    if (history.replaceState) history.replaceState(null, "", "#coin=" + encodeURIComponent(id));
    bindDesc();
    if (!reports.has(id)) {
      fetch(`data/reports/${encodeURIComponent(id)}.json?t=${Math.floor(Date.now() / 600000)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((rep) => { reports.set(id, rep); if (openId === id) { $("#repBox").innerHTML = reportHTML(c, rep); bindDesc(); } });
    }
  }
  function bindDesc() { const b = $("#descMore"); if (b) b.onclick = () => { $("#desc").classList.add("open"); b.remove(); }; }
  function closeSheet() {
    openId = null; $("#sheet").classList.remove("on"); $("#backdrop").classList.remove("on"); $("#sheet").setAttribute("aria-hidden", "true");
    if (inTG) tg.BackButton.hide(); if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]"); if (a) { e.preventDefault(); e.stopPropagation(); if (a.href && !a.href.endsWith("#")) openLink(a.href); return; }
    const r = e.target.closest(".t5row, .bmini"); if (r) openSheet(r.dataset.id);
  });
  $("#backdrop").onclick = closeSheet; $("#sheetClose").onclick = closeSheet;
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeSheet());
  const setKind = (k) => { kind = k; shown = PAGE; document.querySelectorAll("#kindSeg button, #sigBoard .sb").forEach((x) => x.classList.toggle("on", x.dataset.kind === k)); renderList(); };
  $("#kindSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { haptic(); setKind(b.dataset.kind); } };
  $("#sigBoard").onclick = (e) => { const b = e.target.closest(".sb"); if (b) { haptic(); setKind(b.dataset.kind); document.querySelector(".t5controls").scrollIntoView({ behavior: "smooth" }); } };
  $("#sortSel").onchange = (e) => { sortBy = e.target.value; shown = PAGE; renderList(); };
  let qt; $("#q").oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { query = e.target.value; shown = PAGE; renderList(); }, 120); };
  $("#moreBtn").onclick = () => { shown += PAGE; renderList(); };
  $("#reloadBtn").onclick = () => { haptic("medium"); load(true); };

  // ---------- data ----------
  async function livePrices() {
    const ids = data.coins.filter((c) => !noTA(c)).map((c) => c.id);
    const chunks = [ids.slice(0, 250), ids.slice(250)].filter((x) => x.length);
    let ok = false;
    for (const ch of chunks) {
      try {
        const r = await fetch("https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true&ids=" + ch.join(","));
        if (!r.ok) throw new Error(r.status);
        const q = await r.json();
        for (const c of data.coins) { const v = q[c.id]; if (v && N(v.usd)) { c.price = v.usd; if (N(v.usd_24h_change) != null) c.change_24h = v.usd_24h_change; zoneDist(c); } }
        ok = true;
      } catch (e) { /* keep snapshot prices */ }
    }
    priceFail = !ok; if (ok) pricesAt = Date.now();
  }
  function load(manual = false) {
    if (refreshPromise) return refreshPromise;
    nextRefresh = Date.now() + REFRESH_MS; $("#reloadBtn").classList.add("spinning");
    refreshPromise = (async () => {
      try {
        const r = await fetch("data/top500.json?t=" + Date.now()); if (!r.ok) throw new Error(r.status);
        const d = await r.json(); if (!Array.isArray(d.coins)) throw new Error("bad data");
        if (data) { const old = new Map(data.coins.map((c) => [c.id, c])); for (const c of d.coins) { const o = old.get(c.id); if (o && pricesAt && o.price) { c.price = o.price; c.change_24h = o.change_24h; zoneDist(c); } } }
        if (data && d.generated_at !== data.generated_at) reports.clear();
        data = d;
      } catch (e) { if (!data) { $("#list").innerHTML = '<div class="empty">Data load nahi ho saka. Refresh karein.</div>'; return; } }
      render();
      await livePrices(); render();
      document.body.classList.add("has-refreshed");
      if (openId) openSheet(openId, true);
      if (firstLoad) {
        firstLoad = false;
        const h = decodeURIComponent((location.hash.match(/coin=([^&]+)/) || [])[1] || new URLSearchParams(location.search).get("coin") || (inTG && tg.initDataUnsafe?.start_param) || "");
        if (h) { const c = data.coins.find((x) => x.id === h) || data.coins.find((x) => x.symbol.toLowerCase() === h.toLowerCase()); if (c) openSheet(c.id); }
      }
      if (manual) toast(priceFail ? "Data refreshed · live prices busy" : "Live prices refreshed");
    })().finally(() => { refreshPromise = null; $("#reloadBtn").classList.remove("spinning"); updateCountdown(); updatePill(); });
    return refreshPromise;
  }
  document.body.insertAdjacentHTML("beforeend", '<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="ringG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb0f2"/><stop offset="1" stop-color="#3b7ddd"/></linearGradient></defs></svg>');
  load();
  setInterval(() => { updateCountdown(); if (!document.hidden && !refreshPromise && Date.now() >= nextRefresh) load(); }, 1000);
  setInterval(updatePill, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() > nextRefresh - 50000) load(); });

  // ---------- pull-to-refresh ----------
  document.body.insertAdjacentHTML("afterbegin", '<div class="ptr" id="ptr"><div class="ptr-ring"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15"/></svg></div><span class="ptr-txt">Pull to refresh</span></div>');
  const ptr = $("#ptr"), ptrTxt = ptr.querySelector(".ptr-txt"), TH = 80; let y0 = null, dy = 0, busy = false;
  const setPull = (d) => { ptr.style.transform = `translate(-50%, ${Math.min(d, 110) - 70}px)`; ptr.style.opacity = Math.min(d / TH, 1);
    ptr.querySelector("svg").style.transform = `rotate(${d * 4}deg)`; ptr.classList.toggle("armed", d >= TH); ptrTxt.textContent = d >= TH ? "Release to refresh" : "Pull to refresh"; };
  addEventListener("touchstart", (e) => { if (!busy && scrollY <= 0 && !document.querySelector(".sheet.on")) { y0 = e.touches[0].clientY; dy = 0; ptr.classList.remove("snap"); } }, { passive: true });
  addEventListener("touchmove", (e) => { if (y0 == null) return; dy = (e.touches[0].clientY - y0) * 0.5; if (dy > 0) { setPull(dy); if (e.cancelable) e.preventDefault(); } else setPull(0); }, { passive: false });
  addEventListener("touchend", async () => { if (y0 == null) return; y0 = null; ptr.classList.add("snap");
    if (dy >= TH) { busy = true; ptr.classList.add("spin"); ptrTxt.textContent = "Refreshing…"; setPull(TH); haptic("medium"); await load(true); await new Promise((r) => setTimeout(r, 400)); ptr.classList.remove("spin"); busy = false; }
    setPull(0); });
})();
