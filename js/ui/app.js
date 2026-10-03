/* ═══════════════════════════════════════════════════════════
   UI 应用层：屏幕流转 / 构筑卡牌 / 蓄力交互 / 结算演出
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  const { bus, $, $$, el, fmt, clamp, Audio, Engine, Tremor } = MC;
  const A = MC.Audio;

  let chart = null;
  let chargeState = null;
  let resolving = false;
  let replaceMode = null;   // {offerIdx} 槽位替换模式
  /* 对局会话令牌：每次开局/投降 +1。异步演出循环（runResolve）每次 await 之后核对令牌，
     不一致立即退出——否则旧循环会在玩家点掉弹窗后继续 nextRound，把已结束的局「复活」并二次弹结算 */
  let session = 0;
  let miniCharts = [];

  /* ═══════════ 通用：toast / 闪光 / 粒子 ═══════════ */
  function toast(text, cls, ms) {
    const layer = $('#toast-layer');
    const t = el('div', { class: 'toast ' + (cls || ''), text });
    layer.appendChild(t);
    // 同屏最多 2 条：多了只会糊在排行榜上
    const all = layer.querySelectorAll('.toast');
    for (let i = 0; i < all.length - 2; i++) all[i].remove();
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, ms || 2200);
  }

  function centerFlash(html, cls, ms) {
    $$('.center-flash').forEach(n => n.remove());   // 同屏只留最新一条：避免「开多」与「止损离场」叠成一团
    const f = el('div', { class: 'center-flash ' + (cls || ''), html });
    $('#fx-layer').parentElement.appendChild(f);
    requestAnimationFrame(() => f.classList.add('in'));
    setTimeout(() => { f.classList.remove('in'); setTimeout(() => f.remove(), 450); }, ms || 900);
  }

  /* 屏幕震动：power 1-3 档，可叠加重置 */
  let shakeTimer = 0;
  function shake(power) {
    const app = $('#app');
    const lvl = power >= 10 ? 'hard' : power >= 5 ? 'mid' : 'soft';
    app.classList.remove('shake-soft', 'shake-mid', 'shake-hard');
    void app.offsetWidth; // 重启动画
    app.classList.add('shake-' + lvl);
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => app.classList.remove('shake-soft', 'shake-mid', 'shake-hard'), 650);
  }

  /* 浮动数字：从 (x,y) 升起淡出；cls: good/bad/gold/crit/mult */
  function floatText(x, y, text, cls, big) {
    const layer = $('#float-layer');
    if (!layer) return;
    const n = el('div', { class: 'float-txt ' + (cls || '') + (big ? ' big' : ''), text });
    n.style.left = x + 'px'; n.style.top = y + 'px';
    layer.appendChild(n);
    requestAnimationFrame(() => n.classList.add('rise'));
    setTimeout(() => n.remove(), big ? 1500 : 1100);
  }
  /* 从元素中心浮字 */
  function floatFrom(node, text, cls, big) {
    if (!node) return;
    const r = node.getBoundingClientRect();
    floatText(r.left + r.width / 2, r.top + r.height / 3, text, cls, big);
  }

  /* 全屏氛围闪：gold(里程碑/暴击) / red(大亏/濒死) */
  function vignette(cls, ms) {
    const v = $('#fx-vignette');
    if (!v) return;
    v.className = '';
    void v.offsetWidth;
    v.classList.add('on', cls);
    setTimeout(() => { v.classList.remove('on'); }, ms || 700);
  }

  /* fx 粒子层 */
  const fx = {
    parts: [], canvas: null, ctx: null, running: false,
    init() {
      this.canvas = $('#fx-layer');
      this.ctx = this.canvas.getContext('2d');
      const rs = () => {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        this.canvas.width = innerWidth * dpr; this.canvas.height = innerHeight * dpr;
        this.canvas.style.width = innerWidth + 'px'; this.canvas.style.height = innerHeight + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      rs(); addEventListener('resize', rs);
    },
    burst(x, y, n, colors, power) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * (power || 6);
        this.parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2,
          life: 1, decay: 0.012 + Math.random() * 0.02,
          size: 2 + Math.random() * 4, color: colors[i % colors.length],
          spin: (Math.random() - 0.5) * 0.3, rot: Math.random() * 6,
        });
      }
      if (!this.running) { this.running = true; requestAnimationFrame(t => this.loop(t)); }
    },
    /* 金币雨：现金落袋的"满屏爆金币"演出（返佣/利息/止盈/里程碑） */
    coins(n, x) {
      const gold = ['#ffd166', '#ffdf8a', '#e8b23c', '#fff3c4'];
      for (let i = 0; i < n; i++) {
        this.parts.push({
          x: x != null ? x + (Math.random() - 0.5) * 70 : Math.random() * innerWidth,
          y: -14 - Math.random() * innerHeight * 0.3,
          vx: (Math.random() - 0.5) * 1.8, vy: 2.2 + Math.random() * 3.2,
          life: 1, decay: 0.0055, size: 5 + Math.random() * 6,
          color: gold[i % gold.length],
          spin: (Math.random() - 0.5) * 0.3, rot: Math.random() * 6, coin: true,
        });
      }
      if (!this.running) { this.running = true; requestAnimationFrame(t => this.loop(t)); }
    },
    confetti(colorA, colorB) {
      for (let i = 0; i < 90; i++) {
        this.parts.push({
          x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5,
          vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3.5,
          life: 1, decay: 0.004, size: 3 + Math.random() * 5,
          color: Math.random() < 0.5 ? colorA : colorB,
          spin: (Math.random() - 0.5) * 0.25, rot: Math.random() * 6, confetti: true,
        });
      }
      if (!this.running) { this.running = true; requestAnimationFrame(t => this.loop(t)); }
    },
    loop(now) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      this.parts = this.parts.filter(p => p.life > 0 && p.y < innerHeight + 30);
      for (const p of this.parts) {
        p.x += p.vx; p.y += p.vy; p.vy += p.confetti ? 0.02 : 0.18; p.rot += p.spin; p.life -= p.decay;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.coin) {
          ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, 7); ctx.fill();
          ctx.globalAlpha = Math.max(0, p.life) * 0.5;
          ctx.fillStyle = '#8a6410';
          ctx.beginPath(); ctx.arc(0, 0, p.size / 4.5, 0, 7); ctx.fill();
        } else if (p.confetti) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, 7); ctx.fill(); }
        ctx.restore();
      }
      if (this.parts.length) requestAnimationFrame(t => this.loop(t));
      else { this.running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
      void now;
    },
  };

  /* ═══════════ 屏幕流转 ═══════════ */
  function showScreen(name) {
    for (const s of ['title', 'game', 'result']) {
      const node = $('#screen-' + s);
      node.hidden = s !== name;
    }
    $('#app').dataset.phase = name;
    // 标题迷你吸引图只在标题页跑：进局停掉省 CPU/电量，回标题重建
    if (name === 'title') buildMiniCharts(); else stopMiniCharts();
    window.scrollTo(0, 0);
  }

  function stopMiniCharts() {
    for (const m of miniCharts) { try { m.stop(); } catch (e) { /* noop */ } }
    miniCharts = [];
  }
  function buildMiniCharts() {
    stopMiniCharts();
    const wrap = $('#theme-cards');
    requestAnimationFrame(() => {
      $$('.tc-canvas', wrap).forEach((cv, i) => {
        const t = MC.Themes.all[i];
        try {
          const mini = MC.Chart.miniChart(cv, Object.assign({}, MC.Chart.DEFAULT_STYLE, t.chart), 1000 + i * 77);
          miniCharts.push(mini);
        } catch (e) { console.warn('mini chart', e); }
      });
    });
  }

  /* ═══════════ 标题页 ═══════════ */
  function renderTitle() {
    const theme = MC.Themes.current;
    // logo & tagline
    const logoSlot = $('#logo-slot');
    logoSlot.innerHTML = theme.logo || `<h1 class="logo-default">全仓以赴</h1>`;
    $('#tagline-slot').textContent = theme.tagline || '盲开历史行情 · 15 轮定生死';
    document.title = (theme.copy.gameTitle || '全仓以赴') + ' · ' + (theme.en || 'Margin Call');

    // 主题卡片
    const wrap = $('#theme-cards');
    if (!wrap.dataset.built) {
      wrap.innerHTML = '';
      for (const t of MC.Themes.all) {
        const card = el('div', { class: 'theme-card', 'data-theme-id': t.id, tabindex: '0', role: 'button' },
          el('div', { class: 'tc-preview' }, el('canvas', { class: 'tc-canvas' })),
          el('div', { class: 'tc-info' },
            el('b', { class: 'tc-name', text: t.name }),
            el('span', { class: 'tc-tag', text: t.tagline }),
          ),
          el('i', { class: 'tc-check' }),
        );
        card.addEventListener('click', () => pickTheme(t.id));
        card.addEventListener('keydown', e => {   // a11y：键盘可达可选（Enter/Space）
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pickTheme(t.id); }
        });
        wrap.appendChild(card);
      }
      wrap.dataset.built = '1';
      initThemeRail(wrap);
    }
    $$('.theme-card', wrap).forEach(c => c.classList.toggle('sel', c.dataset.themeId === MC.Themes.currentId));

    // 生涯数据
    const save = MC.save.read();
    const career = save.career || {};
    $('#title-stats').innerHTML = career.games ?
      `<span>生涯 <b>${career.games}</b> 局</span><span>最佳身家 <b>${fmt.money(career.bestEq || 0)}</b></span><span>最高倍数 <b>${(career.bestMult || 0).toFixed(1)}x</b></span><span>爆仓 <b>${career.liqs || 0}</b> 次</span>`
      : `<span>本金 ¥10,000 · 15 轮定生死</span>`;

    // 陀螺仪按钮
    $('#btn-gyro').hidden = !MC.isTouch || Tremor.gyroOn;
    $('#btn-start .btn-label').textContent = theme.copy.startBtn || '进入盘口';
  }

  /* 界面风格横轨：触屏原生滑动之外，补齐桌面端三种输入——滚轮转横向、鼠标拖拽、左右箭头。
     （v1.6 前桌面端只能看见 3 套：滚轮纵向滚页面、鼠标拖拽不是原生滚动，mandatory 吸附还会把小位移吸回） */
  function initThemeRail(rail) {
    const step = () => 170;
    const prev = $('#rail-prev'), next = $('#rail-next');
    const sync = () => {
      const max = rail.scrollWidth - rail.clientWidth - 2;
      prev.hidden = rail.scrollLeft <= 2;
      next.hidden = rail.scrollLeft >= max;
    };
    rail.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    prev.addEventListener('click', () => rail.scrollBy({ left: -step(), behavior: 'smooth' }));
    next.addEventListener('click', () => rail.scrollBy({ left: step(), behavior: 'smooth' }));
    // 滚轮：纵向滚轮在轨上转为横向（不吞页面纵向滚动的场景：轨已到头时放行）
    rail.addEventListener('wheel', e => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // 触控板横滑交给原生
      const max = rail.scrollWidth - rail.clientWidth;
      const atEnd = (e.deltaY > 0 && rail.scrollLeft >= max - 2) || (e.deltaY < 0 && rail.scrollLeft <= 2);
      if (atEnd) return;
      e.preventDefault();
      rail.scrollLeft += e.deltaY;
    }, { passive: false });
    // 鼠标拖拽（触屏走原生手势，不接管）
    let down = false, x0 = 0, s0 = 0, moved = false;
    rail.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse') return;
      down = true; moved = false; x0 = e.clientX; s0 = rail.scrollLeft;
      rail.classList.add('dragging');
    });
    window.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 4) moved = true;
      rail.scrollLeft = s0 - dx;
    });
    window.addEventListener('pointerup', () => {
      if (!down) return;
      down = false; rail.classList.remove('dragging');   // 移除 .dragging 即恢复 proximity 吸附
      if (moved) requestAnimationFrame(() => { moved = false; });   // click 在 rAF 前派发：拖拽后的第一次点击仍被吞
    });
    // 拖拽过程中不许误触换肤
    rail.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
    sync();
  }

  function pickTheme(id) {
    MC.Themes.apply(id);
    A.unlock(); A.play('click');
    renderTitle();
  }

  /* 终止当前对局的一切进行中演出：关掉所有覆盖层、清掉浮层节点、停警报，令牌 +1 */
  function abortSession() {
    session++;
    resolving = false;
    chargeState = null;
    A.stopAlarm(); A.stopCharge(); Tremor.setStress(0);
    $('#btn-cashout').hidden = true;
    for (const id of ['overlay-buffs', 'overlay-telegram', 'overlay-drama', 'overlay-peek', 'overlay-mult', 'overlay-school', 'overlay-pause']) {
      const ov = $('#' + id);
      if (!ov) continue;
      clearTimeout(ov._hideT);
      ov.classList.remove('show');
      ov.hidden = true;
    }
    $$('.round-summary, .center-flash').forEach(n => n.remove());
    $('#pos-card').classList.remove('dim');
    if (replaceMode) exitReplaceMode();
    const market = $('#market');
    if (market) { market.classList.remove('danger', 'pulse', 'glow-up', 'glow-down'); market.style.setProperty('--pnl-a', '0'); }
    $('#fx-vignette').classList.remove('nearliq');
    $('#dock').classList.remove('disabled');
  }

  /* ═══════════ 开局 ═══════════ */
  function startGame(opts) {
    abortSession();
    A.unlock();
    Tremor.init();
    Tremor.resetPeak();
    resolving = false;
    replaceMode = null;
    lastMultBase = 1;
    lastEquity = 10000;
    $('#dock').classList.remove('disabled');
    Engine.newGame(opts || {});
    showScreen('game');
    initChart();
    renderSlots();
    renderRankStrip();
    resetLevDisplay();
    renderRiskRow();
    updateHUD();
    $('#hint-stack').innerHTML = '';
    const row = $('#status-row'); if (row) { row.innerHTML = ''; row.dataset.sig = ''; }
  }

  function initChart() {
    if (!chart) {
      chart = MC.Chart.makeChart($('#chart'));
      chart.setStyle(Object.assign({}, MC.Chart.DEFAULT_STYLE, MC.Themes.chartStyle));
      chart.start();
    } else {
      chart.setStyle(Object.assign({}, MC.Chart.DEFAULT_STYLE, MC.Themes.chartStyle));
    }
    chart.resize();
    syncChart();
  }
  function syncChart() {
    const G = Engine.G;
    if (!G || !chart) return;
    chart.setData({ prices: G.mkt.prices, revealedTick: G.revealedTick, roundBounds: G.mkt.roundBounds });
    chart.setGhost(G.ghost);
    syncPosLines();
  }
  function syncPosLines() {
    const p = Engine.G.player;
    chart.setPos(p.pos ? { entry: p.pos.entry, liq: Engine.liqPrice(), dir: p.pos.dir, sl: p.pos.sl, tp: p.pos.tp } : null);
  }

  /* ═══════════ HUD ═══════════ */
  let lastEquity = 10000;
  function updateHUD(animate) {
    const G = Engine.G; if (!G) return;
    const eq = Engine.equity(), p = G.player;
    $('#hud-round-num').textContent = G.round;
    const copy = MC.Themes.copy;
    $('#hud-phase-name').textContent = copy.phaseNames[G.phase] || '';
    const eqNode = $('#hud-equity');
    if (animate !== false && Math.abs(eq - lastEquity) > 1) {
      MC.rollNumber(eqNode, lastEquity, eq, 380, v => fmt.money(v));
    } else eqNode.textContent = fmt.money(eq);
    lastEquity = eq;
    eqNode.classList.toggle('up', eq > p.start); eqNode.classList.toggle('down', eq < p.start);
    const pct = eq / p.start - 1;
    const pnlNode = $('#hud-pnl');
    pnlNode.textContent = fmt.pct(pct);
    pnlNode.className = 'pnl ' + (pct > 0.001 ? 'up' : pct < -0.001 ? 'down' : '');
    const cashNode = $('#hud-cash');
    if (p.cash < -1) {
      cashNode.textContent = '借贷 ' + fmt.money(-p.cash);
      cashNode.classList.add('loan');
    } else {
      cashNode.textContent = fmt.money(p.cash);
      cashNode.classList.remove('loan');
    }
    updateMultBadge();
    renderStatusRow();

    // 监管灯
    const lights = $('#reg-lights');
    const icons = { sec: '函', plug: '网', antitrust: '垄', raid: '查' };
    const kinds = [...new Set(G.regLog.map(k => k.replace(/\d+$/, '')))];
    lights.innerHTML = kinds.map(k => `<i title="${k}">${icons[k] || '监'}</i>`).join('');

    // 持仓卡
    const card = $('#pos-card');
    if (p.pos) {
      card.hidden = false;
      const u = Engine.upnl();
      $('#pos-dir').textContent = p.pos.dir > 0 ? '多' : '空';
      $('#pos-dir').className = 'pos-dir ' + (p.pos.dir > 0 ? 'long' : 'short');
      $('#pos-lev').textContent = p.pos.lev + 'x';
      $('#pos-notional').textContent = fmt.money(p.pos.N);
      $('#pos-entry').textContent = MC.Market.fmtPrice(p.pos.entry);
    const age = Engine.G.round - p.pos.openedRound + 1;   // v1.7.2 跨轮持仓可见：第 N 轮开的仓
    $('#pos-age-wrap').hidden = age < 2;
    $('#pos-age').textContent = `${age} 轮 · 第${p.pos.openedRound}轮开`;
      const uN = $('#pos-upnl');
      uN.textContent = fmt.signed(u);
      uN.className = u >= 0 ? 'good' : 'bad';
      const lp = Engine.liqPrice();
      const dist = Math.abs(Engine.price() - lp) / Engine.price();
      let liqHtml = `强平价 <b>${MC.Market.fmtPrice(lp)}</b> · 距离 <b class="${dist < 0.03 ? 'bad' : ''}">${(dist * 100).toFixed(1)}%</b>`;
      if (p.pos.sl != null) liqHtml += ` · 止损 <b class="sl">${MC.Market.fmtPrice(p.pos.sl)}</b>`;
      if (p.pos.tp != null) liqHtml += ` · 止盈 <b class="tp">${MC.Market.fmtPrice(p.pos.tp)}</b>`;
      $('#pos-liq').innerHTML = liqHtml;
    } else card.hidden = true;

    $('#btn-close-pos').disabled = !p.pos || G.phase !== 'act';
    updateRiskHint();
  }

  /* ═══════════ 收益倍率徽章 + 状态行 ═══════════ */
  let lastMultBase = 1;
  function currentMultEstimate() {
    // 徽章显示：静态基础 + 已知动态加法（雪球/连胜/赌徒/耐心蓄能）
    const G = Engine.G; if (!G) return 1;
    const p = G.player;
    let add = 0;
    if (p.snowMult > 0) add += p.snowMult;
    if (p.winStreak >= 2) add += Math.min(0.3, 0.05 * (p.winStreak - 1));
    if (G.mods.gamblerReroll && p.rerollsThisRound > 0) add += p.rerollsThisRound * 0.05;
    if (p.pos && p.pos.patienceBonus > 0) add += p.pos.patienceBonus;
    else if (!p.pos && G.mods.patientStack > 0 && p.patientStacks > 0) add += p.patientStacks * G.mods.patientStack;
    return (G.mods.multBase || 1) + add;
  }
  function updateMultBadge(animate) {
    const badge = $('#mult-badge'); if (!badge || !Engine.G) return;
    const v = currentMultEstimate();
    const node = $('#mult-val');
    if (animate !== false && Math.abs(v - lastMultBase) > 0.001) {
      MC.rollNumber(node, lastMultBase, v, 420, x => '×' + x.toFixed(2));
      badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
      if (v > lastMultBase) floatFrom(badge, '+' + (v - lastMultBase).toFixed(2) + 'x', 'mult');
    } else node.textContent = '×' + v.toFixed(2);
    lastMultBase = v;
    badge.dataset.tier = v >= 4 ? 'fire' : v >= 2.5 ? 'gold' : v >= 1.5 ? 'hot' : 'base';
  }
  function renderStatusRow() {
    const row = $('#status-row'); if (!row || !Engine.G) return;
    const G = Engine.G, p = G.player, m = G.mods;
    const chips = [];
    if (m.patientStack > 0 && p.patientStacks > 0) chips.push({ icon: '忍', text: `耐心 ×${p.patientStacks}`, cls: 'st-patience', title: `开仓时爆发：+${(p.patientStacks * m.patientStack).toFixed(2)}x` });
    if (p.pos && p.pos.patienceBonus > 0) chips.push({ icon: '忍', text: `耐心爆发 +${p.pos.patienceBonus.toFixed(2)}x`, cls: 'st-patience burst' });
    if (p.diamondArmed > 0) chips.push({ icon: '钻', text: `钻石蓄能 ×${p.diamondArmed}`, cls: 'st-diamond' });
    if (p.winStreak >= 2) chips.push({ icon: '连', text: `${p.winStreak} 连胜 +${Math.min(0.3, 0.05 * (p.winStreak - 1)).toFixed(2)}x`, cls: 'st-streak' });
    if (p.snowMult > 0) chips.push({ icon: '滚', text: `雪球 +${p.snowMult.toFixed(2)}x`, cls: 'st-snow' });
    if (m.gamblerReroll && p.rerollsThisRound > 0) chips.push({ icon: '赌', text: `赌徒 +${(p.rerollsThisRound * 0.05).toFixed(2)}x`, cls: 'st-gambler' });
    if (m.compoundSnow > 0 || m.setSnow > 0) chips.push({ icon: '复', text: `每轮+${((m.compoundSnow || 0) + (m.setSnow || 0)).toFixed(2)}x`, cls: 'st-compound' });
    if (p.cash < -1) chips.push({ icon: '贷', text: '借贷中', cls: 'st-loan' });
    // 条件倍率卡：待命（虚线）→ 条件达成（实线）→ 正在兑现（盈利中，金色）
    for (const c of Engine.condStates()) {
      chips.push({ icon: c.icon, text: `×${c.val.toFixed(2)}`, cls: 'st-cond' + (c.pay ? ' pay' : c.met ? ' met' : ''), title: `${c.name} · ${c.label}${c.pay ? ' · 本轮兑现中' : c.met ? ' · 条件达成，盈利即兑现' : ' · 待命'}` });
    }
    const sig = chips.map(c => c.cls + c.text).join('|');
    if (row.dataset.sig === sig) return;
    row.dataset.sig = sig;
    row.innerHTML = '';
    for (const c of chips) {
      row.appendChild(el('span', { class: 'st-chip ' + c.cls, title: c.title || '', html: `<i>${c.icon}</i>${c.text}` }));
    }
  }
  /* 倍率明细弹层 */
  function openMultPanel() {
    const G = Engine.G; if (!G) return;
    const m = G.mods, p = G.player;
    const list = $('#mp-list');
    list.innerHTML = '';
    const rows = [];
    rows.push({ icon: '基', name: '基础', op: '', val: '×1.00', label: '起点', cls: 'base' });
    for (const s of (m.multSrcs || [])) {
      const v = typeof s.val === 'function' ? s.val({ equity: Engine.equity(), hintCount: (G.hints || []).length }) : s.val;
      if (s.op === '+') rows.push({ icon: s.icon, name: s.name, op: '+', val: '+' + (v || 0).toFixed(2) + 'x', label: s.label, cls: s.school });
      else rows.push({ icon: s.icon, name: s.name, op: '×', val: '×' + (v || 1).toFixed(2), label: s.label + ' · 条件', cls: s.school });
    }
    if (p.snowMult > 0) rows.push({ icon: '滚', name: '雪球累积', op: '+', val: '+' + p.snowMult.toFixed(2) + 'x', label: '本局永久', cls: 'econ' });
    if (p.winStreak >= 2) rows.push({ icon: '连', name: '热手连胜', op: '+', val: '+' + Math.min(0.3, 0.05 * (p.winStreak - 1)).toFixed(2) + 'x', label: `${p.winStreak} 连胜 · 输清零`, cls: 'wild' });
    if (p.diamondArmed > 0) rows.push({ icon: '钻', name: '钻石蓄能', op: '×', val: '×' + p.diamondArmed, label: '下轮生效', cls: 'wild' });
    for (const r of rows) {
      list.appendChild(el('div', { class: 'mp-row ' + (r.cls || ''), html: `<i>${r.icon}</i><b>${r.name}</b><span>${r.val}</span><small>${r.label || ''}</small>` }));
    }
    $('#mp-total').textContent = '×' + currentMultEstimate().toFixed(2);
    const ov = $('#overlay-mult');
    clearTimeout(ov._hideT);
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add('show'));
    A.play('hint');
  }
  function closeMultPanel() {
    const ov = $('#overlay-mult');
    ov.classList.remove('show');
    hideOverlayLater(ov, 220);
  }

  /* ═══════════ 手抖表 ═══════════ */
  function updateTremor(v) {
    const calm = Engine.G && Engine.G.mods.calm;
    const val = calm ? 0 : v;
    const fill = $('#tremor-fill');
    fill.style.width = val + '%';
    fill.dataset.level = val > 70 ? 'high' : val > 35 ? 'mid' : 'low';
    $('#tremor-val').textContent = Math.round(val);
    const ghost = $('#tremor-ghost');
    ghost.style.left = Math.min(Tremor.peak, 100) + '%';
    $('#tremor-meter').classList.toggle('calm', calm);
  }

  /* ═══════════ 排名条 ═══════════ */
  function renderRankStrip() {
    const strip = $('#rank-strip');
    strip.innerHTML = '';
    const rows = Engine.standings();
    for (const r of rows) {
      const row = el('div', { class: 'rank-row' + (r.isBot ? '' : ' you'), 'data-id': r.id },
        el('span', { class: 'rk', text: r.rank }),
        el('span', { class: 'av', text: r.alive === false ? '💀' : r.avatar }),
        el('span', { class: 'nm', text: r.name }),
        el('span', { class: 'act', text: '' }),
        el('span', { class: 'eq', text: fmt.money(r.eq) }),
      );
      strip.appendChild(row);
    }
  }
  function updateRankStrip() {
    const rows = Engine.standings();
    const strip = $('#rank-strip');
    for (const r of rows) {
      let row = $(`.rank-row[data-id="${r.id}"]`, strip);
      if (!row) continue;
      $('.rk', row).textContent = r.rank;
      $('.av', row).textContent = r.alive === false ? '💀' : r.avatar;
      $('.eq', row).textContent = fmt.money(Math.max(r.eq, 0));
      $('.act', row).textContent = r.isBot && r.lastAct ? r.lastAct : '';
      row.classList.toggle('dead', r.alive === false);
      row.classList.toggle('leader', r.rank === 1);
      // 重排（order）
      row.style.order = r.rank;
    }
  }

  /* ═══════════ Buff 槽位 ═══════════ */
  function renderSlots() {
    const bar = $('#slots-bar');
    bar.innerHTML = '';
    const slots = Engine.G.buffs.slots;
    for (let i = 0; i < 6; i++) {
      const s = slots[i];
      const node = el('div', { class: 'slot' + (s ? ' filled ' + s.def.school : ' empty'), 'data-i': i },
        s ? [
          el('span', { class: 'sl-icon', text: s.def.icon }),
          el('span', { class: 'sl-glyph', text: s.def.glyph }),
          el('i', { class: 'sl-lvl', text: '●'.repeat(s.lvl) }),
        ] : el('span', { class: 'sl-plus', text: '+' }),
      );
      if (s) {
        node.title = `${s.def.name} Lv${s.lvl}`;
        node.addEventListener('click', () => {
          toast(s.def.label ? s.def.label(s.lvl) : `${s.def.name} Lv${s.lvl}`, '', 2200);   // ≤13 字：完整描述在图鉴
        });
      }
      bar.appendChild(node);
    }
    // 套装进度（差一张 = 发光诱导 chase）
    const counts = Engine.G.mods.sets;
    const prog = el('div', { class: 'set-prog' });
    for (const k of ['whale', 'seer', 'econ']) {
      if (counts[k] > 0) {
        const near = counts[k] === 1 || counts[k] === 3 || counts[k] === 5;
        const nextN = counts[k] < 2 ? 2 : counts[k] < 4 ? 4 : 6;
        prog.appendChild(el('span', {
          class: 'sp ' + k + (near ? ' near' : ''),
          text: `${MC.Buffs.SCHOOLS[k].icon}${counts[k]}`,
          title: near ? `再来 1 张${MC.Buffs.SCHOOLS[k].name.replace('流', '')}卡触发「${MC.Buffs.SETS[k][nextN].name}」` : '',
        }));
      }
    }
    if (Engine.G.mods.hiddenSets.length) {
      prog.appendChild(el('span', { class: 'sp hidden-set', text: '✦ ' + Engine.G.mods.hiddenSets.map(h => h.name).join(' ') }));
    }
    bar.appendChild(prog);
  }

  /* 卡牌飞入槽位（FLIP）+ 槽位落定爆点 */
  function flyCardToSlot(d) {
    const cards = $$('#buff-cards .buff-card');
    let card = null;
    for (const c of cards) { const n = $('.bc-name', c); if (n && n.textContent === d.def.name) { card = c; break; } }
    const slotNode = $(`#slots-bar .slot[data-i="${d.slotIdx}"]`);
    if (!card || !slotNode) return;
    const r1 = card.getBoundingClientRect(), r2 = slotNode.getBoundingClientRect();
    if (!r1.width || !r2.width) return;
    const fly = card.cloneNode(true);
    fly.classList.add('fly-card');
    fly.classList.remove('locked');
    fly.style.cssText += `position:fixed;left:${r1.left}px;top:${r1.top}px;width:${r1.width}px;height:${r1.height}px;z-index:400;pointer-events:none;margin:0;`;
    document.body.appendChild(fly);
    const dx = (r2.left + r2.width / 2) - (r1.left + r1.width / 2);
    const dy = (r2.top + r2.height / 2) - (r1.top + r1.height / 2);
    const scale = Math.max(0.12, r2.width / r1.width);
    const anim = fly.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.6}px, ${dy * 0.5 - 60}px) scale(${(1 + scale) / 2}) rotate(-6deg)`, opacity: 0.95, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(4deg)`, opacity: 0.2 },
    ], { duration: 480, easing: 'cubic-bezier(.45,.05,.55,.95)' });
    anim.onfinish = () => {
      fly.remove();
      // 槽位落定：pop + 粒子 + 浮字
      slotNode.classList.remove('pop'); void slotNode.offsetWidth; slotNode.classList.add('pop');
      const r = slotNode.getBoundingClientRect();
      const schoolColors = { whale: '#ff5c5c', seer: '#b18aff', econ: '#ffd166', wild: '#66d9ff' };
      fx.burst(r.left + r.width / 2, r.top + r.height / 2, 14, [schoolColors[d.def.school] || '#fff', '#ffffff'], 4);
      floatText(r.left + r.width / 2, r.top, d.lvl > 1 ? `Lv${d.lvl}!` : d.def.icon + ' 入手', d.lvl > 1 ? 'gold' : 'good');
      if (d.lvl > 1) { slotNode.classList.add('lvup'); setTimeout(() => slotNode.classList.remove('lvup'), 1200); }
      updateMultBadge();
    };
  }

  /* ═══════════ 构筑（buff 选择）层 ═══════════ */
  function renderOffer(st) {
    const wrap = $('#buff-cards');
    wrap.innerHTML = '';
    const owned = {};
    for (const s of st.slots) if (s) owned[s.def.id] = s.lvl;
    const slotsFull = st.slots.every(s => s);
    const mods = Engine.G ? Engine.G.mods : MC.Buffs.computeMods(st.slots);
    const schoolCount = { whale: 0, seer: 0, econ: 0, wild: 0 };
    for (const s of st.slots) if (s) schoolCount[s.def.school]++;
    const canAffordAny = st.cards.some((d, i) => (st.prices[i] || 0) <= st.cash + 0.25 * Math.max(st.equity || 0, 0));

    st.cards.forEach((def, i) => {
      const own = owned[def.id];
      const price = st.prices[i] || 0;
      const afford = price <= st.cash + 0.25 * Math.max(st.equity || 0, 0);
      const loan = afford && price > st.cash;

      // 倍率预览：拿下这张后 ×A → ×B / 新条件源
      const pv = MC.Buffs.preview(st.slots, def, mods);
      const prevChips = [];
      if (own === undefined || own < 3) {
        if (pv.baseNext - pv.baseNow > 0.001) prevChips.push(`×${pv.baseNow.toFixed(2)}→${pv.baseNext.toFixed(2)}`);
        for (const c of pv.newConds.slice(0, 2)) prevChips.push(`${c.icon} ×${(+c.val).toFixed(2)}`);
      }
      // 套装追逐：这张卡会凑齐 2/4/6？
      let setChip = null;
      if (!own && def.school !== 'wild') {
        const n = schoolCount[def.school] + 1;
        if (n === 2 || n === 4 || n === 6) {
          const setName = MC.Buffs.SETS[def.school][n].name;
          setChip = `${MC.Buffs.SCHOOLS[def.school].glyph} 套装「${setName}」`;
        }
      }

      const card = el('div', {
        class: `buff-card r${def.rarity} ${def.school}` + (st.locked[i] ? ' locked' : '') + (own >= 3 ? ' maxed' : '') + (!afford && own !== 3 ? ' poor' : ''),
      },
        el('div', { class: 'bc-glow' }),
        el('div', { class: 'bc-top' },
          el('span', { class: 'bc-school', text: MC.Buffs.SCHOOLS[def.school].name }),
          el('span', { class: 'bc-rarity', text: MC.Buffs.RARITY[def.rarity] }),
        ),
        prevChips.length ? el('div', { class: 'bc-mult', text: prevChips[0] }) : null,
        el('div', { class: 'bc-icon' }, el('span', { class: 'bc-emoji', text: def.icon }), el('span', { class: 'bc-glyph', text: def.glyph })),
        el('h3', { class: 'bc-name' + (def.name.length >= 6 ? ' long' : ''), text: def.name }),
        el('div', { class: 'bc-sub', text: def.sub }),
        el('p', { class: 'bc-desc', text: MC.Buffs.descOf(def, own ? Math.min(own + 1, 3) : 1) }),
        setChip ? el('div', { class: 'bc-set-chip', text: setChip }) : null,
        prevChips.length > 1 ? el('div', { class: 'bc-cond', text: prevChips[1] }) : null,
        own ? el('div', { class: 'bc-own', text: own >= 3 ? '已满级' : `Lv${own} → Lv${own + 1}` }) : null,
        el('button', { class: 'bc-lock' + (st.locked[i] ? ' on' : ''), html: '锁', title: '锁定（锁价）' }),
        el('button', {
          class: 'bc-pick' + (loan ? ' loan' : ''),
          html: own >= 3 ? '已满级' : `<b>${own ? '升级' : '拿下'}</b><small>${price > 0 ? '¥' + fmt.num(price) : '免费'}</small>`,
        }),
      );
      $('.bc-lock', card).addEventListener('click', e => { e.stopPropagation(); Engine.toggleLock(i); });
      card.addEventListener('click', () => tryPick(i));
      $('.bc-pick', card).addEventListener('click', e => { e.stopPropagation(); tryPick(i); });
      wrap.appendChild(card);
      // 发牌动画
      card.style.setProperty('--deal-i', i);
    });
    void canAffordAny;

    const cashWrap = $('#buff-cash-wrap');
    if (st.cash < -1) { cashWrap.innerHTML = `借贷中 <b class="neg">-${fmt.money(-st.cash)}</b>`; }
    else cashWrap.innerHTML = `资金 <b>${fmt.money(st.cash)}</b>`;
    $('#buff-mult-val').textContent = '×' + currentMultEstimate().toFixed(2);
    $('#buff-title').textContent = MC.Themes.copy.buffTitle || '选择一张内幕';
    const extraSub = slotsFull ? ' · 槽位已满' : '';
    $('#buff-sub').textContent = st.freeNext ? '免费刷新 · 必出史诗' : `第 ${st.round} 轮 · 可锁 1${extraSub}`;
    // 流派进度条：一眼看懂"我在玩什么流派、差几张成套"（点开流派图鉴）
    const sb = $('#school-bar');
    sb.innerHTML = '';
    for (const k of ['whale', 'seer', 'econ']) {
      const c = st.slots.filter(s => s && s.def.school === k).length;
      const S = MC.Buffs.SCHOOLS[k];
      const nextN = c < 2 ? 2 : c < 4 ? 4 : c < 6 ? 6 : 0;
      const near = c === 1 || c === 3 || c === 5;
      const item = el('button', {
        class: 'sb-item ' + k + (near ? ' near' : ''),
        title: nextN ? `再 ${nextN - c} 张${S.name}卡触发 ${nextN} 件套「${MC.Buffs.SETS[k][nextN].name}」· 点开图鉴` : '套装全开 · 点开图鉴',
        html: `<i>${S.glyph}</i><b>${c}</b><small>${nextN ? '→' + MC.Buffs.SETS[k][nextN].name : '套装全开'}</small>`,
      });
      item.addEventListener('click', openSchoolCodex);
      sb.appendChild(item);
    }
    const costBtn = $('#btn-reroll');
    const rrN = st.rerollIdx || 0;
    const skipAmt = Math.max(150, Math.round(st.equity * 0.015));
    $('#btn-skip-buff').innerHTML = `跳过 <small>持仓返 ${fmt.money(skipAmt)}</small>`;
    $('#reroll-cost').textContent = st.cost === 0 ? '免费' : fmt.money(st.cost) + (rrN > 0 ? ` ·刷${rrN + 1}` : '');
    costBtn.disabled = !(st.cost <= st.cash + 0.25 * Math.max(st.equity || 0, 0));
    costBtn.classList.toggle('free', st.cost === 0);
    costBtn.classList.toggle('hot', rrN >= 2);
  }

  function tryPick(i) {
    const res = Engine.pickOffer(i, replaceMode ? replaceMode.slotIdx : undefined);
    if (res === 'need-replace') {
      enterReplaceMode(i);
      return;
    }
    if (res === 'no-funds') {
      const card = $$('#buff-cards .buff-card')[i];
      if (card) { card.classList.remove('nope'); void card.offsetWidth; card.classList.add('nope'); }
      const cw = $('#buff-cash-wrap');
      if (cw) { cw.classList.remove('nope'); void cw.offsetWidth; cw.classList.add('nope'); }
      shake(2);
      return;
    }
    if (res === true) {
      replaceMode = null;
      closeBuffOverlay();
    }
  }

  function enterReplaceMode(offerIdx) {
    replaceMode = { offerIdx };
    $('#overlay-buffs').classList.add('replace-mode');
    const row = $('#replace-row');
    const wrap = $('#rr-slots');
    wrap.innerHTML = '';
    Engine.G.buffs.slots.forEach((s, i) => {
      if (!s) return;
      const chip = el('button', { class: 'rr-slot ' + s.def.school, title: s.def.name },
        el('span', { class: 'rr-icon', text: s.def.icon }),
        el('span', { text: s.def.name }),
        el('span', { class: 'rr-lvl', text: 'Lv' + s.lvl }),
      );
      chip.addEventListener('click', () => {
        const r = Engine.pickOffer(replaceMode.offerIdx, i);
        if (r === 'no-funds') { shake(2); return; }
        exitReplaceMode();
      });
      wrap.appendChild(chip);
    });
    row.hidden = false;
  }
  function exitReplaceMode() {
    if (!replaceMode) return;
    replaceMode = null;
    $('#overlay-buffs').classList.remove('replace-mode');
    $('#replace-row').hidden = true;
    renderSlots();
  }

  /* 覆盖层延时隐藏守卫：快速连开时旧 timer 不得误杀新开的层 */
  function hideOverlayLater(ov, ms) {
    clearTimeout(ov._hideT);
    ov._hideT = setTimeout(() => { ov.hidden = true; }, ms);
  }
  function openBuffOverlay() {
    const ov = $('#overlay-buffs');
    clearTimeout(ov._hideT);
    renderOffer(Engine.offerState());
    renderSlots();
    ov.hidden = false;
    // 入场防抖：连点「进入盘口」的第二下不许落在卡牌「拿下」上（曾 4/4 误买）
    ov.classList.add('arming');
    clearTimeout(ov._armT);
    ov._armT = setTimeout(() => ov.classList.remove('arming'), 380);
    requestAnimationFrame(() => ov.classList.add('show'));
    A.play('card');
  }
  function closeBuffOverlay() {
    const ov = $('#overlay-buffs');
    ov.classList.remove('show');
    hideOverlayLater(ov, 320);
    renderSlots();
    updateHUD();
  }

  /* ═══════════ 情报 chips ═══════════ */
  function renderHints(hints) {
    const stack = $('#hint-stack');
    stack.innerHTML = '';
    stack.classList.remove('expanded');
    const MAX = 3;
    hints.forEach((h, i) => {
      const chip = el('div', { class: 'hint-chip ' + (h.cls || '') + (h.bent ? ' bent' : '') + (i >= MAX ? ' extra' : ''), style: `--i:${i}` },
        el('span', { class: 'hc-icon', text: h.glyph || h.icon }),
        el('div', { class: 'hc-body' }, el('b', { text: h.title }), el('span', { text: h.text })),
      );
      stack.appendChild(chip);
      if (i === 0) A.play('hint');
    });
    if (hints.length > MAX) {
      const more = el('div', { class: 'hint-chip more', html: `<span class="hc-icon">…</span><div class="hc-body"><b>还有 ${hints.length - MAX} 条</b><span>展开</span></div>` });
      more.addEventListener('click', () => stack.classList.toggle('expanded'));
      stack.appendChild(more);
    }
    syncChart();
  }

  /* ═══════════ 风险档位 + 盘面读数 ═══════════ */
  function renderRiskRow() {
    const G = Engine.G; if (!G) return;
    const mode = G.player.riskMode;
    $$('#risk-row .risk-chip').forEach(c => {
      const on = c.dataset.risk === mode;
      c.classList.toggle('on', on);
      const r = Engine.RISK_MODES[c.dataset.risk];
      if (r) c.title = r.hint;
    });
  }
  /* 免费读盘：动量（近 5 tick）+ 波动率档位（近 10 tick 收益标准差）
     ——织布机行情该反着做、慢牛该顺着做，策略从这里长出来 */
  function tapeRead() {
    const G = Engine.G; if (!G) return '';
    const p = G.mkt.prices, rev = G.revealedTick;
    if (rev < 6) return '';
    const mom = p[rev] / p[rev - 5] - 1;
    const rets = [];
    for (let i = rev - 9; i <= rev; i++) if (i > 0) rets.push(p[i] / p[i - 1] - 1);
    let vol = 0;
    if (rets.length > 2) {
      const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
      vol = Math.sqrt(rets.reduce((a, b) => a + (b - mu) * (b - mu), 0) / rets.length);
    }
    // v1.4 按 v1.3 噪声重标三分位（旧阈值下 66% 的轮都是「高」）；动量写明是「上一段」——
    // 实测与本轮方向命中仅 50%，不能让新手误以为它在预测
    const vl = vol > 0.03 ? '高' : vol > 0.0155 ? '中' : '低';
    const arrow = mom > 0.004 ? '↑' : mom < -0.004 ? '↓' : '→';
    return `上一段 ${arrow}${(mom * 100).toFixed(1)}% · 波动${vl}`;
  }
  function updateRiskHint() {
    const n = $('#risk-hint');
    if (n) n.textContent = Engine.G && Engine.G.phase === 'act' ? tapeRead() : '';
  }
  /* 每轮下单后杠杆显示重置回 1x（下单是每轮的独立决策） */
  function resetLevDisplay() {
    const big = $('#lev-big');
    if (!big) return;
    big.innerHTML = '1<span>x</span>';
    big.classList.remove('danger');
    const nd = $('#lev-needle');
    if (nd) { nd.style.left = '0%'; nd.style.transform = 'translateX(-50%)'; }
    $('#buy-lev').textContent = '1x';
    $('#sell-lev').textContent = '1x';
    for (const sel of ['#btn-buy', '#btn-sell']) {
      const n = $(sel);
      n.classList.remove('charging');
      n.style.setProperty('--charge', 0);
    }
  }

  /* 止损/止盈自动离场演出（非阻塞） */
  function playStopOut(ev) {
    const tp = ev.type === 'tp';
    centerFlash(`<b>${tp ? '止盈落袋' : '止损离场'}</b><i>${fmt.signed(ev.pnl)}</i>`, tp ? 'long' : 'panic', 1000);
    if (tp) { vignette('gold', 600); fx.coins(26); A.play('win'); }
    else { vignette('red', 600); shake(5); A.play('panic'); }
  }

  /* ═══════════ 蓄力控制器 ═══════════ */
  function bindCharge(btnSel, dir) {
    const btn = $(btnSel);
    let t0 = 0, raf = 0, lastTap = 0, tapCount = 0;

    const steps = () => Engine.levSteps();

    function update() {
      if (!chargeState) return;
      const tiltAdj = Tremor.gyroOn ? Tremor.tilt * 0.3 : 0;
      const t = clamp((performance.now() - t0) / 2400 + tiltAdj, 0, 1);
      const ss = steps();
      const pos = Math.pow(t, 0.72) * (ss.length - 1);
      let idx = Math.round(pos);
      const lev = ss[idx];
      chargeState.t = t; chargeState.idx = idx; chargeState.lev = lev;

      // 手抖导致的视觉漂移
      const trem = Engine.G.mods.calm ? 0 : Tremor.value / 100;
      const jitter = trem * trem * 0.9;
      const shownIdx = clamp(idx + (Math.sin(performance.now() / 60) * jitter > 0.42 ? 1 : Math.sin(performance.now() / 60) * jitter < -0.42 ? -1 : 0), 0, ss.length - 1);

      $('#lev-big').innerHTML = `${ss[shownIdx]}<span>x</span>`;
      $('#lev-big').classList.toggle('danger', ss[shownIdx] >= 50);
      const needle = $('#lev-needle');
      needle.style.left = (pos / (ss.length - 1) * 100) + '%';
      needle.style.transform = `translateX(-50%) rotate(${(Math.random() - 0.5) * jitter * 30}deg)`;
      btn.classList.add('charging');
      btn.style.setProperty('--charge', t);
      $(dir > 0 ? '#buy-lev' : '#sell-lev').textContent = ss[shownIdx] + 'x';
      $('#lev-hint').textContent = lev >= 50 ? '强平线很近' : lev >= 10 ? '心跳加速了吗' : '按住…';
      Tremor.setStress(lev / 125);
      A.updateCharge(t, trem);
      updateHUD(false);
      raf = requestAnimationFrame(update);
    }

    function down(e) {
      if (Engine.phase !== 'act' || resolving) return;
      e.preventDefault();
      A.unlock();
      t0 = performance.now();
      chargeState = { dir };
      Tremor.startTilt();
      A.startCharge();
      btn.setPointerCapture && e.pointerId !== undefined && btn.setPointerCapture(e.pointerId);
      raf = requestAnimationFrame(update);
    }
    function up(e) {
      if (!chargeState) return;
      e && e.preventDefault && e.preventDefault();
      cancelAnimationFrame(raf);
      A.stopCharge();
      Tremor.setStress(0);
      btn.classList.remove('charging');
      btn.style.setProperty('--charge', 0);
      Tremor.stopTilt();
      $('#lev-hint').textContent = MC.Themes.copy.chargeHint;
      const held = performance.now() - t0;
      const st = chargeState; chargeState = null;
      $('#lev-big').classList.remove('danger');

      if (held < 150) {
        // 双击 = 恐慌全平（甩机清仓降级）
        const now = performance.now();
        if (now - lastTap < 340) {
          tapCount++;
          lastTap = 0;
          if (Engine.G.player.pos) {
            centerFlash('<b>恐慌全平！</b>', 'panic');
            Engine.closePosition(true);
            return;
          }
        } else { tapCount = 0; lastTap = now; }
        toast('长按蓄力', '', 1200);
        return;
      }
      lastTap = 0;

      // 手抖滑档
      let idx = st.idx;
      if (held < 260) idx = 0;   // v1.8.2 短按可达 1x：刻度表与可达档位一致（旧版 150–250ms 直接落 2x，1x 只是展示）
      const trem = Tremor.value;
      if (!Engine.G.mods.calm && trem > 55 && Math.random() < 0.35) {
        const slip = Math.random() < 0.5 ? -1 : 1;
        const newIdx = clamp(idx + slip, 0, steps().length - 1);
        if (newIdx !== idx) {
          idx = newIdx;
          toast(`手抖 · 滑到 ${steps()[idx]}x`, 'warn');
        }
      }
      Engine.openOrResize(dir, steps()[idx]);
    }
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }

  function renderLevNotches() {
    const track = $('.lev-track');
    $$('.lev-notch', track).forEach(n => n.remove());
    const ss = Engine.levSteps();
    ss.forEach((s, i) => {
      track.appendChild(el('u', { class: 'lev-notch', style: `left:${i / (ss.length - 1) * 100}%`, text: s + '' }));
    });
  }

  /* ═══════════ 结算轮演出（逐 tick 驱动） ═══════════ */
  async function runResolve() {
    if (resolving) return;
    if (!chart) return;   // v1.9.3 防御：裸驱引擎（控制台/探针）触发 phase:resolve 时图表会话可能未建立
    resolving = true;
    const sid = session;
    const stale = () => sid !== session;
    $('#dock').classList.add('disabled');
    const G = Engine.G;
    let lastPrice = Engine.price();
    let tickN = 0;

    const market = $('#market');
    while (true) {
      const info = Engine.stepTick();
      tickN++;
      chart.setRevealed(G.revealedTick);
      syncPosLines();
      updateHUD();
      // v1.8 排行榜 bot 权益改为轮末快照：逐 tick 实时权益 = 零成本方向 oracle（实测 73% 命中）
      syncCashout(info);

      // tick 音
      if (tickN % 2 === 0 || info.done) {
        A.play(info.price >= lastPrice ? 'tickUp' : 'tickDown');
      }
      lastPrice = info.price;

      // 浮动盈亏 → 行情屏边缘辉光（红绿呼吸，交易 app 的紧张感）
      const u = info.upnl || 0;
      const Er = Math.max(G.player.E_roundStart, 1);
      market.style.setProperty('--pnl-a', String(clamp(Math.abs(u) / Er * 1.5, 0, 0.5)));
      market.classList.toggle('glow-up', u > 0);
      market.classList.toggle('glow-down', u < 0);

      // 强平逼近警报
      if (info.liqNear > 0.55) { A.startAlarm(); market.classList.add('danger', 'pulse'); }
      else { A.stopAlarm(); market.classList.remove('pulse'); if (info.liqNear <= 0.2) market.classList.remove('danger'); }
      const vig = $('#fx-vignette');
      if (info.liqNear > 0.75) vig.classList.add('nearliq'); else vig.classList.remove('nearliq');

      if (info.events && info.events.length) {
        for (const ev of info.events) {
          if (ev.type === 'milestone') playMilestone(ev);   // 非阻塞庆祝
          else if (ev.type === 'sl' || ev.type === 'tp') playStopOut(ev);  // 非阻塞离场演出
          else await playDrama(ev);
          if (stale()) return;
        }
      }
      if (info.done) break;
      // 持仓时放慢节拍：落袋按钮要给人反应时间（crash 式张力来自「再等一根」）
      const delay = info.liqNear > 0.5 ? 220 : G.player.pos ? 160 : 78;
      await MC.sleep(delay);
      if (stale()) return;
      // 暂停 = 真冻结：行情演出挂起（v1.2 起逐 tick 是决策窗口，遮罩后继续走会造成实际损失）
      while (!$('#overlay-pause').hidden && !stale()) await MC.sleep(120);
      if (stale()) return;
    }
    A.stopAlarm();
    syncCashout(null);
    await waitPause(stale);   // v1.8 暂停冻结整条结算链（旧版轮末会在暂停层下推进到构筑）
    if (stale()) return;
    market.classList.remove('danger', 'pulse', 'glow-up', 'glow-down');
    market.style.setProperty('--pnl-a', '0');
    $('#fx-vignette').classList.remove('nearliq');

    const summary = Engine.settleRoundEnd();
    if (!summary) { // 被投降等外部流程抢先结算：静默收尾
      resolving = false;
      $('#dock').classList.remove('disabled');
      return;
    }
    updateRankStrip();
    await roundSummaryFlash(summary);
    if (stale()) return;
    await waitPause(stale);
    if (stale()) return;
    for (const ev of summary.pending) {
      await playTelegram(ev);
      if (stale()) return;
      await waitPause(stale);
      if (stale()) return;
    }
    renderSlots();
    resolving = false;
    $('#dock').classList.remove('disabled');
    Engine.nextRound();
  }

  /* v1.8 暂停门：结算链/电报/换幕在暂停层打开时挂起 */
  async function waitPause(stale) {
    while (!$('#overlay-pause').hidden && !stale()) await MC.sleep(120);
  }

  /* v1.2 盘中落袋：逐 tick 演出中的唯一交互。info=null → 收起 */
  function syncCashout(info) {
    const btn = $('#btn-cashout');
    const p = Engine.G && Engine.G.player;
    const on = !!(info && !info.done && p && p.pos && Engine.phase === 'resolve');
    btn.hidden = !on;
    if (!on) return;
    const u = info.upnl || 0;
    $('#co-val').textContent = fmt.signed(u);
    btn.classList.toggle('loss', u < 0);
    // 落袋代价：此刻落袋会作废的「活到收盘」类倍率（浮盈时才有意义）
    const cl = u > 0 ? Engine.cashLoss() : { n: 0 };
    const cost = $('#co-cost');
    cost.hidden = !(cl.n > 0);
    if (cl.n > 0) cost.textContent = `弃 ×${cl.mult.toFixed(2)}`;
  }
  let lastTradeAt = 0;   // v1.8.4 触屏幽灵落袋：touchend 的合成 click 会命中刚显示的落袋钮（40/40 秒平）
  function doCashout() {
    if (!resolving || Engine.phase !== 'resolve') return false;
    if (performance.now() - lastTradeAt < 450) return false;   // 开仓/反手后 450ms 内忽略落袋输入
    const ev = Engine.cashOut();
    if (!ev) return false;
    $('#btn-cashout').hidden = true;
    syncPosLines(); updateHUD();
    const win = ev.pnl >= 0;
    centerFlash(`<b>${win ? '落袋为安' : '割肉离场'}</b><i>${fmt.signed(ev.pnl)}</i>`, win ? 'long' : 'panic', 900);
    const r = ev.pnl / Math.max(Engine.G.player.E_roundStart, 1);
    if (win && r > 0.01) { vignette('gold', 500); fx.coins(Math.min(40, 10 + Math.round(r * 160))); A.play('win'); }
    else if (win) A.play('trade');
    else { shake(3); A.play('panic'); }
    return true;
  }

  /* 身家里程碑：非阻塞全屏庆祝 */
  function playMilestone(ev) {
    const labels = { 2: '翻倍', 3: '三倍身家', 5: '五倍传说', 10: '十倍神话', 20: '名人堂', 50: '金融史册', 100: '传奇本奇' };
    centerFlash(`<b>×${ev.mult}</b><i>${labels[ev.mult] || '里程碑'}</i>`, 'milestone', 1400);
    vignette('gold', 900);
    shake(7);
    A.play('milestone');
    const c = MC.Themes.current.chart || {};
    fx.confetti(c.up ? c.up.body : '#22e58a', '#ffd166');
    floatFrom($('#hud-equity'), `×${ev.mult} !`, 'gold', true);
  }

  /* 轮末结算：倍率引擎逐源演出（Balatro 式计分序列） */
  async function roundSummaryFlash(s) {
    const cls = s.pnl > 0 ? 'good' : s.pnl < 0 ? 'bad' : '';
    const hasSeq = s.mult && s.mult.steps && s.mult.steps.length;
    $$('.center-flash').forEach(n => n.remove());   // 盘中闪字不压在轮末小结下面
    $$('.center-flash').forEach(n => n.remove());   // v1.8.2 结算入场清场：body 级 flash 不叠第一幕
    $('#pos-card').classList.add('dim');   // v1.8.6 小结期间仓位卡让位（携带轮副行曾被不透明卡底遮住）
    const node = el('div', { class: 'round-summary ' + cls + (hasSeq ? ' score' : '') });
    $('#app').appendChild(node);
    requestAnimationFrame(() => node.classList.add('in'));

    let skipped = false;
    node.addEventListener('click', () => { skipped = true; });
    const wait = ms => new Promise(r => {
      const t0 = performance.now();
      (function ck() { if (skipped || performance.now() - t0 >= ms) return r(); requestAnimationFrame(ck); })();
    });

    if (!hasSeq) {
      node.innerHTML = `<div class="rs-main ${cls}">${fmt.pct(s.playerPct)}</div><div class="rs-sub">${fmt.signed(s.pnl)} · 第 ${s.round}/15 轮</div>`;
      if (s.notes.length) node.appendChild(el('div', { class: 'rs-notes', html: s.notes.map(n => `<i class="${n.cls}">${n.text}</i>`).join('') }));
      A.play(s.pnl > 0 ? 'win' : s.pnl < 0 ? 'lose' : 'click');
      if (s.pnl > 0 && s.playerPct > 0.3) { const c = MC.Themes.current.chart || {}; fx.confetti(c.up ? c.up.body : '#22e58a', c.down ? c.down.body : '#ff4d6d'); }
      if (s.pnl < 0 && s.playerPct < -0.25) { vignette('red', 700); shake(5); }
      await wait(s.notes.length ? 2200 : 1500);
      node.classList.remove('in');
      await MC.sleep(320); node.remove();
      $('#pos-card').classList.remove('dim');
      return;
    }

    /* ── 计分序列 ── */
    const m = s.mult;
    const mainNode = el('div', { class: 'rs-main good', text: fmt.signed(m.base) });
    const labelNode = el('div', { class: 'rs-sub', text: `第 ${s.round}/15 轮 · 交易盈亏` });
    const stepsNode = el('div', { class: 'rs-steps' });
    node.appendChild(mainNode); node.appendChild(labelNode); node.appendChild(stepsNode);

    A.play('scoreStep', 0);
    await wait(560);

    let running = m.base, addSum = 0, stepI = 0;
    for (const step of m.steps) {
      const prev = running;
      if (step.op === '+') { addSum += step.val; running = m.base * (1 + addSum); }
      else running *= step.val;
      const row = el('div', {
        class: 'rs-step' + (step.crit ? ' crit' : '') + (step.op === 'x' ? ' mul' : ' add'),
        html: `<i>${step.icon}</i><span>${step.name}</span><b>${step.op === '+' ? '+' + step.val.toFixed(2) + 'x' : '×' + (+step.val).toFixed(2)}</b>`,
      });
      stepsNode.appendChild(row);
      requestAnimationFrame(() => row.classList.add('in'));

      // 点亮来源槽位
      const slotNode = step.slotIdx != null ? $(`#slots-bar .slot[data-i="${step.slotIdx}"]`) : null;
      if (slotNode) { slotNode.classList.add('scoring'); }
      if (step.crit) {
        A.play('crit'); vignette('gold', 800); shake(8);
        centerFlash('<b>会心一击！</b>', 'crit', 900);
        row.classList.add('in');
      } else {
        A.play('scoreStep', stepI + 1);
        floatFrom(row, step.op === '+' ? '+' + step.val.toFixed(2) + 'x' : '×' + (+step.val).toFixed(2), 'mult');
      }
      MC.rollNumber(mainNode, prev, running, 260, v => fmt.signed(v));
      stepI++;
      await wait(step.crit ? 620 : 340);
      if (slotNode) slotNode.classList.remove('scoring');
      if (skipped) {
        // 快进：剩余步骤立即补完
        for (const rest of m.steps.slice(stepI)) {
          if (rest.op === '+') { addSum += rest.val; running = m.base * (1 + addSum); } else running *= rest.val;
          stepsNode.appendChild(el('div', { class: 'rs-step in ' + (rest.op === 'x' ? 'mul' : 'add') + (rest.crit ? ' crit' : ''), html: `<i>${rest.icon}</i><span>${rest.name}</span><b>${rest.op === '+' ? '+' + rest.val.toFixed(2) + 'x' : '×' + (+rest.val).toFixed(2)}</b>` }));
        }
        stepI = m.steps.length;
        running = m.base * m.total;
        break;
      }
    }

    // 终值
    const finalPnl = m.base * m.total;
    labelNode.innerHTML = `倍率 <b class="rs-mult-total">×${m.total.toFixed(2)}</b> · 加成 +${fmt.money(m.gain)}`;
    MC.rollNumber(mainNode, running, s.pnl, 380, v => fmt.signed(v));
    A.play('scoreFinal');
    $('#mult-badge') && $('#mult-badge').classList.add('bump');
    if (m.total >= 2) { shake(6); const c = MC.Themes.current.chart || {}; fx.confetti(c.up ? c.up.body : '#22e58a', '#ffd166'); }
    else if (s.playerPct > 0.3) { const c = MC.Themes.current.chart || {}; fx.confetti(c.up ? c.up.body : '#22e58a', c.down ? c.down.body : '#ff4d6d'); }
    if (s.notes.length) node.appendChild(el('div', { class: 'rs-notes', html: s.notes.map(n => `<i class="${n.cls}">${n.text}</i>`).join('') }));
    updateHUD();
    await wait(s.notes.length ? 1900 : 1400);
    node.classList.remove('in');
    await MC.sleep(320); node.remove();
    $('#pos-card').classList.remove('dim');   // v1.8.7 计分分支收尾也恢复仓位卡（v1.8.6 漏：dim 泄漏整轮）
    void stepI;
  }

  /* ═══════════ 监管电报 ═══════════ */
  function playTelegram(ev) {
    const copy = MC.Themes.copy;
    const gen = copy.telegramText[ev.kind] || (() => ({ title: '监管事件', body: '' }));
    const t = gen(ev);
    const tg = copy.telegram;
    return new Promise(res => {
      const ov = $('#overlay-telegram');
      $('#tg-agency').textContent = tg.agency;
      $('#tg-kicker').textContent = tg.kicker;
      $('#tg-stamp').textContent = tg.stamp;
      $('#tg-code').textContent = 'No.' + String(Engine.G ? Engine.G.round : 0).padStart(3, '0') + '-' + ev.kind.toUpperCase();
      $('#tg-title').textContent = t.title;
      const body = $('#tg-body');
      body.textContent = '';
      clearTimeout(ov._hideT);
      ov.hidden = false;
      requestAnimationFrame(() => ov.classList.add('show'));
      A.play('notif');
      // 打字机
      let i = 0;
      const text = t.body;
      const typer = setInterval(() => {
        if (i >= text.length) {
          clearInterval(typer);
          $('#telegram').classList.add('stamped');
          A.play('stamp');
          $('#tg-ok').classList.add('ready');
          return;
        }
        body.textContent += text[i];
        if (text[i] !== '\n' && text[i] !== ' ' && i % 2 === 0) A.typeTick();
        i++;
      }, 34);
      $('#tg-ok').onclick = () => {
        clearInterval(typer);
        ov.classList.remove('show');
        $('#telegram').classList.remove('stamped');
        $('#tg-ok').classList.remove('ready');
        clearTimeout(ov._hideT);
        ov._hideT = setTimeout(() => { ov.hidden = true; res(); }, 280);
      };
    });
  }

  /* ═══════════ 剧情层（爆仓/救市/隐藏套装） ═══════════ */
  function playDrama(ev) {
    const cfg = {
      liquidated: {
        icon: '爆', title: '爆 仓', cls: 'drama-liq',
        body: '维持保证金不足，仓位被强制平掉。',
        num: `残存 ${fmt.money(Engine.G.player.cash)}`,
        sound: 'bust',
      },
      revive: {
        icon: '破', title: '破产重整', cls: 'drama-revive',
        body: '「破产重整」生效，保住 20% 家当。',
        num: `复活资金 ${fmt.money(Engine.G.player.cash)}`,
        sound: 'rescue',
      },
      rescue: {
        icon: '救', title: '国家队进场', cls: 'drama-rescue',
        body: '神秘力量托住了盘面。「稳定市场，人人有责。」',
        num: `救市资金 ${fmt.money(Engine.G.player.cash)}`,
        sound: 'rescue',
      },
      losscap: {
        icon: '护', title: '大而不倒', cls: 'drama-cap',
        body: '巨鲸 6 件套：本轮亏损封顶 15%。',
        num: `损失封顶 ${fmt.signed(ev.loss || 0)}`,
        sound: 'setbonus',
      },
    }[ev.type];
    if (!cfg) return Promise.resolve();
    return showDramaOverlay(cfg);
  }

  function showDramaOverlay(cfg) {
    return new Promise(res => {
      const ov = $('#overlay-drama');
      const box = $('#drama');
      box.className = 'drama ' + (cfg.cls || '');
      $('#drama-icon').textContent = cfg.icon;
      $('#drama-title').textContent = cfg.title;
      $('#drama-body').textContent = cfg.body;
      $('#drama-num').textContent = cfg.num || '';
      clearTimeout(ov._hideT);
      ov.hidden = false;
      requestAnimationFrame(() => ov.classList.add('show'));
      A.play(cfg.sound || 'bust');
      if (cfg.cls === 'drama-liq') {
        const c = MC.Themes.current.chart || {};
        fx.burst(innerWidth / 2, innerHeight / 2, 60, [c.down ? c.down.body : '#ff4d6d', '#333', '#900'], 9);
        shake(13); vignette('red', 1100);
      } else if (cfg.cls === 'drama-rescue' || cfg.cls === 'drama-revive') {
        vignette('gold', 800);
      }
      $('#drama-ok').onclick = () => {
        ov.classList.remove('show');
        clearTimeout(ov._hideT);
        ov._hideT = setTimeout(() => { ov.hidden = true; res(); }, 260);
      };
    });
  }

  function showHiddenSet(h) {
    return showDramaOverlay({
      icon: '✦', title: '隐藏流派 · ' + h.name, cls: 'drama-hidden',
      body: h.desc, num: '构筑已入殿堂', sound: 'setbonus',
    });
  }

  /* ═══════════ 结算页：四幕步进（结局 → 回放 → 颁奖 → 复盘） ═══════════
     每幕一屏、点按推进，长内容只留在最后一幕——不再让用户滑十屏找"再来一局" */
  async function showResults(res) {
    showScreen('result');
    const wrap = $('#result-scroll');
    wrap.innerHTML = '';
    const theme = MC.Themes.current;
    const mult = res.mult;
    const pager = el('div', { class: 'res-pager' });
    wrap.appendChild(pager);
    const steps = [], enterHooks = [];
    function addStep(cls, build, hook) {
      const d = el('div', { class: 'res-step ' + (cls || '') });
      build(d);
      steps.push(d); enterHooks.push(hook || null);
      pager.appendChild(d);
      return d;
    }

    // ── 第一幕 · 结局 ──
    addStep('st-final', d => {
      d.innerHTML = `
        <div class="res-banner ${mult >= 1 ? 'win' : 'lose'}">
          <div class="rb-kicker">${res.surrenderedAt ? `第 ${res.surrenderedAt} 轮提前离场 · 按现价平仓` : (theme.copy.resultKicker || '本局终了 · 强制平仓')}</div>
          <div class="rb-line"><span>本金</span><b>${fmt.money(res.start)}</b></div>
          <div class="rb-line peak"><span>巅峰</span><b>${fmt.money(res.peak)}</b></div>
          <div class="rb-final"><b>${fmt.money(res.finalEq)}</b><i class="rb-mult ${mult >= 1 ? 'good' : 'bad'}">${mult.toFixed(2)}x</i></div>
          <div class="rb-verdict">${mult >= 3 ? '传奇。请受我一拜。' : mult >= 1.5 ? '跑赢 95% 的韭菜。' : mult >= 1 ? '活着出来就是胜利。' : mult >= 0.5 ? '交点学费，不贵。' : '市场谢谢你。'}</div>
        </div>
        <div class="res-quick">
          <span>交易 <b>${res.stats.trades}</b> 笔</span>
          <span>方向胜率 <b>${Math.round((res.stats.accuracy || 0) * 100)}%</b></span>
          <span>最高杠杆 <b>${res.stats.maxLev}x</b></span>
          <span>爆仓 <b>${res.stats.liqs}</b> 次</span>
          <span>监管 <b>${res.stats.regs}</b> 次</span>
          ${res.stats.tpBonusTotal > 0.5 ? `<span>落袋奖金 <b>${fmt.money(res.stats.tpBonusTotal)}</b></span>` : ''}
        </div>`;
    }, () => {
      A.play(mult >= 1 ? 'fanfare' : 'lose');
      if (mult >= 1.5) { const c = theme.chart || {}; fx.confetti(c.up ? c.up.body : '#22e58a', '#ffd166'); }
    });

    // ── 第二幕 · 生涯回放 + 名场面揭晓 ──
    addStep('st-replay', d => {
      d.appendChild(el('h3', { class: 'rs-title', text: '权益曲线' }));
      d.appendChild(el('div', { class: 'curve-box' }, el('canvas', { id: 'res-curve' })));
      const rev = res.scenario;
      d.appendChild(el('h3', { class: 'rs-title', text: '名场面' }));
      const revealCard = el('div', { class: 'reveal-card', html: `
        <div class="rc-back"><span class="rc-q">？？？</span><i>改编自真实历史<br>点击揭晓</i></div>
        <div class="rc-front">
          <div class="rc-kicker">${theme.copy.revealKicker || '历史重演'}</div>
          <h3>${rev.reveal}</h3>
          <p class="rc-fact">${rev.fact}</p>
          ${rev.origin ? `<p class="rc-origin">原型 · ${rev.origin}</p>` : ''}
          <div class="rc-stats">
            <span>区间涨跌 <b>${fmt.pct(res.totalRet)}</b></span>
            <span>最大回撤 <b>-${(rev.stats.maxDD * 100).toFixed(0)}%</b></span>
            <span>躺平持有 <b>${fmt.money(res.buyHold)}</b></span>
            <span>你的结局 <b class="${res.finalEq >= res.buyHold ? 'good' : 'bad'}">${fmt.money(res.finalEq)}</b></span>
          </div>
          <div class="rc-verdict">${res.finalEq >= res.buyHold * 1.5 ? '你跑赢了这段历史。' : res.finalEq >= res.buyHold ? '你赢了「躺平持有」。' : '躺平党赢了。'}</div>
        </div>` });
      d.appendChild(revealCard);
      revealCard.addEventListener('click', () => {
        if (revealCard.classList.contains('flipped')) return;
        revealCard.classList.add('flipped');
        A.play('reveal');
      });
    }, () => {
      // 进入本幕才画曲线（canvas 需要可见尺寸）
      requestAnimationFrame(() => {
        const cv = $('#res-curve');
        if (!cv) return;
        const pts = downsample(res.tickCurve, 120).map((p, i, arr) => ({ round: i / (arr.length - 1) * 15, eq: p.eq }));
        const markers = [];
        const peakI = pts.reduce((b, p, i) => p.eq > pts[b].eq ? i : b, 0);
        markers.push({ round: pts[peakI].round, icon: '峰', label: '巅峰' });
        (res.regRounds || []).forEach(rr => markers.push({ round: rr.round, icon: '监' }));
        (res.liqRounds || []).forEach(lr => markers.push({ round: lr, icon: '爆' }));
        MC.Chart.drawEquityCurve(cv, pts, Object.assign({}, MC.Chart.DEFAULT_STYLE, theme.chart), { start: res.start, markers });
      });
    });

    // ── 第三幕 · 颁奖 + 风格画像 ──
    addStep('st-awards', d => {
      d.appendChild(el('h3', { class: 'rs-title', text: '颁奖典礼' }));
      const grid = el('div', { class: 'award-grid' });
      res.awards.forEach((a, i) => {
        grid.appendChild(el('div', { class: 'award-card', style: `--i:${i}`, html: `<span class="aw-icon">${a.icon}</span><b>${a.name}</b><i>${a.desc}</i>` }));
      });
      d.appendChild(grid);
      const pf = res.profile;
      d.appendChild(el('h3', { class: 'rs-title', text: '风格画像' }));
      d.appendChild(el('div', { class: 'profile-card', html: `
        <div class="pf-main"><b>${pf.pct}%</b><span>${pf.title}</span></div>
        <div class="pf-sub">+ ${pf.subPct}% ${pf.sub}</div>
        <div class="pf-bars">${pf.all.slice(0, 4).map(x => `<div class="pf-bar"><label>${x.k}</label><i style="width:${x.v}%"></i><b>${x.v}%</b></div>`).join('')}</div>
        <div class="pf-figure">你最像 <b>${pf.figure}</b><i>${pf.figureDesc}</i></div>` }));
      d._awardGrid = grid;
    }, d => revealAwards(d._awardGrid, res.awards.length));

    // ── 第四幕 · 毒舌复盘 + 明细 + 操作 ──
    addStep('st-recap', d => {
      d.appendChild(el('h3', { class: 'rs-title', text: theme.copy.roastTitle || '毒舌复盘' }));
      d.appendChild(el('div', { class: 'roast-card' }, el('p', { id: 'roast-text' })));
      d.appendChild(el('h3', { class: 'rs-title', text: '最终排名' }));
      const table = el('div', { class: 'final-standings' });
      res.standings.forEach(r => {
        table.appendChild(el('div', { class: 'fs-row' + (r.id === 'you' ? ' you' : ''), html: `<span class="fs-rk">${r.rank}</span><span class="fs-av">${r.alive === false ? '💀' : r.avatar}</span><span class="fs-nm">${r.name}</span><b class="fs-eq ${r.eq >= 10000 ? 'good' : 'bad'}">${fmt.money(Math.max(r.eq, 0))}</b>` }));
      });
      d.appendChild(table);
      if (res.slots.length) {
        d.appendChild(el('h3', { class: 'rs-title', text: '本局构筑' }));
        d.appendChild(el('div', { class: 'build-row', html: res.slots.map(s => `<span class="br-chip ${s.school}"><em>${s.glyph || s.icon}</em>${s.name} <i>Lv${s.lvl}</i></span>`).join('') + (res.setNames.length ? `<span class="br-sets">${res.setNames.map(s => `「${s.name}」`).join(' ')}</span>` : '') }));
      }
      const me = res.multEngine;
      if (me && (me.maxMult > 1.01 || me.spent > 0 || me.rerolls > 0)) {
        const chain = me.bestChain;
        d.appendChild(el('h3', { class: 'rs-title', text: '倍率引擎' }));
        d.appendChild(el('div', { class: 'me-card', html: `
          <div class="me-row"><span>单轮最高</span><b class="me-big">×${me.maxMult.toFixed(2)}</b></div>
          ${chain ? `<div class="me-row"><span>最爽一轮</span><b>第 ${chain.round} 轮 · ${fmt.signed(chain.base)} → ${fmt.signed(chain.base + chain.gain)}</b></div>` : ''}
          ${me.snowMult > 0 ? `<div class="me-row"><span>雪球终值</span><b>+${me.snowMult.toFixed(2)}x</b></div>` : ''}
          <div class="me-row"><span>构筑投入</span><b>${fmt.money(me.spent)}${me.rerolls ? ` · 刷 ${me.rerolls}` : ''}</b></div>
          ${me.crits ? `<div class="me-row"><span>暴击</span><b>×${me.crits}</b></div>` : ''}
          ${me.milestones ? `<div class="me-row"><span>里程碑</span><b>×${me.milestones}</b></div>` : ''}
          ${res.stats.stops || res.stats.tps ? `<div class="me-row"><span>止损/止盈</span><b>${res.stats.stops || 0} / ${res.stats.tps || 0}</b></div>` : ''}
        ` }));
      }
      const act = el('div', { class: 'res-actions' },
        el('button', { class: 'btn btn-ghost', id: 'btn-poster', text: '分享长图' }),
      );
      d.appendChild(act);
      // 注意：build 期间 d 尚未入树，按钮必须在 d 子树内查
      $('#btn-poster', d).onclick = () => makePoster(res);
    }, () => typewriter($('#roast-text'), composeRoast(res), 22));

    // ── 步进导航 ──
    const dots = el('div', { class: 'res-dots' });
    steps.forEach(() => dots.appendChild(el('i')));
    /* 底部导航始终只有两个去向：回到主界面 / 下一幕（终幕变「再来一局」）——
       旧版「跳过演出」语义含糊（跳到哪？），终幕的两个出口必须一眼看懂 */
    const nextBtn = el('button', { class: 'btn btn-primary res-next', id: 'res-next', text: '看回放' });
    const homeBtn = el('button', { class: 'btn btn-ghost res-home', id: 'res-home', text: '回到主界面' });
    wrap.appendChild(el('div', { class: 'res-nav' }, dots, homeBtn, nextBtn));

    let cur = -1;
    const NEXT_LABEL = ['看回放', '去领奖', '看复盘'];
    function goto(i) {
      if (i === cur || i < 0 || i >= steps.length) return;
      cur = i;
      steps.forEach((s, k) => { s.classList.toggle('on', k === i); if (k === i) s.scrollTop = 0; });
      $$('i', dots).forEach((n, k) => n.classList.toggle('on', k <= i));
      const last = i >= steps.length - 1;
      nextBtn.parentElement.classList.toggle('end', last);
      nextBtn.textContent = last ? (theme.copy.againBtn || '再来一局') : (NEXT_LABEL[i] || '继续');
      if (enterHooks[i]) enterHooks[i](steps[i]);
    }
    nextBtn.addEventListener('click', () => {
      A.play('click');
      if (cur >= steps.length - 1) startGame();   // 终幕主按钮 = 再来一局（零滚动触达）
      else goto(cur + 1);
    });
    homeBtn.addEventListener('click', () => { A.play('click'); renderTitle(); showScreen('title'); });
    goto(0);

    // 存档
    const save = MC.save.read();
    const career = save.career || { games: 0, bestEq: 0, bestMult: 0, liqs: 0 };
    career.games++;
    career.bestEq = Math.max(career.bestEq || 0, res.finalEq);
    career.bestMult = Math.max(career.bestMult || 0, res.mult);
    career.liqs = (career.liqs || 0) + res.stats.liqs;
    MC.save.write({ career });
  }

  async function revealAwards(grid, n) {
    for (let i = 0; i < n; i++) {
      const card = grid.children[i];
      card.classList.add('in');
      A.play('award');
      await MC.sleep(380);
    }
  }

  function typewriter(node, text, speed) {
    // 先占位再打字，避免下方布局抖动
    node.textContent = text;
    const h = node.scrollHeight;
    node.style.minHeight = h + 'px';
    node.textContent = '';
    let i = 0;
    const timer = setInterval(() => {
      node.textContent += text[i++];
      if (i % 3 === 0) A.typeTick();
      if (i >= text.length) clearInterval(timer);
    }, speed || 26);
  }

  function capSentences(j) {   // 红线 ≤4 句：按句截断（pop 等主题单元素含多句）
    const sentences = j.match(/[^。！…]+[。！…]?/g) || [j];
    return sentences.slice(0, 4).join('');
  }

  function composeRoast(res) {
    const s = res.stats;
    const theme = MC.Themes.current;
    if (theme.copy.roast) {
      try {
        const out = theme.copy.roast(s, res);
        const str = typeof out === 'string' && out ? out : (Array.isArray(out) && out.length ? out.join('') : '');
        if (str) return capSentences(str);   // v1.8.7 主题串也过句级上限（旧早退让 slice 成死代码，pop 7 句）
      } catch (e) { /* fallthrough */ }
    }
    const L = [];
    L.push(`本金 ${fmt.money(res.start)} → 结局 ${fmt.money(s.finalEq)}，${s.finalEq >= res.start ? '居然没亏' : '亏出了节奏感'}。`);
    if (s.liqs > 0) L.push(`爆仓 ${s.liqs} 次，交易所想聘你压测。`);
    if (s.maxLev >= 50) L.push(`最高 ${s.maxLev}x，跟强平线赛跑。`);
    if (s.chase >= 3) L.push(`追涨 ${s.chase} 割肉 ${s.panic}，韭菜基因稳定表达。`);
    if (s.accuracy >= 0.7 && s.correctDirs + s.wrongDirs >= 5) L.push(`命中率 ${(s.accuracy * 100).toFixed(0)}%，你穿越了？`);
    else if (s.accuracy > 0 && s.accuracy < 0.35 && s.correctDirs + s.wrongDirs >= 4) L.push(`命中率 ${(s.accuracy * 100).toFixed(0)}%，反向指标也是指标。`);
    if (s.holdRounds >= 8) L.push(`${s.holdRounds} 轮不动，我管这叫禅修。`);
    if (s.fees > res.start * 0.04) L.push(`手续费 ${fmt.money(s.fees)}，年会给你留前排。`);
    if (s.maxHoldStreak >= 5 && s.holdRounds < 8) L.push(`连 ${s.maxHoldStreak} 轮装死，钻石手名不虚传。`);
    if (res.regLog && res.regLog.length >= 2) L.push(`惊动监管 ${res.regLog.length} 次，名字上了简报。`);
    if (s.rumorVictims > 0) L.push(`造势得手 ${s.rumorVictims} 次，市场听你的。`);
    if (s.maxMult >= 3) L.push(`单轮 ×${s.maxMult.toFixed(2)}，印钞机开机。`);
    if (s.snipes >= 2) L.push(`逃顶 ${s.snipes} 次，手比K线快。`);
    else if (s.cashouts >= 3 && s.cashSaved < 0) L.push(`落袋 ${s.cashouts} 次少赚 ${fmt.money(-s.cashSaved)}，卖飞专业户。`);
    if (s.crits >= 2) L.push(`暴击 ${s.crits} 次，建议代抽卡。`);
    if (s.spentBuffs > res.start * 0.6) L.push(`卡牌砸了 ${fmt.money(s.spentBuffs)}，氪佬实至名归。`);
    if (s.bonusTotal > res.start * 0.3) L.push(`被动收入 ${fmt.money(s.bonusTotal)}，构筑玩明白了。`);
    if (L.length < 3) L.push(`市场没有新鲜事，只有新鲜的你。`);
    return capSentences(L.slice(0, 6).join(''));
  }

  function downsample(arr, n) {
    if (arr.length <= n) return arr;
    const out = [], step = (arr.length - 1) / (n - 1);
    for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
    return out;
  }

  /* ═══════════ 分享长图 ═══════════ */
  function makePoster(res) {
    const W = 720, H = 1280;
    const cv = el('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const theme = MC.Themes.current;
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg').trim() || '#0a0a14';
    const ink = cs.getPropertyValue('--ink').trim() || '#fff';
    const up = (theme.chart && theme.chart.up && theme.chart.up.body) || '#22e58a';
    const down = (theme.chart && theme.chart.down && theme.chart.down.body) || '#ff4d6d';

    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    // 装饰
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, MC.Chart.hexA(res.mult >= 1 ? up : down, 0.16)); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    c.textAlign = 'center';
    c.fillStyle = ink;
    c.font = '900 64px ' + (cs.getPropertyValue('--font-display').trim().split(',')[0].replace(/['"]/g, '') || 'sans-serif');
    c.fillText(theme.copy.gameTitle || '全仓以赴', W / 2, 130);
    c.font = '400 24px sans-serif';
    c.globalAlpha = 0.6;
    c.fillText(theme.name + ' · ' + (res.scenario.name), W / 2, 175);
    c.globalAlpha = 1;

    // 数字
    c.font = '900 92px ui-monospace, monospace';
    c.fillStyle = res.mult >= 1 ? up : down;
    c.fillText(fmt.money(res.finalEq), W / 2, 320);
    c.font = '400 28px sans-serif';
    c.fillStyle = ink; c.globalAlpha = 0.75;
    c.fillText(`本金 ${fmt.money(res.start)} · 巅峰 ${fmt.money(res.peak)} · ${res.mult.toFixed(2)}x`, W / 2, 372);
    c.globalAlpha = 1;

    // 曲线
    const pts = downsample(res.tickCurve, 90);
    const padX = 70, y0 = 450, boxH = 300;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p.eq); hi = Math.max(hi, p.eq); }
    lo *= 0.9; hi *= 1.05;
    c.strokeStyle = res.mult >= 1 ? up : down; c.lineWidth = 4; c.lineJoin = 'round';
    c.beginPath();
    pts.forEach((p, i) => {
      const x = padX + (W - padX * 2) * i / (pts.length - 1);
      const y = y0 + (1 - (p.eq - lo) / (hi - lo)) * boxH;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.stroke();

    // 画像 + 奖项
    c.fillStyle = ink;
    c.font = '700 40px sans-serif';
    c.fillText(`${res.profile.pct}% ${res.profile.title} · 最像「${res.profile.figure}」`, W / 2, 850);
    c.font = '400 30px sans-serif';
    c.globalAlpha = 0.85;
    const awards = res.awards.map(a => a.icon + a.name).join('  ');
    wrapText(c, awards, W / 2, 910, W - 120, 42);
    c.globalAlpha = 1;

    // 揭晓
    c.font = '400 26px sans-serif';
    c.fillStyle = ink; c.globalAlpha = 0.7;
    c.fillText('改编自：' + res.scenario.reveal, W / 2, 1050);
    c.globalAlpha = 1;
    c.font = '400 22px sans-serif';
    c.globalAlpha = 0.5;
    c.fillText(`手抖峰值 ${Math.round(res.tremorPeak)} · 最高杠杆 ${res.stats.maxLev}x · 爆仓 ${res.stats.liqs} 次 · seed ${res.seed}`, W / 2, 1095);
    c.fillText('《全仓以赴》· 纯虚拟币 · 非投资建议', W / 2, 1220);
    c.globalAlpha = 1;

    cv.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `margincall-${res.seed}.png` });
      document.body.appendChild(a); a.click(); a.remove();
      toast('长图已保存', 'good');
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], 'margincall.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: '全仓以赴', text: `我把 ¥10,000 玩成了 ${fmt.money(res.finalEq)}` }).catch(() => { });
        }
      }
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }
  function wrapText(c, text, x, y, maxW, lh) {
    let line = '', ly = y;
    for (const ch of text) {
      if (c.measureText(line + ch).width > maxW) { c.fillText(line, x, ly); line = ch; ly += lh; }
      else line += ch;
    }
    c.fillText(line, x, ly);
  }

  /* ═══════════ 流派图鉴 ═══════════ */
  function openSchoolCodex() {
    const wrap = $('#school-scroll');
    if (!wrap.dataset.built) {
      const B = MC.Buffs;
      const BLURB = {
        whale: '更大保证金、更高杠杆、更宽止损。',
        seer: '看清本轮路径：方向、形态、最深回撤——决定杠杆开多大。',
        econ: '现金流雪球：前期苟住，后期被动碾压。',
      };
      let html = `<h2>三流派图鉴</h2>
        <p class="sch-intro">6 槽位 · 同流派 2/4/6 件成套装 · 每张卡都垫常驻倍率（构筑协同）</p>`;
      for (const k of ['whale', 'seer', 'econ']) {
        const S = B.SCHOOLS[k];
        html += `<div class="sch-sec ${k}"><h3><em>${S.glyph}</em>${S.name} · ${S.axis}</h3><p>${BLURB[k]}</p><ul>` +
          [2, 4, 6].map(n => `<li><b>${n} 件「${B.SETS[k][n].name}」</b>${B.SETS[k][n].desc}</li>`).join('') +
          `</ul></div>`;
      }
      html += `<div class="sch-sec wild"><h3><em>混</em>通用 · 混沌</h3><p>快乐池：20% 出现率，防构筑锁死。</p></div>`;
      html += `<div class="sch-sec hidden-set"><h3><em>✦</em>隐藏混合流派（社区自挖）</h3><ul>
        <li><b>巨鲸3+先知3「坐庄」</b>持仓牵引行情 1%/轮；内幕永指你的方向；+0.35x。</li>
        <li><b>先知3+复利3「量化基金」</b>持情报的盈利轮 ×1.4。</li>
        <li><b>通用6「散户之光」</b>数值效果 ×1.5；+0.6x。</li></ul></div>`;
      html += `<div class="sch-sec risk"><h3><em>险</em>风险四档（下单坞）</h3><ul>
        <li><b>裸奔</b>无止损；盈利轮 ×1.15；手动割肉收 ${Math.round(MC.Engine.cutFee * 100)}% 行权费。</li>
        <li><b>止损</b>损 13% 或盈 13% 自动全平（默认，对称）+ 利润锁阶梯。</li>
        <li><b>只割不锁</b>损 13% 自动割、上行不限；开仓收 2% 保费。</li>
        <li><b>双保险</b>损 10% / 盈 10% 自动，手续费减半。</li></ul>
        <p>每单保证金 = 身家 40%：下错亏仓位，不亏身家。</p></div>`;
      wrap.innerHTML = html;
      wrap.dataset.built = '1';
    }
    const ov = $('#overlay-school');
    clearTimeout(ov._hideT);
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add('show'));
    A.play('hint');
  }

  /* ═══════════ 帮助 ═══════════ */
  function showHelp() {
    const copy = MC.Themes.copy;
    $('#help-scroll').innerHTML = `
      <h2>${copy.gameTitle || '全仓以赴'} · 玩法</h2>
      <div class="help-sec"><h3><i>01</i>目标</h3><p>本金 ¥1 万，15 轮；名场面行情盲开（每局镜像/换序），局末揭晓。<b>活着，变富</b>。</p></div>
      <div class="help-sec"><h3><i>02</i>构筑</h3><p>每轮 3 张卡<b>按身家定价</b>；同流派 2/4/6 件成套。可锁、刷新、跳过（持仓才返）、借贷。</p></div>
      <div class="help-sec"><h3><i>03</i>倍率</h3><p>盈利轮 = 盈亏 ×(1+加法)×条件乘法，<b>逐源点亮</b>；亏损轮不吃倍率。</p></div>
      <div class="help-sec"><h3><i>04</i>操作</h3><p><b>长按</b>蓄力、松手下单（短按 = 1x）。行情中按<b>落袋</b>（空格）平仓：吃到本轮最优 75%/93% = ×1.3/×1.8。</p></div>
      <div class="help-sec"><h3><i>05</i>风险与仓位</h3><p>四档：<b>裸奔</b>×1.15·割肉费${Math.round(MC.Engine.cutFee * 100)}% / <b>止损</b>损13·盈13对称·利润锁阶梯 / <b>只割不锁</b>损13·上行不限·保费2% / <b>双保险</b>损10·盈10·费减半。仓位三档：<b>轻/标/重</b> = 保证金 16%/40%/70%。L 倍反向约 1/L 即爆；爆仓留 10%。</p></div>
      <div class="help-sec"><h3><i>06</i>监管</h3><p>连赚招 SEC、拔网线、反垄断；单轮赚太多招突击检查。5 名 AI 同盘排名。</p></div>
      <div class="help-sec help-ver"><p>v1.9.3 · 虚构行情演绎作品 · 非投资建议 · 不涉及真实资金</p></div>`;
    $('#overlay-help').hidden = false;
    requestAnimationFrame(() => $('#overlay-help').classList.add('show'));
  }

  /* ═══════════ 事件接线 ═══════════ */
  function bindEvents() {
    bus.on('phase', phase => {
      const G = Engine.G;
      if (phase === 'buff') {
        renderLevNotches();
        openBuffOverlay();
      } else {
        if (!$('#overlay-buffs').hidden) closeBuffOverlay();
        if (phase !== 'buff') exitReplaceMode();
      }
      if (phase === 'act') {
        renderLevNotches();
        updateDockLabels();
        resetLevDisplay();
        renderRiskRow();
        $('#lev-hint').textContent = MC.Themes.copy.chargeHint;
        syncChart();
        chart.setGhost(G.ghost);
      }
      updateHUD();
    });
    bus.on('coinburst', c => {
      // 现金落袋 = 爆金币：数额越大雨越密；巨额落袋触发「印钞机」全屏演出
      const start = Engine.G ? Engine.G.player.start : 10000;
      const huge = c.amount >= start * 0.5;
      const big = huge || c.amount >= Math.max(150, start * 0.008);
      floatFrom($('#hud-equity'), '+' + fmt.money(c.amount), 'gold', big);
      A.play('coin');
      if (huge) {
        fx.coins(Math.min(96, 40 + Math.round(c.amount / Math.max(start, 1) * 12)));
        vignette('gold', 800); shake(6);
        centerFlash(`<b>印 钞 机</b><i>+${fmt.money(c.amount)}</i>`, 'milestone', 1200);
        A.play('milestone');
      } else {
        fx.coins(big ? Math.min(56, 12 + Math.round(c.amount / Math.max(start * 0.01, 1) * 6)) : 8);
      }
    });
    bus.on('market:bent', () => {
      // 情报改写行情：金色氛围闪提示"市场服从了你的意志"
      vignette('gold', 420);
      A.play('hint');
    });
    bus.on('risk:changed', () => renderRiskRow());
    bus.on('offer:show', st => renderOffer(st));
    bus.on('offer:update', st => renderOffer(st));
    bus.on('buff:picked', d => {
      renderSlots();
      updateRankStrip();   // 卡价已扣：排行榜「你」与 HUD 同步
      flyCardToSlot(d);
      updateMultBadge();
      if (d.newSets && d.newSets.length) {
        for (const s of d.newSets) {
          if (s.hidden) {
            const h = Engine.G.mods.hiddenSets.find(x => x.name === s.name);
            if (h) setTimeout(() => showHiddenSet(h), 500);
          } else if (s.n >= 4) {
            // 大件套装：全屏演出
            setTimeout(() => {
              centerFlash(`<b>套 装</b><i>「${s.name}」${s.legendary ? ' · 传说' : ''}</i>`, 'setflash', 1300);
              vignette('gold', 900); shake(6); A.play('setbonus');
            }, 380);
          } else {
            toast(`套装「${s.name}」生效`, 'gold', 2600);
            A.play('setbonus');
          }
        }
      }
    });
    bus.on('purchase', pu => {
      const node = $('#overlay-buffs').hidden ? $('#hud-cash') : $('#buff-cash-wrap');
      floatFrom(node, '-¥' + fmt.num(pu.amount), pu.loan ? 'bad' : 'gold');
      if (pu.loan) toast('现金为负，胆量为正', 'warn', 2200);
      A.play('coin');
    });
    bus.on('shake:cash', () => {
      const n = $('#overlay-buffs').hidden ? $('#hud-cash') : $('#buff-cash-wrap');
      if (n) { n.classList.remove('nope'); void n.offsetWidth; n.classList.add('nope'); }
    });
    bus.on('patience:burst', d => {
      const badge = $('#mult-badge');
      if (badge) floatFrom(badge, `耐心爆发 +${d.bonus.toFixed(2)}x`, 'gold', true);
      vignette('gold', 500); A.play('lvlup'); renderStatusRow();
    });
    bus.on('status:changed', () => renderStatusRow());
    bus.on('hints', renderHints);
    bus.on('toast', t => toast(t.text, t.cls, t.ms));
    bus.on('phase', p => { if (p === 'resolve' && !window.MC_AUTOTEST) runResolve(); });
    bus.on('trade', t => {
      lastTradeAt = performance.now();
      if (t.dir) {
        centerFlash(`<b>${t.dir > 0 ? '开多' : '开空'} ${t.lev}x</b>`, (t.dir > 0 ? 'long' : 'short') + ' brief', 420);   // 仓位卡已有保证金/名义；开仓头几 tick 是落袋决策窗口，闪字要短
        shake(t.lev >= 25 ? 6 : t.lev >= 10 ? 4 : 2);
        resetLevDisplay();   // 下一单从 1x 重新蓄力
        const btn = t.dir > 0 ? $('#btn-buy') : $('#btn-sell');
        if (btn) {
          const r = btn.getBoundingClientRect();
          const c = MC.Themes.current.chart || {};
          const col = t.dir > 0 ? (c.up ? c.up.body : '#22e58a') : (c.down ? c.down.body : '#ff4d6d');
          fx.burst(r.left + r.width / 2, r.top + r.height / 2, t.lev >= 25 ? 26 : 12, [col, '#ffffff'], t.lev >= 25 ? 8 : 5);
        }
        if (t.lev >= 50) vignette(t.dir > 0 ? 'green' : 'red', 400);
      } else if (t.panic) { shake(5); }
      syncPosLines();
      updateHUD();
    });
    bus.on('bot:bust', b => {
      toast(`${b.def.name} 爆仓出局`, 'bad', 2200);   // v1.8.3 不再盘中刷排名条：爆仓时点=方向信息（轮末统一快照）
    });
    bus.on('bot:revive', b => {
      toast(`${b.def.name} 借钱回场`, '', 2000);
    });
    bus.on('game:end', res => {
      // 补充标注数据
      res.liqRounds = (res.stats.actions || []).filter(a => a.act === 'liq').map(a => a.round);
      res.regRounds = Engine.G.regEvents || [];
      showResults(res);
    });
    bus.on('tremor', updateTremor);
    bus.on('theme:changed', () => {
      if (chart) chart.setStyle(Object.assign({}, MC.Chart.DEFAULT_STYLE, MC.Themes.chartStyle));
      renderTitle();
    });

    // 按钮
    $('#btn-start').addEventListener('click', () => { A.unlock(); A.play('click'); startGame(); });
    $('#btn-help').addEventListener('click', () => { A.unlock(); showHelp(); });
    $('#risk-row').addEventListener('click', e => {
      const sz = e.target.closest('.size-chip');   // v1.9 仓位档：保证金 16%/40%/70%
      if (sz) {
        if (Engine.phase !== 'act') { toast('行动阶段可换', '', 1200); return; }
        Engine.G.player.posSizeMul = parseFloat(sz.dataset.size);
        $$('#size-group .size-chip').forEach(c => c.classList.toggle('on', c === sz));
        A.play('click');
        toast({ '0.4': '轻仓：保证金16%', '1': '标准：保证金40%', '1.75': '重仓：保证金70%' }[sz.dataset.size], '', 1500);
        return;
      }
      const chip = e.target.closest('.risk-chip');
      if (!chip) return;
      if (Engine.phase !== 'act') { toast('行动阶段可换', '', 1200); return; }   // v1.8.2 单文案：resolve 期芯片可达、buff 期被构筑层覆盖
      if (Engine.setRiskMode(chip.dataset.risk)) {
        const r = Engine.RISK_MODES[chip.dataset.risk];
        toast(`${r.name}：${r.hint}`, chip.dataset.risk === 'bare' ? 'warn' : '', 1800);
      }
    });
    $('#btn-school-close').addEventListener('click', () => {
      const ov = $('#overlay-school');
      ov.classList.remove('show');
      setTimeout(() => { ov.hidden = true; }, 250);
    });
    $('#btn-help-close').addEventListener('click', () => { $('#overlay-help').classList.remove('show'); setTimeout(() => $('#overlay-help').hidden = true, 250); });
    $('#btn-sound').addEventListener('click', e => {
      const on = A.toggle();
      e.target.textContent = on ? '音效开' : '音效关';
      $('#btn-sound2').textContent = on ? '音效开' : '音效关';
    });
    $('#btn-sound2').addEventListener('click', () => {
      const on = A.toggle();
      $('#btn-sound').textContent = on ? '音效开' : '音效关';
      $('#btn-sound2').textContent = on ? '音效开' : '音效关';
    });
    $('#btn-theme-cycle').addEventListener('click', () => {
      // 局中热换肤：CSS/图表/音色/文案全部即时切换
      const all = MC.Themes.all;
      const i = all.findIndex(t => t.id === MC.Themes.currentId);
      const next = all[(i + 1) % all.length];
      MC.Themes.apply(next.id);
      A.play('click');
      if (Engine.G) { updateDockLabels(); updateHUD(); }
      $('#lev-hint').textContent = MC.Themes.copy.chargeHint;
      toast(`界面 · ${next.name}`, 'gold', 2200);
    });
    $('#btn-gyro').addEventListener('click', async e => {
      const ok = await Tremor.requestGyro();
      toast(ok ? '陀螺仪已开启' : '授权失败 · 用触控替代', ok ? 'good' : 'warn', 2400);
      e.target.hidden = ok;
    });
    $('#btn-reroll').addEventListener('click', () => {
      exitReplaceMode();
      const ok = Engine.rerollOffer();
      if (ok) {
        // 烧钱演出：刷新按钮抖动 + 卡牌重新发牌
        const btn = $('#btn-reroll');
        btn.classList.remove('nope'); void btn.offsetWidth;
        $$('#buff-cards .buff-card').forEach(c => { c.classList.remove('deal-again'); void c.offsetWidth; c.classList.add('deal-again'); });
      }
    });
    $('#mult-badge').addEventListener('click', () => openMultPanel());
    $('#overlay-mult').addEventListener('click', () => closeMultPanel());
    $('#btn-skip-buff').addEventListener('click', () => Engine.skipBuffs());
    $('#btn-cashout').addEventListener('click', doCashout);
    $('#btn-close-pos').addEventListener('click', () => { if (Engine.phase === 'act' && !resolving) Engine.closePosition(false); });
    $('#btn-hold').addEventListener('click', () => { if (Engine.phase === 'act' && !resolving) Engine.hold(); });
    const openPause = () => { $('#overlay-pause').hidden = false; requestAnimationFrame(() => $('#overlay-pause').classList.add('show')); };
    $('#btn-pause').addEventListener('click', openPause);
    $('#btn-pause-buff').addEventListener('click', openPause);   // 构筑层盖住了顶栏：自带一个暂停入口
    $('#btn-resume').addEventListener('click', () => { $('#overlay-pause').classList.remove('show'); setTimeout(() => $('#overlay-pause').hidden = true, 250); });
    $('#btn-quit').addEventListener('click', () => {
      // 结束本局 = 按现价平仓、立即终局。先掐断一切进行中的演出，再结算——结算页之后不得再有任何对局内容
      abortSession();
      Engine.surrender();
    });
    // 模式选择：默认单人；多人对战尚未开放
    $('#mode-multi').addEventListener('click', e => {
      A.unlock(); A.play('error');
      const b = e.currentTarget;
      b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
      toast('多人对战 · 敬请期待', 'gold', 1800);
    });
    $('#mode-solo').addEventListener('click', () => { A.unlock(); A.play('click'); });

    bindCharge('#btn-buy', 1);
    bindCharge('#btn-sell', -1);

    // 阻止双指缩放/双击缩放
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('dblclick', e => { if (e.target.closest('#dock')) e.preventDefault(); });
  }

  function updateDockLabels() {
    const copy = MC.Themes.copy;
    const pos = Engine.G.player.pos;
    $('#buy-label').textContent = pos ? (pos.dir > 0 ? '加多' : '反手多') : copy.buy;
    $('#sell-label').textContent = pos ? (pos.dir < 0 ? '加空' : '反手空') : copy.sell;
    $('#btn-buy').classList.toggle('has-pos', !!pos);
    $('#btn-sell').classList.toggle('has-pos', !!pos);
  }

  /* ═══════════ 启动 ═══════════ */
  function init() {
    fx.init();
    const save = MC.save.read();
    const themeId = save.theme && MC.Themes.get(save.theme) ? save.theme : (MC.Themes.all[0] || {}).id;
    if (themeId) MC.Themes.apply(themeId, { silent: true });
    bindEvents();
    renderTitle();
    showScreen('title');
    // 首次交互解锁音频
    const unlock = () => { A.unlock(); document.removeEventListener('pointerdown', unlock); };
    document.addEventListener('pointerdown', unlock);
  }

  MC.App = {
    init, toast, startGame, showScreen, fx, centerFlash,
    cashout: doCashout,
    pickByKey: i => { if ($('#overlay-buffs').classList.contains('arming')) return; const card = $$('#buff-cards .buff-card')[i]; if (card) card.click(); },
    /* QA / 调试钩子 */
    debug: {
      telegram: kind => playTelegram(typeof kind === 'string' ? { kind, penalty: 0.3, payer: '梭哈怪', fine: 4200, share: 2100, youGot: 2100, youPaid: 0 } : kind),
      dramaEv: ev => playDrama(ev),
      /* 结算倍率序列演出（QA 截图用） */
      scoreSeq: (opts) => {
        const o = opts || {};
        return roundSummaryFlash({
          round: o.round || 7, pnl: o.pnl || 23400, playerPct: o.playerPct || 0.42, equity: 78000,
          notes: o.notes || [{ text: '稳定币利息 +¥1,560', cls: 'good' }],
          mult: o.mult || {
            base: 9800, total: 2.39, gain: 13620, crit: true,
            steps: [
              { key: 'snow', name: '雪球复投', icon: '滚', school: 'econ', slotIdx: null, op: '+', val: 0.28, label: '' },
              { key: 'streak', name: '热手连胜', icon: '连', school: 'wild', slotIdx: null, op: '+', val: 0.15, label: '' },
              { key: 'insider', name: '内幕消息', icon: '密', school: 'seer', slotIdx: 2, op: 'x', val: 1.4, label: '' },
              { key: 'crit', name: '会心一击！', icon: '暴', school: 'wild', slotIdx: null, op: 'x', val: 2.5, label: '', crit: true },
            ],
          },
        });
      },
      milestone: m => playMilestone({ mult: m || 2, eq: 20000 }),
      multPanel: () => openMultPanel(),
      drama: type => showDramaOverlay({
        liquidated: { icon: '爆', title: '爆 仓', cls: 'drama-liq', body: '维持保证金不足，仓位被强制平掉。', num: '残存资金 ¥1,000', sound: 'bust' },
        rescue: { icon: '救', title: '国家队进场', cls: 'drama-rescue', body: '一股神秘力量托住了盘面。', num: '救市资金 ¥2,500', sound: 'rescue' },
      }[type] || null),
    },
  };

})(window.MC);
