/* ═══════════════════════════════════════════════════════════
   主题 1/5 · 霓虹夜 NEON NIGHTS
   赛博朋克雨夜地下盘口：霓虹灯管、全息K线、警笛广播
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  MC.Themes.register({
    id: 'neon',
    name: '霓虹夜',
    en: 'NEON NIGHTS',
    tagline: '雨夜地下盘口 · 一夜暴富或天台见',
    css: 'css/themes/neon.css',
    accentColor: '#07070f',
    audio: 'synth',

    logo: `
      <div class="neon-logo">
        <h1 class="nl-main"><span class="nl-tube">全仓以赴</span></h1>
        <div class="nl-sub"><i class="nl-line"></i><span>MARGIN&nbsp;CALL · 24H 地下盘口</span><i class="nl-line"></i></div>
      </div>`,

    chart: {
      bg(ctx, w, h) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(20,10,40,0.35)');
        g.addColorStop(1, 'rgba(5,5,16,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        // 透视网格地平线（淡淡的赛博地板）
        ctx.save();
        ctx.strokeStyle = 'rgba(120,60,255,0.07)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 5; i++) {
          const y = h - i * i * 2.2;
          if (y < h * 0.45) break;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        ctx.restore();
      },
      grid: { color: 'rgba(120,180,255,0.07)', width: 1, dash: [] },
      axisText: { color: 'rgba(140,200,255,0.55)', font: '600 10px "Chakra Petch",ui-monospace,monospace' },
      up: { body: '#22e58a', wick: '#22e58a', border: 'rgba(255,255,255,0.25)' },
      down: { body: '#ff2e88', wick: '#ff2e88', border: 'rgba(255,255,255,0.18)' },
      candle: 'round',
      glow: 9,
      priceTag: { bg: '#22e58a', fg: '#04110a', radius: 4, font: '700 11px "Chakra Petch",monospace' },
      priceTagDown: { bg: '#ff2e88', fg: '#1a0210', radius: 4, font: '700 11px "Chakra Petch",monospace' },
      entryLine: 'rgba(100,200,255,0.75)',
      liqLine: 'rgba(255,46,136,0.9)',
      ghostLine: 'rgba(190,120,255,0.8)',
      lastDot: '#dff6ff',
      roundDivider: 'rgba(140,120,255,0.14)',
      roundLabel: 'rgba(160,140,255,0.4)',
      vignette: ['rgba(0,0,0,0)', 'rgba(2,0,10,0.5)'],
    },

    copy: {
      gameTitle: '全仓以赴',
      startBtn: '进入盘口',
      buy: '做多', sell: '做空',
      buffTitle: '今晚的货到了',
      chargeHint: '长按蓄力 · 松手成交',
      resultKicker: '天亮了 · 强制平仓',
      revealKicker: '档案解密',
      roastTitle: '盘口老哥复盘',
      telegram: { agency: 'SEC · 赛博证监会', kicker: '紧 急 广 播', stamp: '立即执行' },
      roast(s, res) {
        const L = [];
        L.push(s.finalEq >= (res.start || 10000) ? `${res.mult.toFixed(2)} 倍收场，烟酒钱有了。` : `剩 ${MC.fmt.money(s.finalEq)}，雨夜里伞都打不起。`);
        if (s.liqs) L.push(`爆仓 ${s.liqs} 次，手还在杠杆条上。`);
        if (s.maxLev >= 50) L.push(`${s.maxLev}x 杠杆——那不是光，是命。`);
        if (s.accuracy >= 0.7 && s.correctDirs + s.wrongDirs >= 5) L.push(`命中率 ${(s.accuracy * 100).toFixed(0)}%，从 2077 年回来的？`);
        if (s.chase >= 3) L.push(`追涨 ${s.chase} 割肉 ${s.panic}，标准韭菜舞步。`);
        if (s.fees > 400) L.push(`手续费 ${MC.fmt.money(s.fees)}，老板娘记住你了。`);
        if (s.holdRounds >= 8) L.push(`${s.holdRounds} 轮不动，你是来避雨的。`);
        L.push('明晚，老位置。');
        return L.slice(0, 4).join('');
      },
    },
  });

})(window.MC);
