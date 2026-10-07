/* ═══════════════════════════════════════════════════════════
   主题 3/5 · 显像管 PHOSPHOR-87
   1987 琥珀磷光交易终端：开机自检 / ASCII 面板 / 点阵电传打印
   字体：VT323(大数字) + Share Tech Mono(正文/代码) + Noto Sans SC(中文)
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  /* ── 签名动作：CRT 开机（亮线一闪 → 屏幕纵向展开） ── */
  function powerOn() {
    try {
      const old = document.getElementById('crt-poweron');
      if (old) old.remove();
      const d = document.createElement('div');
      d.id = 'crt-poweron';
      d.setAttribute('aria-hidden', 'true');
      document.body.appendChild(d);
      setTimeout(() => { try { d.remove(); } catch (e) { /* noop */ } }, 900);
    } catch (e) { /* 视觉彩蛋失败不影响游戏 */ }
  }

  MC.Themes.register({
    id: 'crt',
    name: '显像管',
    en: 'PHOSPHOR-87',
    tagline: '1987 琥珀磷光交易终端 · 开机即梭哈',
    css: 'css/themes/crt.css',
    accentColor: '#0c0802',
    audio: 'crt',
    onApply: powerOn,

    /* ── logo = 开机自检（CSS 逐行打字，切回标题页即重播） ── */
    logo: `
      <div class="crt-logo">
        <div class="cl-screen">
          <div class="cl-line" style="--w:28ch;--d:.1s;--t:.28s">-- PHOSPHOR-87 BIOS v2.4 --</div>
          <div class="cl-line" style="--w:28ch;--d:.35s;--t:.28s">(C) 1987 MARGIN SYSTEMS INC</div>
          <div class="cl-line" style="--w:32ch;--d:.6s;--t:.26s">MEMORY CHECK 640K ........... <b>OK</b></div>
          <div class="cl-line" style="--w:32ch;--d:.85s;--t:.26s">PHOSPHOR: AMBER P3 .......... <b>OK</b></div>
          <div class="cl-line" style="--w:32ch;--d:1.1s;--t:.26s">TAPE DRIVE: QUANTUM 9T ...... <b>OK</b></div>
          <div class="cl-line" style="--w:35ch;--d:1.35s;--t:.42s">LOADING MARGIN.SYS [########] <b>100%</b></div>
          <h1 class="cl-title">全仓以赴</h1>
          <div class="cl-sub">MARGIN CALL · PHOSPHOR-87 TERMINAL</div>
          <div class="cl-prompt">C:\\MARGIN&gt; PRESS START<span class="cl-cursor"></span></div>
        </div>
      </div>`,

    chart: {
      /* 琥珀屏底光 + 缓慢下移的刷新滚动带 */
      bg(ctx, w, h, now) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(42,24,2,0.5)');
        g.addColorStop(0.55, 'rgba(16,10,2,0.32)');
        g.addColorStop(1, 'rgba(7,4,1,0.5)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        const bandY = ((now || 0) / 40) % (h + 160);
        const rg = ctx.createLinearGradient(0, bandY - 80, 0, bandY + 80);
        rg.addColorStop(0, 'rgba(255,176,0,0)');
        rg.addColorStop(0.5, 'rgba(255,196,90,0.05)');
        rg.addColorStop(1, 'rgba(255,176,0,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, bandY - 80, w, 160);
      },
      grid: { color: 'rgba(255,176,0,0.09)', width: 1, dash: [2, 5] },
      axisText: { color: 'rgba(255,176,0,0.55)', font: '11px "Share Tech Mono",ui-monospace,monospace' },
      up: { body: '#ffb000', wick: '#ffa200', border: null },
      down: { body: '#b06a08', wick: '#8f5406', border: null },
      /* 自定义蜡烛：字符块感 —— 阳线亮琥珀实心+磷光溢出，阴线暗琥珀空心，
         实体内刻 1px 扫描暗纹（shadow 由外层 glow 提供磷光余晖） */
      candle(ctx, o) {
        const x = Math.round(o.x), y = Math.round(o.y);
        const w = Math.max(3, Math.round(o.w)), h = Math.max(2, Math.round(o.h));
        const cx = Math.round(o.cx);
        const top = Math.round(o.top), bot = Math.round(o.bottom);
        // 影线：1px 细柱
        ctx.fillStyle = o.col.wick;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(cx, top, 1, Math.max(1, bot - top));
        ctx.globalAlpha = 1;
        if (o.dir > 0) {
          // 磷光溢出（余晖）
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = o.col.body;
          ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
          ctx.globalAlpha = 1;
          ctx.fillRect(x, y, w, h);
        } else {
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = o.col.body;
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = o.col.body;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
        }
        // 实体内扫描暗纹（不带辉光）
        if (h >= 7) {
          ctx.save();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = '#000';
          for (let yy = y + 2; yy < y + h - 1; yy += 3) ctx.fillRect(x, yy, w, 1);
          ctx.restore();
        }
      },
      hollow: false,
      glow: 7,
      glowColor: 'rgba(255,176,0,0.55)',
      priceTag: { bg: '#ffb000', fg: '#160d00', radius: 0, font: '700 12px "Share Tech Mono",ui-monospace,monospace' },
      priceTagDown: { bg: '#a86800', fg: '#1c1000', radius: 0, font: '700 12px "Share Tech Mono",ui-monospace,monospace' },
      entryLine: 'rgba(255,206,110,0.6)',
      liqLine: 'rgba(255,86,0,0.95)',
      ghostLine: 'rgba(255,236,180,0.8)',
      lastDot: '#ffe6b0',
      roundDivider: 'rgba(255,176,0,0.14)',
      roundLabel: 'rgba(255,176,0,0.42)',
      scanlines: 0.14,
      vignette: ['rgba(0,0,0,0)', 'rgba(9,4,0,0.55)'],
      padTop: 22,
    },

    copy: {
      gameTitle: '全仓以赴',
      startBtn: '开机进场',
      buy: '做多', sell: '做空',
      buffTitle: '┤ 装 载 模 块 ├',
      chargeHint: '长按蓄力·松手成交',
      phaseNames: { buff: '装载', act: '指令', resolve: '行情', between: '结算', end: '终局' },
      resultKicker: '会话报告 · LPT1',
      revealKicker: '磁带解码',
      roastTitle: 'SYSLOG · 系统日志复盘',
      againBtn: '重新开机',
      telegram: { agency: 'SEC MAINFRAME', kicker: '** PRIORITY FLASH **', stamp: '■ 已执行 ■' },
      /* v5 密度红线：正文 ≤3 行，电传腔留在 ZCZC/NNNN 报头报尾 */
      telegramText: {
        sec: t => ({
          title: 'SEC-312 关注函',
          body: `ZCZC 0451 · 连轮收益超 50%，稳定指数受扰。\n依稳定法 312 条：下轮罚没 ${Math.round(t.penalty * 100)}%。\n请低调发财。NNNN`,
        }),
        plug: () => ({
          title: '交易所拔网线',
          body: 'ZCZC 0117 · 杠杆长期超 20x。\n主机深夜维护，仓位强制降至 5x。\n技术原因，请勿追问。NNNN',
        }),
        antitrust: t => ({
          title: '反垄断调查',
          body: `ZCZC 0733 · 首富「${t.payer}」领先末位超 5 倍。\n罚没 ${MC.fmt.money(t.fine)} 均分垫底。${t.youGot ? `你收到 ${MC.fmt.money(t.youGot)}。` : ''}${t.youPaid ? `你缴纳 ${MC.fmt.money(t.youPaid)}。` : ''}\n反垄断条款触发。NNNN`,
        }),
        raid: t => ({
          title: 'SEC 突击检查',
          body: `ZCZC 0911 · 收益跑太快，检查组路过。\n没收超额 ${MC.fmt.money(t.seized)}。${t.heat >= 2 ? `第 ${t.heat} 次立案。` : ''}\n发财可以，别太明显。NNNN`,
        }),
      },
      /* v5：≤4 句，syslog 级别标签 = 签名，正文短句 */
      roast(s, res) {
        const M = MC.fmt.money;
        const mult = (res && res.mult) || 1;
        const start = (res && res.start) || 10000;
        const L = [];
        L.push(mult >= 1
          ? `[INFO] 净值 ${M(s.finalEq)}，x${mult.toFixed(2)}。未破产，已存档。`
          : `[ERR ] 净值 ${M(s.finalEq)}，燃烧率 ${Math.max(0, Math.round((1 - mult) * 100))}%。`);
        if (s.liqs) L.push(`[CRIT] 内核崩溃 ${s.liqs} 次，kill -9 成肌肉记忆。`);
        else if (s.maxLev >= 50) L.push(`[WARN] ${s.maxLev}x 杠杆，重读风险须知.txt。`);
        else if (s.chase >= 3) L.push(`[WARN] 追高 ${s.chase} 割肉 ${s.panic}，韭菜协议 v2。`);
        else if (s.accuracy >= 0.7 && s.correctDirs + s.wrongDirs >= 5) L.push(`[INFO] 命中 ${(s.accuracy * 100).toFixed(0)}%，内幕包排查失败。`);
        else if (s.fees > start * 0.04) L.push(`[INFO] 手续费 ${M(s.fees)}，经理逢节发果篮。`);
        L.push('[END ] core dump 写入 /dev/margin。');
        return L.slice(0, 4).join('\n');
      },
    },
  });

})(window.MC);
