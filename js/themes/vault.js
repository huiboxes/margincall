/* ═══════════════════════════════════════════════════════════
   主题 5/5 · 老钱私行 PRIVATE VAULT
   英伦 Racing Green 皮革 / 烫金雕版 / 火漆密函 / 俱乐部除名信
   签名动作：火漆压印（慢而沉）
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  MC.Themes.register({
    id: 'vault',
    name: '老钱私行',
    en: 'PRIVATE VAULT',
    tagline: '皮革与烫金 · 绅士的杠杆 · 体面地爆仓',
    css: 'css/themes/vault.css',
    accentColor: '#10241b',
    audio: 'felt',

    logo: `
      <div class="vault-logo">
        <div class="vl-crest"><span>MC</span></div>
        <h1 class="vl-title">全仓以赴</h1>
        <div class="vl-rule"><i></i><b>EST. 1873</b><i></i></div>
        <div class="vl-sub">PRIVATE DESK · 会员制盘口</div>
      </div>`,

    chart: {
      bg(ctx, w, h) {
        // 雕版水印：同心椭圆 guilloche
        ctx.save();
        ctx.strokeStyle = 'rgba(212,175,55,0.05)';
        ctx.lineWidth = 0.7;
        for (let i = 0; i < 7; i++) {
          ctx.beginPath();
          ctx.ellipse(w * 0.5, h * 0.52, w * (0.16 + i * 0.075), h * (0.10 + i * 0.062), 0, 0, 7);
          ctx.stroke();
        }
        ctx.restore();
      },
      grid: { color: 'rgba(212, 175, 55, 0.10)', width: 1, dash: [] },
      axisText: { color: 'rgba(240, 232, 210, 0.5)', font: '500 10px "Cormorant Garamond",serif' },
      up: { body: '#c9a227', wick: '#c9a227', border: '#e8cf7a' },
      down: { body: '#8f2d2d', wick: '#8f2d2d', border: '#c05555' },
      candle: 'engraved',
      hollow: true,
      glow: 0,
      priceTag: { bg: '#c9a227', fg: '#14261c', radius: 2, font: '700 11px "Cormorant Garamond",serif' },
      priceTagDown: { bg: '#8f2d2d', fg: '#f4e8e0', radius: 2, font: '700 11px "Cormorant Garamond",serif' },
      entryLine: 'rgba(212,175,55,0.6)',
      liqLine: 'rgba(192,85,85,0.9)',
      ghostLine: 'rgba(157,184,164,0.8)',
      lastDot: '#e8cf7a',
      roundDivider: 'rgba(212,175,55,0.14)',
      roundLabel: 'rgba(212,175,55,0.4)',
      vignette: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.42)'],
    },

    copy: {
      gameTitle: '全仓以赴',
      startBtn: '签 单 入 场',
      buy: '购入多头', sell: '沽出空头', closeAll: '悉数平仓', hold: '静观其变',
      chargeHint: '按住蓄力 · 松手签单',
      buffTitle: '本日承议条款',
      phaseNames: { buff: '承议', act: '签单', resolve: '市况', between: '清算', end: '年终' },
      resultKicker: '年终清算 · 悉数平仓',
      revealKicker: '档案室 · 解密',
      roastTitle: '管家私评',
      againBtn: '再开一局',
      telegram: { agency: '金融行为监理署', kicker: 'BY WARRANT · 密函', stamp: '奉旨查核' },
      /* v5 密度红线：正文 ≤3 行，书信腔留在敬语与落款 */
      telegramText: {
        sec: t => ({
          title: '关注函',
          body: `敬启者：连续三轮收益逾五成，本署已留意。\n依条例，下轮收益罚没 ${Math.round(t.penalty * 100)}%。\n财富宜如佳酿：醇而不喧。顺颂 财祺`,
        }),
        plug: () => ({
          title: '停机修缮通告',
          body: `敬启者：杠杆久逾二十倍，机房偶感风寒。\n今夜子时停机，贵仓位已代为降至五倍。\n由此不便，恕不致歉。`,
        }),
        antitrust: t => ({
          title: '均平裁示',
          body: `查首富「${t.payer}」资产逾末位五倍，有违体面。\n罚没 ${MC.fmt.money(t.fine)}，分润垫底会员。${t.youGot ? `\n阁下获赈 ${MC.fmt.money(t.youGot)}，请 discreetly 领取。` : ''}${t.youPaid ? `\n阁下即首富。请保持微笑。` : ''}`,
        }),
        raid: t => ({
          title: '查核密函',
          body: `收益过快，监理署派员「路过」查核。\n超额 ${MC.fmt.money(t.seized)} 依例没收。${t.heat >= 2 ? `第 ${t.heat} 次立案，望自重。` : ''}\n发财可以，勿太张扬。`,
        }),
      },
      /* v5：≤4 句 × ≤18 字，落款 = 签名 */
      roast(s, res) {
        const L = [];
        const m = res.mult;
        L.push(m >= 3 ? `年终清算 ${m.toFixed(2)} 倍，管家脱帽致敬。`
          : m >= 1 ? `年终清算 ${m.toFixed(2)} 倍，不算失礼。`
            : `清算 ${MC.fmt.money(s.finalEq)}。老夫人放下了茶杯。`);
        if (s.liqs) L.push(`爆仓 ${s.liqs} 次，扶手椅皮质尚新。`);
        else if (s.maxLev >= 50) L.push(`${s.maxLev} 倍杠杆，南海泡沫遗风。`);
        else if (s.chase >= 3) L.push(`追涨 ${s.chase} 杀跌 ${s.panic}，大厅圆舞。`);
        else if (s.holdRounds >= 8) L.push(`静观 ${s.holdRounds} 轮，贵族第一美德。`);
        L.push('—— 管家 谨识于灯下');
        return L.slice(0, 4).join('');
      },
    },
  });

})(window.MC);
