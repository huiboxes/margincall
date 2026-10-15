/* ═══════════════════════════════════════════════════════════
   主题 8/8 · 塔罗秘仪 ARCANA NOCTURNE
   星盘推演的行情：黄道环 / 鎏金雕版K线 / 神谕电报 / 占卜师复盘
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  const ZODIAC = '♈♉♊♋♌♍♎♏♐♑♒♓';

  MC.Themes.register({
    id: 'tarot',
    name: '塔罗秘仪',
    en: 'ARCANA NOCTURNE',
    tagline: '星辰低语 · 每根K线都是命运',
    css: 'css/themes/tarot.css',
    accentColor: '#0c0920',
    audio: 'harp',

    logo: `
      <div class="trt-logo">
        <div class="tl-arc">✦ ☾ ✦</div>
        <h1 class="tl-main">全仓以赴</h1>
        <div class="tl-divider"><i></i><span>ARCANA NOCTURNE</span><i></i></div>
        <div class="tl-sub">今夜牌阵 · 十五轮 · 星星已经排好</div>
      </div>`,

    chart: {
      bg(ctx, w, h, now) {
        const t = (now || 0) / 1000;
        // 深夜靛蓝
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#131033');
        sky.addColorStop(0.6, '#0d0a24');
        sky.addColorStop(1, '#0a0720');
        ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
        ctx.save();
        // 星野（确定性位置 + 闪烁）
        for (let i = 0; i < 26; i++) {
          const sx = ((i * 137.5) % 100) / 100 * w;
          const sy = ((i * 61.8) % 100) / 100 * h;
          const tw = 0.3 + 0.35 * Math.sin(t * 1.7 + i * 1.9);
          ctx.globalAlpha = tw;
          ctx.fillStyle = i % 4 === 0 ? '#e8d48a' : '#fff8dc';
          const s = i % 5 === 0 ? 1.8 : 1.1;
          ctx.fillRect(sx, sy, s, s);
        }
        ctx.globalAlpha = 1;
        // 黄道环：缓慢旋转的星座字符圈
        const cx = w * 0.5, cy = h * 0.42, R = Math.min(w, h) * 0.52;
        ctx.globalAlpha = 0.13;
        ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(0, R - 14), 0, 7); ctx.stroke();
        ctx.font = '11px "Cormorant Garamond",serif';
        ctx.fillStyle = '#e8d48a';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < 12; i++) {
          const a = t * 0.05 + i * Math.PI / 6;
          ctx.fillText(ZODIAC[i], cx + Math.cos(a) * (R - 7), cy + Math.sin(a) * (R - 7));
        }
        // 环上刻度
        ctx.globalAlpha = 0.1;
        for (let i = 0; i < 60; i++) {
          const a = i * Math.PI / 30 - t * 0.02;
          const r0 = R - 14, r1 = i % 5 === 0 ? R - 19 : R - 16.5;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          ctx.stroke();
        }
        ctx.restore();
      },
      grid: { color: 'rgba(212,175,55,0.09)', width: 1, dash: [2, 5] },
      axisText: { color: 'rgba(232,212,138,0.6)', font: '600 11px "Cormorant Garamond",serif' },
      up: { body: '#f2c14e', wick: '#e8d48a', border: null },
      down: { body: '#9d8cff', wick: '#b3a4ff', border: null },
      candle: 'engraved',
      hollow: true,
      glow: 7,
      glowColor: null,
      priceTag: { bg: '#d4af37', fg: '#17102e', radius: 2, font: '700 12px "Cormorant Garamond",serif' },
      priceTagDown: { bg: '#9d8cff', fg: '#100b28', radius: 2, font: '700 12px "Cormorant Garamond",serif' },
      entryLine: 'rgba(232,212,138,0.7)',
      liqLine: 'rgba(157,140,246,0.95)',
      ghostLine: 'rgba(212,175,55,0.8)',
      lastDot: '#fff8dc',
      roundDivider: 'rgba(212,175,55,0.13)',
      roundLabel: 'rgba(232,212,138,0.45)',
      vignette: ['rgba(0,0,0,0)', 'rgba(5,3,16,0.6)'],
    },

    copy: {
      gameTitle: '全仓以赴',
      startBtn: '翻开第一张牌',
      buy: '日 · 做多', sell: '月 · 做空',
      buffTitle: '阿尔卡那低语',
      chargeHint: '长按凝星 · 松手落牌',
      phaseNames: { buff: '抽牌', act: '抉择', resolve: '揭示', between: '冥想', end: '审判' },
      resultKicker: '牌阵已尽 · 星辰结算',
      revealKicker: '逆位揭晓',
      roastTitle: '占卜师的水晶球',
      againBtn: '重新洗牌',
      telegram: { agency: '天象馆 · 命运监察庭', kicker: '星 象 异 动', stamp: '命运如此' },
      /* v5 密度红线：正文 ≤3 行，占卜腔留在牌名与金句 */
      telegramText: {
        sec: t => ({
          title: '命运之轮逆转',
          body: `星盘显示：你连续三轮吸取过多气运。\n天象馆裁定：下轮收益收回 ${Math.round(t.penalty * 100)}%。\n命运之轮，从不只朝一个方向转。`,
        }),
        plug: () => ({
          title: '星力过载警告',
          body: '你以 20x+ 杠杆撬动命轨，星盘发烫。\n监察庭已将杠杆封印至 5x。\n月亮说：慢一点，保证金会跑。',
        }),
        antitrust: t => ({
          title: '星辰均贫富',
          body: `首富「${t.payer}」气运逾末位 5 倍，星盘倾斜。\n依古法抽取 ${MC.fmt.money(t.fine)} 星尘，均分黯淡者。${t.youGot ? `\n一颗星落进你口袋：${MC.fmt.money(t.youGot)}。` : ''}\n天平座看着呢。`,
        }),
        raid: t => ({
          title: '命运突击审计',
          body: `你的收益惊动星辰，监察庭夜巡。\n超额 ${MC.fmt.money(t.seized)} 化作流星收走。${t.heat >= 2 ? `第 ${t.heat} 次记入星册。` : ''}\n发光可以，别刺眼。`,
        }),
      },
      /* v5：≤4 句 × ≤18 字，牌名 = 签名 */
      roast(s, res) {
        const L = [];
        L.push(s.finalEq >= (res.start || 10000)
          ? `${res.mult.toFixed(2)} 倍，「太阳」正位照钱袋。`
          : `牌面收拢 ${MC.fmt.money(s.finalEq)}，「星星」逆位。`);
        if (s.liqs) L.push(`「高塔」现身 ${s.liqs} 次，专劈高杠杆。`);
        else if (s.maxLev >= 50) L.push(`${s.maxLev}x 杠杆，指尖抖眼发光。`);
        else if (s.chase >= 3) L.push(`追涨 ${s.chase} 割肉 ${s.panic}，「愚者」逆位。`);
        else if (s.holdRounds >= 8) L.push(`${s.holdRounds} 轮不动，「隐士」正位修行。`);
        L.push('好牌发过了，是你自己 all in。洗牌见。');
        return L.slice(0, 4).join('');
      },
    },
  });

})(window.MC);
