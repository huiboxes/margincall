/* ═══════════════════════════════════════════════════════════
   主题 6/8 · 热敏小票 THERMAL RECEIPT
   收银机视角的交易人生：打印 K 线 / 入账红章 / 小票腔调复盘
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  MC.Themes.register({
    id: 'receipt',
    name: '热敏小票',
    en: 'THERMAL RECEIPT',
    tagline: '人生如小票 · 打印概不退换',
    css: 'css/themes/receipt.css',
    accentColor: '#f4eeda',
    audio: 'printer',

    logo: `
      <div class="rcp-logo">
        <div class="rl-store">MARGIN CALL 盘口便利店 · 24H 收银中</div>
        <h1 class="rl-main">全仓以赴</h1>
        <div class="rl-sub">单号 No.0000312 · 收银员：你 · 概不退换</div>
        <div class="rl-barcode"></div>
        <div class="rl-code">6 9 0 1 2 3 4 &nbsp; 5 6 7 8 9 0 1 2</div>
        <div class="rl-stamp">非投资建议</div>
      </div>`,

    chart: {
      bg(ctx, w, h) {
        // 热敏纸 + 走纸横线 + 账本红边线
        ctx.fillStyle = '#fcf9ee';
        ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.strokeStyle = 'rgba(43,37,25,0.05)';
        ctx.lineWidth = 1;
        for (let y = 23.5; y < h; y += 24) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        // 左侧红色账本边线
        ctx.strokeStyle = 'rgba(207,59,37,0.22)';
        ctx.beginPath(); ctx.moveTo(26.5, 0); ctx.lineTo(26.5, h); ctx.stroke();
        ctx.strokeStyle = 'rgba(207,59,37,0.12)';
        ctx.beginPath(); ctx.moveTo(29.5, 0); ctx.lineTo(29.5, h); ctx.stroke();
        // 纸口阴影（上缘）
        const g = ctx.createLinearGradient(0, 0, 0, 18);
        g.addColorStop(0, 'rgba(43,37,25,0.10)');
        g.addColorStop(1, 'rgba(43,37,25,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, 18);
        ctx.restore();
      },
      grid: { color: 'rgba(43,37,25,0.14)', width: 1, dash: [2, 4] },
      axisText: { color: 'rgba(43,37,25,0.55)', font: '12px "VT323","Share Tech Mono",monospace' },
      up: { body: '#cf3b25', wick: '#a4301d', border: null },
      down: { body: '#2e7d53', wick: '#256643', border: null },
      // 打印墨块：实心 + 轻微洇墨（热敏头加热不均）
      candle(ctx, o) {
        const { x, y, w, h, cx, col, top, bottom } = o;
        ctx.save();
        ctx.strokeStyle = col.wick; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, top); ctx.lineTo(Math.round(cx) + 0.5, bottom);
        ctx.stroke();
        const bh = Math.max(2, h);
        // 洇墨外扩
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = col.body;
        ctx.fillRect(x - 1, y - 0.7, w + 2, bh + 1.4);
        // 主体墨块
        ctx.globalAlpha = 0.94;
        ctx.fillRect(x, y, w, bh);
        // 打印走纸白条（墨块中部一道浅色横纹）
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#fcf9ee';
        const stripe = (Math.round(cx) % 7) * 0.6;
        ctx.fillRect(x, y + bh * 0.3 + stripe % Math.max(1, bh * 0.4), w, 1);
        ctx.restore();
      },
      priceTag: { bg: '#2b2519', fg: '#f7f1df', radius: 0, font: '13px "VT323",monospace' },
      priceTagDown: { bg: '#2b2519', fg: '#f7f1df', radius: 0, font: '13px "VT323",monospace' },
      entryLine: 'rgba(46,92,158,0.65)',
      liqLine: 'rgba(207,59,37,0.85)',
      ghostLine: 'rgba(46,92,158,0.7)',
      lastDot: '#2b2519',
      roundDivider: 'rgba(43,37,25,0.2)',
      roundLabel: 'rgba(43,37,25,0.45)',
      padRight: 58,
    },

    copy: {
      gameTitle: '全仓以赴',
      startBtn: '打印新小票',
      buy: 'BUY 做多', sell: 'SELL 做空',
      buffTitle: '会员优惠 · 任选一张',
      chargeHint: '长按打印 · 松手入账',
      phaseNames: { buff: '打印券', act: '入账', resolve: '走纸', between: '小计', end: '总计' },
      resultKicker: '* 本 单 已 结 账 *',
      revealKicker: '底联存档',
      roastTitle: '小票背面 · 店长点评',
      againBtn: '再打一张',
      telegram: { agency: '市场监管 · 票据中心', kicker: '系统消息', stamp: '已入账' },
      /* v5 密度红线：正文 ≤3 行，小票腔留在 *** 报头与店规 */
      telegramText: {
        sec: t => ({
          title: '异常流水预警',
          body: `*** 连续三轮入账超额，判定「可疑暴利」***\n下张小票自动罚没 ${Math.round(t.penalty * 100)}%。\n申诉通道已排队 999 位。`,
        }),
        plug: () => ({
          title: '打印机维护通知',
          body: '*** 杠杆长期超 20x，打印头过热 ***\n已强制降档至 5x 冷却。\n损失概不负责，请勿拍打机器。',
        }),
        antitrust: t => ({
          title: '大客户均摊通知',
          body: `*** 首富「${t.payer}」流水超末位 5 倍 ***\n冲正 ${MC.fmt.money(t.fine)}，已分账垫底客户。${t.youGot ? `\n你入账 ${MC.fmt.money(t.youGot)}，见分账联。` : ''}\n本通知一式三份。`,
        }),
        raid: t => ({
          title: '风控冲正通知',
          body: `*** 收益跑太快，检查组上门盘点 ***\n超额 ${MC.fmt.money(t.seized)} 当场冲正。${t.heat >= 2 ? `第 ${t.heat} 次记录在案。` : ''}\n欢迎下次光临，低调点。`,
        }),
      },
      /* v5：≤4 句 × ≤18 字 */
      roast(s, res) {
        const L = [];
        L.push(s.finalEq >= (res.start || 10000)
          ? `合计 ${MC.fmt.money(s.finalEq)}，${res.mult.toFixed(2)} 倍，叮——`
          : `合计 ${MC.fmt.money(s.finalEq)}，亏损存入经验账户。`);
        if (s.liqs) L.push(`爆仓 ${s.liqs} 张作废，纸都打薄了。`);
        else if (s.maxLev >= 50) L.push(`${s.maxLev}x 杠杆，给印钞机上刑。`);
        else if (s.fees > 400) L.push(`手续费 ${MC.fmt.money(s.fees)}，本店利润担当。`);
        else if (s.chase >= 3) L.push(`追高 ${s.chase} 割肉 ${s.panic}，笔笔在案。`);
        L.push('谢谢惠顾，下一位——');
        return L.slice(0, 4).join('');
      },
    },
  });

})(window.MC);
