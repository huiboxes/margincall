/* ═══════════════════════════════════════════════════════════
   Canvas K线渲染器（主题化）
   内置 5 种蜡烛画法 + 主题可注入完全自定义 drawCandle
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  const DEFAULT_STYLE = {
    bg: null,                      // (ctx,w,h)=>void 自定义背景
    grid: { color: 'rgba(255,255,255,0.06)', width: 1, dash: [] },
    axisText: { color: 'rgba(255,255,255,0.45)', font: '10px ui-monospace,monospace' },
    up: { body: '#22e58a', wick: '#22e58a', border: null },
    down: { body: '#ff4d6d', wick: '#ff4d6d', border: null },
    candle: 'rect',                // rect | round | block | brush | engraved | fn(ctx,o)
    hollow: false,                 // 涨为空心（老式美式画法）
    glow: 0,                       // shadowBlur px
    glowColor: null,
    priceTag: { bg: '#22e58a', fg: '#04110a', radius: 3, font: '600 11px ui-monospace,monospace' },
    priceTagDown: null,            // 缺省用 priceTag
    entryLine: 'rgba(120,170,255,0.7)',
    liqLine: 'rgba(255,60,90,0.85)',
    slLine: 'rgba(255,159,67,0.8)',      // 止损线
    tpLine: 'rgba(34,229,138,0.65)',     // 止盈线
    ghostLine: 'rgba(190,140,255,0.75)',
    lastDot: '#fff',
    roundDivider: 'rgba(255,255,255,0.10)',
    roundLabel: 'rgba(255,255,255,0.35)',
    scanlines: 0,                  // 0-1 强度
    vignette: null,                // rgba 数组 [内,外]
    padRight: 62, padTop: 14, padBottom: 18,
  };

  function makeChart(canvas) {
    const ctx = canvas.getContext('2d');
    let style = Object.assign({}, DEFAULT_STYLE);
    let data = null;         // {prices, revealedTick, roundBounds}
    let pos = null;          // {entry, liq, dir}
    let ghost = null;        // {from, ticks}
    let candles = [];
    let revealAnim = new Map(); // candleIdx -> t0
    let dpr = 1, W = 0, H = 0;
    let running = false;
    let lastLen = 0;
    const ro = window.ResizeObserver ? new ResizeObserver(() => { if (running) resize(); }) : null;

    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      const ndpr = Math.min(window.devicePixelRatio || 1, 2.5);
      // 容器尺寸没变就别动（ResizeObserver 会对自身写回触发）
      if (ndpr === dpr && Math.abs(r.width - W) < 0.5 && Math.abs(r.height - H) < 0.5 && canvas.width) return;
      dpr = ndpr;
      W = Math.max(10, r.width); H = Math.max(10, r.height);
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function buildCandles() {
      candles = [];
      if (!data) return;
      const { prices, roundBounds } = data;
      const spans = [{ start: 0, end: roundBounds[1].start, round: 0 }];
      for (let r = 1; r < roundBounds.length; r++) spans.push({ start: roundBounds[r].start, end: roundBounds[r].end, round: r });
      for (const sp of spans) {
        for (let t = sp.start; t < sp.end; t += 2) {
          const e = Math.min(t + 2, sp.end);
          // 相邻蜡烛共享边界 tick（前收 = 后开），轮内与轮间才无缝连贯；
          // 与 market.toCandles 的口径一致（每轮收盘 tick 必须画进本轮最后一根）
          candles.push({ from: t, to: e, round: sp.round, isNewRound: t === sp.start && sp.round > 0 });
        }
      }
    }

    function candleOHLC(c, upto) {
      const { prices } = data;
      const to = Math.min(c.to, upto);
      if (to < c.from) return null;
      let h = -Infinity, l = Infinity;
      const o = prices[c.from], cl = prices[to];
      for (let i = c.from; i <= to; i++) { if (prices[i] > h) h = prices[i]; if (prices[i] < l) l = prices[i]; }
      return { o, c: cl, h, l, partial: to < c.to };
    }

    function visibleCandles() {
      if (!data) return [];
      const rev = data.revealedTick;
      const out = [];
      for (let i = 0; i < candles.length; i++) {
        if (candles[i].from > rev) break;
        out.push({ idx: i, cd: candles[i], ohlc: candleOHLC(candles[i], rev) });
      }
      return out;
    }

    function render(now) {
      if (!running) return;
      requestAnimationFrame(render);
      if (!data) return;
      // 离开对局页（结算/标题）时 #market 不可见、canvas 被压到 10px：跳过绘制（省电 + 主题背景不吃退化尺寸）
      if (canvas.offsetParent === null || W < 40 || H < 40) return;
      ctx.clearRect(0, 0, W, H);
      if (style.bg) { style.bg(ctx, W, H, now); }

      const vis = visibleCandles();
      if (vis.length < 2) return;
      const maxN = Math.max(14, Math.floor((W - style.padRight) / 12));
      const win = vis.slice(-maxN);
      // 槽位宽度恒定：历史从左向右生长，满了才滚动
      const slotW = (W - style.padRight) / maxN;
      const leftAlign = win.length < maxN;

      // 价格范围（含 ghost / 开仓价；强平价只在贴近现价时参与，否则 1x 的强平价≈0 会把全图压成一条）
      const lastP0 = data.prices[data.revealedTick];
      let lo = Infinity, hi = -Infinity;
      for (const v of win) { if (v.ohlc.l < lo) lo = v.ohlc.l; if (v.ohlc.h > hi) hi = v.ohlc.h; }
      if (pos) {
        lo = Math.min(lo, pos.entry); hi = Math.max(hi, pos.entry);
        /* 风控线只在「贴近行情」时参与纵轴：阈值 = 可见K线振幅的 1.5 倍（6%–35%）。
           旧版固定 35%：3–5x 的强平线（距现价 20–33%）会把K线压成顶部一条细带；超出的线改为贴边标注 */
        const near = Math.min(0.35, Math.max(0.06, (hi - lo) / lastP0 * 1.5));
        for (const lv of [pos.liq, pos.sl, pos.tp]) {
          if (lv != null && Math.abs(lv - lastP0) / lastP0 < near) { lo = Math.min(lo, lv); hi = Math.max(hi, lv); }
        }
      }
      if (ghost) { for (const g of ghost.ticks) { lo = Math.min(lo, g); hi = Math.max(hi, g); } }
      // 初期垂直防拉爆：振幅太小不许把几根蜡烛拉成满屏"针柱"（最小振幅 = 中价 6%）
      const mid0 = (hi + lo) / 2 || 1;
      const minSpan = mid0 * 0.06;
      if (hi - lo < minSpan) { const c0 = (hi + lo) / 2; lo = c0 - minSpan / 2; hi = c0 + minSpan / 2; }
      const pad = (hi - lo) * 0.10 || hi * 0.02 || 1;
      lo -= pad; hi += pad;
      if (lo < 0) lo = 0;   // 价格恒正：深跌行情下留白别把坐标轴压成负数/科学计数

      const plotW = W - style.padRight, plotH = H - style.padTop - style.padBottom;
      const X = i => leftAlign ? (i + 0.5) * slotW : (i + 0.5) * (plotW / win.length);
      const Y = p => style.padTop + (1 - (p - lo) / (hi - lo)) * plotH;
      const cw = Math.max(3, slotW * 0.62);

      // 网格
      ctx.save();
      ctx.strokeStyle = style.grid.color;
      ctx.lineWidth = style.grid.width;
      if (style.grid.dash && style.grid.dash.length) ctx.setLineDash(style.grid.dash);
      const nGrid = 4;
      ctx.font = style.axisText.font;
      ctx.fillStyle = style.axisText.color;
      ctx.textAlign = 'left';
      for (let g = 0; g <= nGrid; g++) {
        const y = style.padTop + plotH * g / nGrid;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        const pv = hi - (hi - lo) * g / nGrid;
        ctx.fillText(MC.Market.fmtPrice(pv), plotW + 6, y + 3);
      }
      ctx.restore();

      // 轮分隔线（槽宽随对齐模式取实际值，否则前半局分隔线会漂离轮边界）
      ctx.save();
      ctx.strokeStyle = style.roundDivider;
      ctx.fillStyle = style.roundLabel;
      ctx.font = '9px ui-monospace,monospace';
      ctx.textAlign = 'center';
      const sw = leftAlign ? slotW : plotW / win.length;
      win.forEach((v, i) => {
        if (v.cd.isNewRound) {
          const x = X(i) - sw / 2;
          ctx.beginPath(); ctx.moveTo(x, style.padTop); ctx.lineTo(x, style.padTop + plotH); ctx.stroke();
          ctx.fillText('R' + v.cd.round, X(i), H - 5);
        }
      });
      ctx.restore();

      // 入场价 / 强平价线
      if (pos) {
        let pinDn = 0;
        const dashLine = (pv, color, label) => {
          if (pv == null) return;
          if (pv < lo || pv > hi) {   // 出界：统一贴右下角标注方向与距离（左上仓位卡、右上情报卡都会遮），依次错开不叠字
            const below = pv < lo;
            const k = pinDn++;
            ctx.save();
            ctx.font = '9px ui-monospace,monospace';
            ctx.fillStyle = color; ctx.textAlign = 'right';
            ctx.fillText(`${below ? '↓' : '↑'} ${label} (${((pv / lastP0 - 1) * 100).toFixed(1)}%)`, plotW - 4, style.padTop + plotH - 4 - k * 11);
            ctx.restore();
            return;
          }
          const y = Y(pv);
          ctx.save();
          ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '9px ui-monospace,monospace';
          ctx.fillStyle = color; ctx.textAlign = 'left';
          ctx.fillText(label, 4, y - 4);
          ctx.restore();
        };
        dashLine(pos.entry, style.entryLine, '开仓 ' + MC.Market.fmtPrice(pos.entry));
        dashLine(pos.liq, style.liqLine, '☠ 强平 ' + MC.Market.fmtPrice(pos.liq));
        // 标签是实参、会先求值：sl/tp 可能为 null，必须判空后再拼字符串
        if (pos.sl != null) dashLine(pos.sl, style.slLine, '止损 ' + MC.Market.fmtPrice(pos.sl));
        if (pos.tp != null) dashLine(pos.tp, style.tpLine, '止盈 ' + MC.Market.fmtPrice(pos.tp));
      }

      // 幽灵线（先知一闪）
      if (ghost && ghost.ticks.length) {
        ctx.save();
        ctx.strokeStyle = style.ghostLine;
        ctx.lineWidth = 2; ctx.setLineDash([2, 5]);
        ctx.lineCap = 'round';
        const lastI = win.length - 1;
        const perCandle = (leftAlign ? slotW : plotW / win.length) / 2;
        ctx.beginPath();
        ctx.moveTo(X(lastI), Y(data.prices[data.revealedTick]));
        ghost.ticks.forEach((g, k) => {
          ctx.lineTo(X(lastI) + (k + 1) * perCandle, Y(g));
        });
        ctx.stroke();
        ctx.restore();
      }

      // 蜡烛
      for (let i = 0; i < win.length; i++) {
        const v = win[i];
        const o = v.ohlc;
        const x = X(i), dir = o.c >= o.o ? 1 : -1;
        const col = dir > 0 ? style.up : style.down;
        const bodyTop = Y(Math.max(o.o, o.c)), bodyBot = Y(Math.min(o.o, o.c));
        const bh = Math.max(1.5, bodyBot - bodyTop);

        // 揭示生长动画
        let grow = 1;
        if (revealAnim.has(v.idx)) {
          const t = (now - revealAnim.get(v.idx)) / 260;
          if (t >= 1) revealAnim.delete(v.idx);
          else grow = MC.ease.outBack(Math.max(0, t));
        }
        const cy = (bodyTop + bh / 2);
        ctx.save();
        if (grow < 1) { ctx.translate(0, cy * (1 - grow)); ctx.scale(1, grow); }
        if (style.glow) {
          ctx.shadowColor = style.glowColor || col.body;
          ctx.shadowBlur = style.glow;
        }
        const rect = { x: x - cw / 2, y: bodyTop, w: cw, h: bh, cx: x, dir, col, style, top: Y(o.h), bottom: Y(o.l), price: o.c };
        if (typeof style.candle === 'function') style.candle(ctx, rect, now);
        else drawBuiltIn(ctx, rect);
        ctx.restore();
      }

      // 最后价格 tag + 脉冲点
      const lastP = data.prices[data.revealedTick];
      const lx = X(win.length - 1), ly = Y(lastP);
      const prevP = data.prices[Math.max(0, data.revealedTick - 1)];
      const dirUp = lastP >= prevP;
      ctx.save();
      const pulse = 1 + Math.sin(now / 180) * 0.35;
      ctx.fillStyle = style.lastDot;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(lx, ly, 2.6 * pulse, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(lx, ly, 6 * pulse, 0, 7); ctx.fill();
      ctx.restore();

      const tag = dirUp ? style.priceTag : (style.priceTagDown || style.priceTag);
      const txt = MC.Market.fmtPrice(lastP);
      ctx.save();
      ctx.font = tag.font;
      const tw = ctx.measureText(txt).width + 12;
      // 前半局蜡烛还在左半边生长：价签贴着最后一根走，不许飘在右缘当"孤儿"
      const tx = leftAlign
        ? MC.clamp(lx + 9, 2, W - tw - 2)
        : Math.min(plotW + 2, W - tw - 2);
      const ty = MC.clamp(ly - 8, 2, H - 18);
      ctx.fillStyle = tag.bg;
      if (tag.radius > 0) roundRect(ctx, tx, ty, tw, 16, tag.radius); else ctx.fillRect(tx, ty, tw, 16);
      ctx.fill();
      ctx.fillStyle = tag.fg;
      ctx.textAlign = 'center';
      ctx.fillText(txt, tx + tw / 2, ty + 11.5);
      ctx.restore();

      // 扫描线
      if (style.scanlines > 0) {
        ctx.save();
        ctx.globalAlpha = style.scanlines;
        ctx.fillStyle = '#000';
        for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
        ctx.restore();
      }
      // 暗角
      if (style.vignette) {
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, style.vignette[0]); g.addColorStop(1, style.vignette[1]);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
    }

    function drawBuiltIn(ctx, r) {
      const { x, y, w, h, cx, dir, col, style: st, top, bottom } = r;
      switch (st.candle) {
        case 'round':
          ctx.strokeStyle = col.wick; ctx.lineWidth = Math.max(1.2, w * 0.16); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bottom); ctx.stroke();
          ctx.fillStyle = col.body;
          roundRect(ctx, x, y, w, h, Math.min(w / 2.6, h / 2.6)); ctx.fill();
          if (col.border) { ctx.strokeStyle = col.border; ctx.lineWidth = 1.5; ctx.stroke(); }
          break;
        case 'block': { // CRT 字符块感
          ctx.fillStyle = col.wick;
          const bw = Math.max(1, Math.round(w * 0.34));
          ctx.fillRect(Math.round(cx - bw / 2), Math.round(top), bw, Math.round(bottom - top));
          ctx.fillStyle = col.body;
          ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.max(2, Math.round(h)));
          break;
        }
        case 'brush': { // 水墨毛笔：不规则边缘
          ctx.strokeStyle = col.wick; ctx.lineCap = 'round';
          ctx.lineWidth = Math.max(1, w * 0.22);
          ctx.globalAlpha = 0.75;
          ctx.beginPath(); ctx.moveTo(cx + (hash(cx) - 0.5) * 1.2, top); ctx.lineTo(cx + (hash(bottom) - 0.5) * 1.2, bottom); ctx.stroke();
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = col.body;
          const steps = 5;
          ctx.beginPath();
          for (let s = 0; s <= steps; s++) { // 左缘
            const yy = y + h * s / steps;
            ctx.lineTo(x + (hash(yy * 3.1) - 0.5) * w * 0.35, yy);
          }
          for (let s = steps; s >= 0; s--) { // 右缘
            const yy = y + h * s / steps;
            ctx.lineTo(x + w + (hash(yy * 7.7) - 0.5) * w * 0.35, yy);
          }
          ctx.closePath(); ctx.fill();
          // 墨晕
          ctx.globalAlpha = 0.14;
          ctx.beginPath(); ctx.ellipse(cx, y + h / 2, w * 0.9, h / 2 + w * 0.5, 0, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
          break;
        }
        case 'engraved': { // 雕版细线
          ctx.strokeStyle = col.wick; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bottom); ctx.stroke();
          ctx.lineWidth = 1.2;
          if (dir > 0 && st.hollow) {
            ctx.strokeStyle = col.body;
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, Math.max(1, h - 1));
            // 斜线填充
            ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
            ctx.lineWidth = 0.6; ctx.globalAlpha = 0.5;
            for (let d = -h; d < w; d += 3) { ctx.beginPath(); ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); ctx.stroke(); }
            ctx.restore(); ctx.globalAlpha = 1;
          } else {
            ctx.fillStyle = col.body;
            ctx.fillRect(x, y, w, Math.max(1, h));
          }
          break;
        }
        case 'rect':
        default:
          ctx.strokeStyle = col.wick; ctx.lineWidth = Math.max(1, w * 0.14);
          ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bottom); ctx.stroke();
          ctx.fillStyle = col.body;
          if (dir > 0 && st.hollow) {
            ctx.strokeStyle = col.body; ctx.lineWidth = 1.4;
            ctx.strokeRect(x + 0.7, y + 0.7, w - 1.4, Math.max(1, h - 1.4));
          } else {
            ctx.fillRect(x, y, w, Math.max(1.5, h));
            if (col.border) { ctx.strokeStyle = col.border; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, Math.max(1.5, h)); }
          }
          break;
      }
    }

    function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
    function roundRect(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    const api = {
      resize, roundRect,
      setStyle(s) { style = Object.assign({}, DEFAULT_STYLE, s || {}); },
      getStyle() { return style; },
      setData(d) {
        const changed = !data || d.prices !== data.prices;
        data = d;
        if (changed) { revealAnim.clear(); lastLen = 0; }   // 新一局：重置揭示动画状态
        if (changed || candles.length === 0) buildCandles();
        api.markReveal();
      },
      setRevealed(i) { if (data) { data.revealedTick = i; api.markReveal(); } },
      markReveal() {
        if (!data) return;
        const now = performance.now();
        for (const c of candles) {
          if (c.from <= data.revealedTick && c.from > data.revealedTick - 4 && !revealAnim.has(candles.indexOf(c))) {
            if (candles.indexOf(c) >= lastLen) revealAnim.set(candles.indexOf(c), now);
          }
        }
        const rev = visibleCandles().length;
        lastLen = Math.max(lastLen, rev - 1);
        if (rev > lastLen) lastLen = rev;
      },
      setPos(p) { pos = p; },
      setGhost(g) { ghost = g; },
      start() {
        if (!running) {
          running = true; resize(); requestAnimationFrame(render);
          // 容器尺寸随布局变化（状态芯片/情报条出现消失会改 1fr 行高）：
          // 不跟的话 canvas 会停留在旧尺寸，画出来的 K 线被裁成一截"不连贯"的残影
          if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
        }
      },
      stop() { running = false; if (ro) ro.disconnect(); },
      get running() { return running; },
      get ctx() { return ctx; },
      get size() { return { W, H }; },
      _internal: { candles: () => candles, vis: visibleCandles },
    };
    window.addEventListener('resize', () => { if (running) resize(); });
    return api;
  }

  /* ── 结算页权益曲线（主题化） ───────────────────────── */
  function drawEquityCurve(canvas, curve, style, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = canvas.parentElement.getBoundingClientRect();
    const W = r.width, H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (style.bg) style.bg(ctx, W, H, 0);

    const pts = curve;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p.eq); hi = Math.max(hi, p.eq); }
    lo = Math.min(lo, opts.start || lo) * 0.92; hi = hi * 1.06;
    const padL = 8, padR = 44, padT = 12, padB = 18;
    const X = i => padL + (W - padL - padR) * i / (pts.length - 1 || 1);
    const Y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

    // 起始资金基准线
    if (opts.start) {
      ctx.save();
      ctx.strokeStyle = style.grid.color; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, Y(opts.start)); ctx.lineTo(W - padR, Y(opts.start)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = style.axisText.color; ctx.font = style.axisText.font; ctx.textAlign = 'left';
      ctx.fillText('本金', W - padR + 5, Y(opts.start) + 3);
      ctx.restore();
    }

    // 面积渐变
    const up = style.up.body, down = style.down.body;
    const last = pts[pts.length - 1].eq;
    const main = last >= (opts.start || 0) ? up : down;
    ctx.save();
    const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
    grad.addColorStop(0, hexA(main, 0.30));
    grad.addColorStop(1, hexA(main, 0.0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(X(0), H - padB);
    pts.forEach((p, i) => ctx.lineTo(X(i), Y(p.eq)));
    ctx.lineTo(X(pts.length - 1), H - padB);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // 曲线
    ctx.save();
    if (style.glow) { ctx.shadowColor = main; ctx.shadowBlur = style.glow; }
    ctx.strokeStyle = main; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p.eq)) : ctx.moveTo(X(i), Y(p.eq)));
    ctx.stroke();
    ctx.restore();

    // 高光标注
    for (const m of opts.markers || []) {
      let i = pts.findIndex(p => p.round === m.round);
      if (i < 0) i = pts.findIndex(p => Math.abs(p.round - m.round) < 0.6);
      if (i < 0) continue;
      const x = X(i), y = Y(pts[i].eq);
      const nearRight = x > W - padR - 46;
      ctx.save();
      ctx.font = '14px sans-serif'; ctx.textAlign = nearRight ? 'right' : 'center';
      ctx.fillText(m.icon, nearRight ? x - 8 : x, y - 12);
      if (m.label) {
        ctx.font = style.axisText.font; ctx.fillStyle = style.axisText.color;
        ctx.fillText(m.label, nearRight ? x - 8 : x, y - 26);
      }
      ctx.restore();
    }

    // 终点数字
    ctx.save();
    ctx.font = '700 13px ' + (style.axisText.font.split(' ').slice(1).join(' ') || 'sans-serif');
    ctx.fillStyle = main; ctx.textAlign = 'left';
    ctx.fillText(MC.fmt.money(last), W - padR + 4, Y(last) + 4);
    ctx.restore();
  }

  function hexA(hex, a) {
    if (hex.startsWith('rgba')) return hex.replace(/[\d.]+\)$/, a + ')');
    const m = hex.replace('#', '');
    const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    const n = parseInt(full, 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  /* ── 标题页迷你吸引图 ───────────────────────────────── */
  function miniChart(canvas, style, seed) {
    const chart = makeChart(canvas);
    chart.setStyle(style);
    const rnd = MC.rng(seed);
    const prices = [100];
    let drift = 0;
    for (let i = 0; i < 90; i++) {
      drift = drift * 0.92 + (rnd() - 0.48) * 0.012;
      prices.push(prices[prices.length - 1] * (1 + drift));
    }
    const roundBounds = [{ start: 0, end: 0 }];
    for (let r = 1; r <= 9; r++) roundBounds.push({ start: (r - 1) * 10, end: r * 10 });
    let rev = 20;
    chart.setData({ prices, revealedTick: rev, roundBounds });
    chart.start();
    const timer = setInterval(() => {
      rev = rev >= 89 ? 20 : rev + 1;
      chart.setRevealed(rev);
    }, 240);
    return { chart, stop() { clearInterval(timer); chart.stop(); } };
  }

  MC.Chart = { makeChart, drawEquityCurve, miniChart, hexA, DEFAULT_STYLE };

})(window.MC);
