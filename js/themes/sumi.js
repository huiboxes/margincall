/* ═══════════════════════════════════════════════════════════
   主题 2/5 · 水墨长卷 SUMI SCROLL
   宣纸长卷上的交易：远山淡墨 / 朱砂红涨 / 黛青绿跌 / 毛笔K线
   A股祖传规矩：红为涨，绿为跌
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  /* ── 确定性伪随机（山形每次一致，不闪） ─────────────── */
  function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }

  /* ── 宣纸底 + 远山淡墨剪影（离屏缓存，按尺寸复用） ──── */
  const bgCache = new Map();
  function paperBg(ctx, w, h) {
    w = Math.round(w); h = Math.round(h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const key = w + 'x' + h + 'x' + dpr;
    let cv = bgCache.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = Math.max(2, w * dpr); cv.height = Math.max(2, h * dpr);
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 纸底
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f2ead6');
      g.addColorStop(0.7, '#eee4ca');
      g.addColorStop(1, '#e8dcbe');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // 上方留白晕光
      const halo = c.createRadialGradient(w * 0.5, -h * 0.1, h * 0.1, w * 0.5, -h * 0.1, h * 0.75);
      halo.addColorStop(0, 'rgba(255,252,240,0.55)');
      halo.addColorStop(1, 'rgba(255,252,240,0)');
      c.fillStyle = halo; c.fillRect(0, 0, w, h);

      // 朱砂落日（淡淡一轮，盖在远山前）
      c.save();
      c.globalAlpha = 0.16; c.fillStyle = '#b0453a';
      c.beginPath(); c.arc(w - 44, 30, 15, 0, 7); c.fill();
      c.globalAlpha = 0.4;
      c.beginPath(); c.arc(w - 44, 30, 8.5, 0, 7); c.fill();
      c.restore();

      // 远山三层：越近越浓
      ridge(c, w, h, h * 0.52, h * 0.16, 'rgba(74,62,46,0.10)', 'rgba(74,62,46,0.03)', 11);
      mist(c, w, h, h * 0.58);
      ridge(c, w, h, h * 0.66, h * 0.14, 'rgba(64,54,40,0.14)', 'rgba(64,54,40,0.04)', 29);
      mist(c, w, h, h * 0.72);
      ridge(c, w, h, h * 0.82, h * 0.10, 'rgba(52,44,32,0.17)', 'rgba(52,44,32,0.05)', 53);

      bgCache.set(key, cv);
      if (bgCache.size > 10) bgCache.delete(bgCache.keys().next().value);
    }
    ctx.drawImage(cv, 0, 0, w, h);
  }
  function ridge(c, w, h, base, amp, colTop, colBot, seed) {
    const grad = c.createLinearGradient(0, base - amp, 0, h);
    grad.addColorStop(0, colTop);
    grad.addColorStop(1, colBot);
    c.save();
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(0, h);
    c.lineTo(0, base);
    const seg = Math.max(4, Math.round(w / 46));
    for (let i = 0; i <= seg; i++) {
      const x = w * i / seg;
      const peak = Math.abs(Math.sin(i * 1.31 + seed)) * amp + hash(i * 3.7 + seed) * amp * 0.55;
      const y = base - peak;
      if (i === 0) c.lineTo(x, y);
      else c.quadraticCurveTo(w * (i - 0.5) / seg, y - amp * 0.16, x, y);
    }
    c.lineTo(w, h);
    c.closePath();
    c.fill();
    c.restore();
  }
  function mist(c, w, h, y) {
    const m = c.createLinearGradient(0, y - 7, 0, y + 15);
    m.addColorStop(0, 'rgba(240,232,211,0)');
    m.addColorStop(0.5, 'rgba(240,232,211,0.5)');
    m.addColorStop(1, 'rgba(240,232,211,0)');
    c.save();
    c.fillStyle = m;
    c.fillRect(0, y - 7, w, 22);
    c.restore();
  }

  /* ── 毛笔K线：笔锋浓淡 / 飞白 / 墨晕 ────────────────── */
  function brushCandle(ctx, o) {
    const { x, y, w, h, cx, col, top, bottom } = o;
    const seed = Math.round(cx * 13.7 + top * 7.3 + bottom * 3.1);

    // 墨晕（渗纸）
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.ellipse(cx, y + h / 2, w * 0.92, h / 2 + w * 0.5, 0, 0, 7);
    ctx.fill();
    ctx.restore();

    // 影线 = 悬针：上收锋、下顿笔，微带欹侧
    ctx.save();
    ctx.strokeStyle = col.wick;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = Math.max(0.9, w * 0.13);
    ctx.beginPath();
    ctx.moveTo(cx + (hash(seed) - 0.5) * 1.1, top);
    ctx.lineTo(cx + (hash(seed + 3) - 0.5) * 1.5, y + 0.5);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.1, w * 0.19);
    ctx.beginPath();
    ctx.moveTo(cx + (hash(seed + 5) - 0.5) * 1.3, y + h - 0.5);
    ctx.lineTo(cx + (hash(seed + 9) - 0.5) * 1.6, bottom);
    ctx.stroke();
    ctx.restore();

    // 实体 = 一笔浓墨：左右缘不规则
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = col.body;
    const steps = 6;
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const yy = y + h * s / steps;
      ctx.lineTo(x + (hash(yy * 3.1 + seed) - 0.5) * w * 0.3, yy);
    }
    for (let s = steps; s >= 0; s--) {
      const yy = y + h * s / steps;
      ctx.lineTo(x + w + (hash(yy * 7.7 + seed) - 0.5) * w * 0.3, yy);
    }
    ctx.closePath();
    ctx.fill();

    // 飞白：笔速快了纸吃不满墨，露出几丝白
    if (h > 7) {
      ctx.fillStyle = 'rgba(240,232,211,0.55)';
      for (let s = 0; s < 3; s++) {
        const yy = y + h * (0.24 + s * 0.26) + (hash(seed + s * 17) - 0.5) * h * 0.1;
        ctx.globalAlpha = 0.14 + hash(seed + s * 5) * 0.16;
        ctx.fillRect(x - 0.5, yy, w + 1, Math.max(0.6, hash(seed + s * 9) * 1.3));
      }
    }
    ctx.restore();
  }

  /* ── 注册 ───────────────────────────────────────────── */
  MC.Themes.register({
    id: 'sumi',
    name: '水墨长卷',
    en: 'SUMI SCROLL',
    tagline: '宣纸为盘 · 墨作K线 · 红涨绿跌祖传规矩',
    css: 'css/themes/sumi.css',
    accentColor: '#e9dfc2',
    audio: 'guqin',

    logo: `
      <div class="sumi-logo">
        <div class="sl-colophon">丙午年制 · 非投资建议</div>
        <div class="sl-main">
          <h1 class="sl-title"><span>全</span><span>仓</span><span>以</span><span>赴</span></h1>
          <div class="sl-seal"><i>全</i><i>仓</i></div>
        </div>
        <div class="sl-sub"><i class="sl-line"></i><span>MARGIN&nbsp;CALL · 水墨长卷</span><i class="sl-line"></i></div>
      </div>`,

    chart: {
      bg(ctx, w, h) { paperBg(ctx, w, h); },
      grid: { color: 'rgba(90,72,46,0.14)', width: 1, dash: [3, 4] },
      axisText: { color: 'rgba(70,56,38,0.62)', font: '600 10px "Noto Serif SC",serif' },
      up: { body: '#b0402e', wick: '#7e2f22' },     // 朱砂 · 涨（祖传规矩）
      down: { body: '#31594c', wick: '#24453a' },   // 黛青 · 跌
      candle: brushCandle,
      hollow: false,
      glow: 0,
      priceTag: { bg: '#b0402e', fg: '#f5efdf', radius: 2, font: '700 11px "Noto Serif SC",serif' },
      priceTagDown: { bg: '#31594c', fg: '#eef2ea', radius: 2, font: '700 11px "Noto Serif SC",serif' },
      entryLine: 'rgba(58,86,120,0.8)',
      liqLine: 'rgba(160,45,32,0.9)',
      ghostLine: 'rgba(107,74,138,0.8)',
      lastDot: '#2a241a',
      roundDivider: 'rgba(90,72,46,0.18)',
      roundLabel: 'rgba(70,56,38,0.5)',
      scanlines: 0,
      vignette: ['rgba(0,0,0,0)', 'rgba(120,92,50,0.16)'],
    },

    copy: {
      gameTitle: '全仓以赴',
      startBtn: '开 卷',
      buy: '买涨', sell: '买跌',
      closeAll: '平仓落袋', hold: '按兵不动',
      chargeHint: '长按蓄墨 · 松手落笔',
      buffTitle: '摇签问计',
      phaseNames: { buff: '择签', act: '落笔', resolve: '行市', between: '结算', end: '终卷' },
      resultKicker: '长卷至此 · 尽数平仓',
      revealKicker: '史海钩沉',
      roastTitle: '卷末判词',
      againBtn: '再展一卷',
      telegram: { agency: '钦差 · 市监司', kicker: '八百里加急', stamp: '拿 下' },
      /* v5 密度红线：正文 ≤3 行，公文腔留在标题与句尾 */
      telegramText: {
        sec: t => ({
          title: '市监司 关注函',
          body: `查：尔连轮暴富，市井侧目。\n依《盘口律》罚没下轮收益 ${Math.round(t.penalty * 100)}%。\n收敛锋芒，闷声发财。钦此。`,
        }),
        plug: () => ({
          title: '交易所 拔网线',
          body: `尔杠杆久逾二十倍，机房偶感风寒。\n子时拔线修缮，仓位强降至五倍。\n技之缘由，毋庸深究。`,
        }),
        antitrust: t => ({
          title: '均贫富 反垄断',
          body: `首富「${t.payer}」家资逾末位五倍。\n罚没 ${MC.fmt.money(t.fine)}，均分垫底诸君。${t.youGot ? `\n尔获 ${MC.fmt.money(t.youGot)}，还不谢恩。` : ''}`,
        }),
        raid: t => ({
          title: '钦差 突击查账',
          body: `尔暴利惊动衙门，钦差登门。\n超额 ${MC.fmt.money(t.seized)} 当场没收。${t.heat >= 2 ? `已第 ${t.heat} 次入册。` : ''}\n再犯者，查得更勤。`,
        }),
      },
      /* v5：≤4 句 × ≤18 字，判词腔在收尾金句 */
      roast(s, res) {
        const L = [];
        const m = res.mult;
        L.push(m >= 1.5 ? `${m.toFixed(2)} 倍收卷，可入列传。`
          : m >= 1 ? `${m.toFixed(2)} 倍保本，活着出卷。`
            : `收笔 ${MC.fmt.money(s.finalEq)}，这幅写崩了。`);
        if (s.liqs) L.push(`爆仓 ${s.liqs} 次，锣鼓敲哑。`);
        if (s.maxLev >= 50) L.push(`${s.maxLev} 倍行笔，以命作书。`);
        if (s.accuracy >= 0.7 && s.correctDirs + s.wrongDirs >= 5) L.push(`命中十之${(s.accuracy * 10).toFixed(0)}，师承鬼谷？`);
        else if (s.chase >= 3) L.push(`追高 ${s.chase} 割肉 ${s.panic}，韭菜之气。`);
        L.push('市场无新鲜事，下一卷请。');
        return L.slice(0, 4);
      },
    },
  });

})(window.MC);
