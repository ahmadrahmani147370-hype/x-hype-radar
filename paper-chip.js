/* Shared paper balance chip — real ledger only (data/paper/trades.json).
   Balance = virtual $1,000 start + realized P&L of closed trades (void excluded) + unrealized P&L of open trades.
   Every trade uses a virtual $100 stake; 0.1% fee per side is included in ledger P&L. */
(function () {
  const START = 1000;
  const N = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
  function calc(ledger, livePx) {
    const tr = (ledger && ledger.trades) || [];
    let realized = 0, unreal = 0, open = 0, closed = 0, have = false;
    for (const t of tr) {
      if (t.void) continue;
      have = true;
      if (t.status === "closed") { closed++; realized += N(t.pnl_usd) || 0; }
      else {
        open++;
        const lp = livePx && livePx(t);
        if (lp > 0 && N(t.entry_price) > 0 && N(t.qty) > 0) {
          const dir = t.side === "SHORT" ? -1 : 1, fee = (t.fee_pct || 0.1) / 100;
          const gross = dir * (lp - t.entry_price) * t.qty;
          unreal += gross - fee * t.entry_price * t.qty - fee * lp * t.qty;
        } else unreal += N(t.mark_pnl_usd) || 0;
      }
    }
    const pnl = realized + unreal;
    return { have, start: START, balance: START + pnl, pnl, pct: (pnl / START) * 100, realized, unreal, open, closed };
  }
  function html(b) {
    if (!b || !b.have) return '<span class="pchip-l">Paper</span><b>$' + START.toLocaleString("en-US") + '</b><i class="flat">abhi koi trade nahi</i>';
    const cls = b.pnl > 0.004 ? "up" : b.pnl < -0.004 ? "down" : "flat";
    return '<span class="pchip-l">Paper</span><b>$' + b.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      '</b><i class="' + cls + '">' + (b.pct >= 0 ? "+" : "") + b.pct.toFixed(2) + "%</i>";
  }
  function title(b) {
    const s = "Virtual paper account: $1,000 start · har signal par $100 · 0.1% fee per side shamil · real money nahi.";
    if (!b || !b.have) return s;
    return s + "\nRealized: $" + b.realized.toFixed(2) + " (" + b.closed + " closed) · Unrealized: $" + b.unreal.toFixed(2) + " (" + b.open + " open)";
  }
  function render(el, ledger, livePx) {
    if (!el) return null; const b = calc(ledger, livePx);
    el.innerHTML = html(b); el.title = title(b); el.setAttribute("aria-label", title(b)); return b;
  }
  async function mount(el) {
    // standalone use (Top 500 page): fetch ledger + Binance prices of open trades every 60 s
    if (!el) return;
    el.addEventListener("click", () => { location.href = "paper.html"; });
    let px = new Map();
    const tick = async () => {
      try {
        const r = await fetch("data/paper/trades.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw 0;
        const led = await r.json();
        const pairs = [...new Set((led.trades || []).filter((t) => t.status !== "closed" && !t.void && t.binance_pair).map((t) => t.binance_pair))];
        if (pairs.length) { try { const q = await fetch("https://data-api.binance.vision/api/v3/ticker/price?symbols=" + encodeURIComponent(JSON.stringify(pairs)), { cache: "no-store" });
          if (q.ok) (await q.json()).forEach((x) => px.set(x.symbol, +x.price)); } catch (e) {} }
        render(el, led, (t) => px.get(t.binance_pair));
      } catch (e) { if (!el.innerHTML) el.innerHTML = '<span class="pchip-l">Paper</span><b>—</b>'; }
    };
    tick(); setInterval(() => { if (!document.hidden) tick(); }, 60000);
  }
  window.PaperChip = { calc, render, mount, START };
})();
