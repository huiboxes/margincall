/* ═══════════════════════════════════════════════════════════
   主题 4/5 · 波普拼贴 STICKER POP
   奶油纸 + 大色块 + 黑描边贴纸 + 漫画分镜 · 签名动作：贴纸弹跳
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  MC.Themes.register({
    id: 'pop',
    name: '波普拼贴',
    en: 'STICKER POP',
    tagline: '贴纸市集 · 梭哈嘉年华 · 输赢都很大声',
    css: 'css/themes/pop.css',
    accentColor: '#fff6df',
    audio: 'toy',

    logo: `
      <div class="pop-logo">
        <h1 class="pl-title"><b>全</b><b>仓</b><b>以</b><b>赴</b></h1>
        <span class="pl-bam">GO!</span>
        <div class="pl-sub">STICKER&nbsp;POP · 梭哈嘉年华</div>
      </div>`,

    chart: {
      grid: { color: 'rgba(25,25,25,0.10)', width: 1.5, dash: [] },
      axisText: { color: 'rgba(25,25,25,0.55)', font: '700 10px Fredoka,sans-serif' },
      up: { body: '#0ca95a', wick: '#191919', border: '#191919' },
      down: { body: '#ff4757', wick: '#191919', border: '#191919' },
      candle: 'round',
      glow: 0,
      priceTag: { bg: '#2667ff', fg: '#fff', radius: 8, font: '700 11px Fredoka,sans-serif' },
      priceTagDown: { bg: '#ff7b00', fg: '#fff', radius: 8, font: '700 11px Fredoka,sans-serif' },
      entryLine: 'rgba(38,103,255,0.8)',
      liqLine: 'rgba(255,71,87,0.9)',
      ghostLine: 'rgba(155,93,229,0.85)',
      lastDot: '#191919',
      roundDivider: 'rgba(25,25,25,0.16)',
      roundLabel: 'rgba(25,25,25,0.45)',
    },

    copy: {
      gameTitle: '全仓以赴',
      startBtn: '开 冲 ！',
      buy: '梭多', sell: '梭空', closeAll: '全跑了', hold: '躺一轮',
      chargeHint: '按住憋气 · 松手下单',
      buffTitle: '抽卡时间到！',
      phaseNames: { buff: '抽卡', act: '出手', resolve: '走起', between: '算账', end: '收工' },
      resultKicker: '收工铃响了 · 全部平仓',
      revealKicker: '真相大白',
      roastTitle: '毒舌弹幕',
      againBtn: '再来亿局！',
      telegram: { agency: 'S.E.C. 漫画分局', kicker: '突发！突发！', stamp: '立即执行!' },
      /* v5 密度红线：正文 ≤3 行，弹幕腔留在拟声词与旁白 */
      telegramText: {
        sec: t => ({
          title: 'SEC 登场！！',
          body: `轰——！三轮赚超 50%，分镜装不下了！\n下轮收益没收 ${Math.round(t.penalty * 100)}%！这是规定！\n（旁白：主角光环也要缴税。）`,
        }),
        plug: () => ({
          title: '网线被拔！！',
          body: `咔嚓！杠杆 20x+，服务器当场昏厥。\n仓位强制降到 5x！复活时间：看心情。\n运维小哥含泪拔线。`,
        }),
        antitrust: t => ({
          title: '均贫富事件！',
          body: `咚——！首富「${t.payer}」钱堆高过分镜框！\n罚没 ${MC.fmt.money(t.fine)}，撒给垫底选手！${t.youGot ? `\n天降红包 ${MC.fmt.money(t.youGot)}！谢大佬！` : ''}${t.youPaid ? `\n（钱从你口袋飞的，疼吗？）` : ''}`,
        }),
        raid: t => ({
          title: '突击检查组！',
          body: `哗——！收益跑太快，检查组「恰好」路过。\n超额 ${MC.fmt.money(t.seized)} 没收！${t.heat >= 2 ? `第 ${t.heat} 次上门了！` : ''}\n发财可以，别太显眼！`,
        }),
      },
      /* v5：≤4 句 × ≤18 字 */
      roast(s, res) {
        const L = [];
        const m = res.mult;
        L.push(m >= 3 ? `收工！${m.toFixed(2)} 倍！彩带喷完三罐！`
          : m >= 1 ? `收工 ${m.toFixed(2)} 倍，金边贴纸+1！`
            : `收工……${MC.fmt.money(s.finalEq)}。输家贴纸限定款！`);
        if (s.liqs) L.push(`爆仓 ${s.liqs} 次！漫画格都在震！`);
        else if (s.maxLev >= 50) L.push(`${s.maxLev}x 杠杆！勇气贴纸贴满墙！`);
        else if (s.chase >= 3) L.push(`追涨 ${s.chase} 割肉 ${s.panic}，咻——啪！`);
        else if (s.accuracy >= 0.7 && s.correctDirs + s.wrongDirs >= 5) L.push(`命中 ${(s.accuracy * 100).toFixed(0)}%！偷看剧本了吧！`);
        L.push('下局见！带上贴纸册！');
        return L.slice(0, 4).join('');
      },
    },
  });

})(window.MC);
