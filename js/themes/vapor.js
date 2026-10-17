/* ═══════════════════════════════════════════════════════════
   主题 7/8 · 蒸汽波 V A P O R W A V E
   落日网格里的资本幻觉：镀铬K线 / 磁带行情 / 梦境电报
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  MC.Themes.register({
    id: 'vapor',
    name: '蒸汽波',
    en: 'V A P O R W A V E',
    tagline: '落日网格 · 资本是场美丽的幻觉',
    css: 'css/themes/vapor.css',
    accentColor: '#160829',
    audio: 'wave',

    logo: `
      <div class="vpr-logo">
        <div class="vl-kicker">ＭＡＲＧＩＮ ＣＡＬＬ １９８６</div>
        <h1 class="vl-chrome">全仓以赴</h1>
        <div class="vl-sub">ＡＥＳＴＨＥＴＩＣＳ · 虚拟忧伤</div>
        <div class="vl-palms">▲ SIDE A · 15 ROUNDS · PLAY ▶</div>
      </div>`,

    chart: {
      bg(ctx, w, h, now) {
        const t = (now || 0) / 1000;
        // 夜空
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#170829');
        sky.addColorStop(0.55, '#2c1055');
        sky.addColorStop(0.78, '#4d1a75');
        sky.addColorStop(1, '#1d0a3a');
        ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
        // 星星
        ctx.save();
        for (let i = 0; i < 22; i++) {
          const sx = ((i * 137.5) % 100) / 100 * w;
          const sy = ((i * 61.8) % 55) / 100 * h;
          const tw = 0.35 + 0.3 * Math.sin(t * 2 + i * 2.4);
          ctx.globalAlpha = tw;
          ctx.fillStyle = i % 3 === 0 ? '#ff9ce8' : '#bff6ff';
          ctx.fillRect(sx, sy, 1.4, 1.4);
        }
        ctx.restore();
        // 落日（条纹下半）
        const hz = h * 0.78;
        const cx = w * 0.5, cy = hz - 52, R = 44;
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
        const sun = ctx.createLinearGradient(0, cy - R, 0, cy + R);
        sun.addColorStop(0, '#ffde59');
        sun.addColorStop(0.45, '#ff9a56');
        sun.addColorStop(0.8, '#ff6ec7');
        sun.addColorStop(1, '#b44dff');
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = sun;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        // 条纹
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#241047';
        for (let y = cy + 2; y < cy + R; y += 7) ctx.fillRect(cx - R, y, R * 2, 3);
        ctx.restore();
        // 辉光
        ctx.save();
        const glow = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.6);
        glow.addColorStop(0, 'rgba(255,110,199,0.16)');
        glow.addColorStop(1, 'rgba(255,110,199,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        // 透视网格地板（滚动）
        ctx.save();
        ctx.beginPath(); ctx.rect(0, hz, w, h - hz); ctx.clip();
        const off = t % 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,229,255,0.3)';
        for (let i = 0; i <= 7; i++) {
          const p = (i + off) / 8;
          const y = hz + p * p * (h - hz) * 1.15;
          ctx.globalAlpha = Math.min(1, p * 2.4);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,110,199,0.32)';
        ctx.globalAlpha = 1;
        for (let k = -7; k <= 7; k++) {
          ctx.beginPath();
          ctx.moveTo(cx + k * 6, hz);
          ctx.lineTo(cx + k * (w / 5.5), h);
          ctx.stroke();
        }
        // 地平线亮边
        ctx.strokeStyle = 'rgba(255,222,89,0.55)';
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.moveTo(0, hz); ctx.lineTo(w, hz); ctx.stroke();
        ctx.restore();
      },
      grid: { color: 'rgba(255,150,225,0.07)', width: 1, dash: [] },
      axisText: { color: 'rgba(190,246,255,0.6)', font: '600 10px "Chakra Petch",monospace' },
      up: { body: '#00f0ff', wick: '#7df9ff', border: 'rgba(255,255,255,0.35)' },
      down: { body: '#ff2fd6', wick: '#ff8ae6', border: 'rgba(255,255,255,0.28)' },
      // 镀铬渐变蜡烛
      candle(ctx, o) {
        const { x, y, w, h, cx, dir, top, bottom } = o;
        const bh = Math.max(2.5, h);
        ctx.save();
        // 影线
        const wg = ctx.createLinearGradient(0, top, 0, bottom);
        wg.addColorStop(0, dir > 0 ? 'rgba(0,240,255,0.95)' : 'rgba(255,47,214,0.95)');
        wg.addColorStop(1, 'rgba(168,85,247,0.7)');
        ctx.strokeStyle = wg; ctx.lineWidth = Math.max(1.2, w * 0.14); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bottom); ctx.stroke();
        // 实体：落日渐变
        const g = ctx.createLinearGradient(0, y, 0, y + bh);
        if (dir > 0) { g.addColorStop(0, '#b8fbff'); g.addColorStop(0.35, '#00f0ff'); g.addColorStop(1, '#5f3dff'); }
        else { g.addColorStop(0, '#ffc2ee'); g.addColorStop(0.35, '#ff2fd6'); g.addColorStop(1, '#6a21c9'); }
        ctx.shadowColor = dir > 0 ? 'rgba(0,240,255,0.8)' : 'rgba(255,47,214,0.8)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = g;
        rr(ctx, x, y, w, bh, Math.min(3.5, w / 3)); ctx.fill();
        ctx.shadowBlur = 0;
        // 顶部高光线（镀铬反光）
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 1); ctx.lineTo(x + w - 2, y + 1);
        ctx.stroke();
        ctx.restore();
      },
      glow: 0,
      priceTag: { bg: '#00f0ff', fg: '#08131f', radius: 3, font: '700 11px "Chakra Petch",monospace' },
      priceTagDown: { bg: '#ff2fd6', fg: '#1e0419', radius: 3, font: '700 11px "Chakra Petch",monospace' },
      entryLine: 'rgba(255,222,89,0.7)',
      liqLine: 'rgba(255,47,214,0.9)',
      ghostLine: 'rgba(0,240,255,0.75)',
      lastDot: '#ffe9fb',
      roundDivider: 'rgba(255,110,199,0.14)',
      roundLabel: 'rgba(255,150,225,0.4)',
      scanlines: 0.1,
      vignette: ['rgba(0,0,0,0)', 'rgba(12,3,30,0.55)'],
    },

    copy: {
      gameTitle: '全仓以赴',
      startBtn: 'ＰＬＡＹ ▶ 入梦',
      buy: '做多', sell: '做空',
      buffTitle: '今晚的幻觉到货了',
      chargeHint: '长按蓄力 · 松手成交',
      phaseNames: { buff: '选带', act: '行动', resolve: '走带', between: '间奏', end: 'SIDE B' },
      resultKicker: 'ＴＡＰＥ ＥＮＤ · 退带',
      revealKicker: 'Ｂ面素材解密',
      roastTitle: '梦境管理员复盘',
      againBtn: '倒带重来',
      telegram: { agency: 'ＦＥＤＥＲＡＬ 梦境管理局', kicker: '◈ 信号插播 ◈', stamp: '已消磁' },
      /* v5 密度红线：正文 ≤3 行，蒸汽波腔留在全角字与金句 */
      telegramText: {
        sec: t => ({
          title: '异常梦境预警',
          body: `收益曲线连续三轮过于性感（>50%）。\n依《美学管制条例》：下轮消磁 ${Math.round(t.penalty * 100)}%。\n在梦里，低调才是持久的浪漫。`,
        }),
        plug: () => ({
          title: '磁带走速异常',
          body: '杠杆长期 20x+，磁带机开始冒紫烟。\n走速已强制调到 5x。\n画面会变慢，但梦不会碎。',
        }),
        antitrust: t => ({
          title: '梦境均贫富',
          body: `首富「${t.payer}」资产超末位 5 倍，构图失衡。\n抽取 ${MC.fmt.money(t.fine)} 重新布光，分给垫底梦游者。${t.youGot ? `\n你收到补光 ${MC.fmt.money(t.youGot)}。` : ''}\n均衡，才是 ａｅｓｔｈｅｔｉｃ。`,
        }),
        raid: t => ({
          title: '信号强制插播',
          body: `收益跑太快，管理局「恰好」巡检。\n超额 ${MC.fmt.money(t.seized)} 已消磁。${t.heat >= 2 ? `第 ${t.heat} 次立案。` : ''}\nplease stand by.`,
        }),
      },
      /* v5：≤4 句 × ≤18 字 */
      roast(s, res) {
        const L = [];
        L.push(s.finalEq >= (res.start || 10000)
          ? `${res.mult.toFixed(2)} 倍收场，曲线是艺术品。`
          : `本金化作 ${MC.fmt.money(s.finalEq)}，像 1986 的晚霞。`);
        if (s.liqs) L.push(`爆仓 ${s.liqs} 次，每次都像绞带。`);
        else if (s.maxLev >= 50) L.push(`${s.maxLev}x 杠杆，给幻觉加速播放。`);
        else if (s.chase >= 3) L.push(`追涨 ${s.chase} 割肉 ${s.panic}，VHS 追踪失调。`);
        else if (s.holdRounds >= 8) L.push(`${s.holdRounds} 轮不动，你按了暂停键。`);
        L.push('暴富是幻觉，但幻觉很美。倒带见。');
        return L.slice(0, 4).join('');
      },
    },
  });

})(window.MC);
