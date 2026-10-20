/* ═══════════════════════════════════════════════════════════
   启动入口 + 键盘快捷键 + QA 自动对局钩子
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  function boot() {
    MC.App.init();

    // 键盘（桌面端辅助）：1/2/3 拿卡，R 刷新，空格 不动，C 平仓；行情演出中 空格/C = 盘中落袋
    document.addEventListener('keydown', e => {
      const phase = MC.Engine.phase;
      if (e.key === 'Enter') {
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#theme-cards')) return;   // 横轨卡上 Enter 只选主题，不开局
        const start = document.querySelector('#btn-start');
        if (!document.querySelector('#screen-title').hidden) { start.click(); return; }
        const ok = document.querySelector('#tg-ok.ready') || (!document.querySelector('#overlay-drama').hidden && document.querySelector('#drama-ok')) || (!document.querySelector('#overlay-peek').hidden && document.querySelector('#peek-ok'));
        if (ok) ok.click();
        return;
      }
      if (!document.querySelector('#overlay-pause').hidden) return;   // 暂停中快捷键一律无效
      if (!document.querySelector('#overlay-buffs').hidden) {
        if (e.key === '1') MC.App.pickByKey && MC.App.pickByKey(0);
        if (e.key === '2') MC.App.pickByKey && MC.App.pickByKey(1);
        if (e.key === '3') MC.App.pickByKey && MC.App.pickByKey(2);
        if (e.key.toLowerCase() === 'r' && !document.querySelector('#overlay-buffs').classList.contains('arming')) MC.Engine.rerollOffer();
      }
      if (phase === 'resolve' && (e.key === ' ' || e.key.toLowerCase() === 'c')) { e.preventDefault(); MC.App.cashout && MC.App.cashout(); }
      if (phase === 'act') {
        if (e.key === ' ') { e.preventDefault(); MC.Engine.hold(); }
        if (e.key.toLowerCase() === 'c') MC.Engine.closePosition(false);
        if (e.key.toLowerCase() === 'b') MC.Engine.openOrResize(1, 3);
        if (e.key.toLowerCase() === 's') MC.Engine.openOrResize(-1, 3);
      }
      if (e.key.toLowerCase() === 'm') {
        const on = MC.Audio.toggle();
        const b = document.querySelector('#btn-sound');
        if (b) b.textContent = on ? '音效开' : '音效关';
        const b2 = document.querySelector('#btn-sound2');
        if (b2) b2.textContent = on ? '音效开' : '音效关';
      }
    });

    // QA 自动对局：?auto=1 无人值守跑完整局（测试用）
    const params = new URLSearchParams(location.search);
    if (params.get('auto')) {
      window.MC_AUTOTEST = true;
      MC.Audio.toggle(false);
      setTimeout(() => autoPlay(params), 300);
    }
  }

  async function autoPlay(params) {
    const E = MC.Engine;
    const seed = params.get('seed') ? +params.get('seed') : undefined;
    const scen = params.get('scen') || undefined;
    MC.App.startGame({ seed, scenario: scen });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let guard = 0;
    while (E.phase !== 'end' && guard++ < 3000) {
      if (E.phase === 'buff') {
        await sleep(60);
        const rnd = Math.random();
        if (rnd < 0.75) {
          const r = E.pickOffer(Math.floor(Math.random() * 3), Math.floor(Math.random() * 6));
          if (r === 'no-funds') E.skipBuffs();
        } else E.skipBuffs();
      } else if (E.phase === 'act') {
        await sleep(60);
        const r = Math.random();
        if (r < 0.4) E.openOrResize(1, [1, 2, 3, 5, 10, 25][Math.floor(Math.random() * 6)]);
        else if (r < 0.7) E.openOrResize(-1, [1, 2, 3, 5, 10][Math.floor(Math.random() * 5)]);
        else if (r < 0.85) E.closePosition(false);
        else E.hold();
      } else if (E.phase === 'resolve') {
        const info = E.stepTick();
        if (params.get('auto') === '2' && info.events && info.events.length) {
          for (const ev of info.events) await MC.App.debug.dramaEv(ev);
        }
        if (info.done) E.settleRoundEnd();
        await sleep(4);
      } else if (E.phase === 'between') {
        await sleep(30);
        if (params.get('auto') === '2') {
          for (const ev of (E.G.pendingEvents || [])) await MC.App.debug.telegram(ev);
        }
        E.nextRound();
      } else await sleep(50);
      // 自动关闭剧情/电报层（auto=2 时留给 QA 抓取）
      if (params.get('auto') !== '2') {
        for (const sel of ['#drama-ok', '#tg-ok', '#peek-ok']) {
          const ov = sel === '#drama-ok' ? '#overlay-drama' : sel === '#tg-ok' ? '#overlay-telegram' : '#overlay-peek';
          if (!document.querySelector(ov).hidden) { document.querySelector(sel).click(); await sleep(40); }
        }
      } else {
        window.MC_OVERLAY_WAIT = true;
      }
    }
    console.log('[AUTOTEST] done, phase =', E.phase, 'equity =', E.G ? MC.fmt.money(E.G.results ? E.G.results.finalEq : 0) : 'n/a');
    document.body.dataset.autodone = '1';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.MC);
