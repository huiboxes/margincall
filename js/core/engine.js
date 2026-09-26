/* ═══════════════════════════════════════════════════════════
   游戏引擎：15 轮状态机
   buff构筑 → 读盘(情报) → 行动(蓄力下单) → 逐tick结算 → 监管判定
   会计模型：cash(自由资金，可为负=借贷) + margin(占用) + 浮动盈亏 = equity
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  const { Market, Buffs, Bots, clamp } = MC;
  const ROUNDS = Market.ROUNDS, TPR = Market.TPR;
  const PRE = 31;            // 盘前历史 tick 数（盲开前的可见历史）
  const START = 10000;
  const FEE = 0.0008;        // 手续费 8bps（名义）——返佣流的现金来源
  const MMR = 0.005;         // 维持保证金率
  const MANUAL_CUT_FEE = 0.06;   // v1.9.2 8%→6%：无卡手动线回校准带；v1.9.3 上移供 hint 单源引用
  const LEV_STEPS = [1, 2, 3, 5, 10, 25, 50, 125, 250];
  /* v3 风险档位：下单前选择，决定本轮仓位的自动离场线（按轮初权益的浮亏/浮盈）
     bare = 无止损（刀口舔血：盈利轮 ×1.15，手动割肉费 6%）；sl = 损13/盈13 对称+利润锁阶梯；both = 损10/盈10+费减半；cut = 损13 保底+上行不限（保费2%）。（v1.9.3 注释同步） */
  const RISK_MODES = {
    bare: { id: 'bare', name: '裸奔', icon: '刃', sl: 0, tp: 0, hint: `无止损·割肉费${Math.round(MANUAL_CUT_FEE * 100)}%` },   // v1.9.3 文案单源
    /* v1.7.2 保险 = 对称带：旧版「止损10% + 盈利不设限」在肥尾剧本里让抛硬币正期望（独立种子中位 1.2–1.3）；
       对称后保险档期望 ≈ −手续费，想吃大行情用裸奔或盘中落袋 */
    sl: { id: 'sl', name: '止损', icon: '盾', sl: 0.13, tp: 0.13, hint: '损13%或盈13%平' },   // v1.9 10→13%：止损距离宽于噪声 excursion，方向做对的轮更少被扫
    both: { id: 'both', name: '双保险', icon: '衡', sl: 0.10, tp: 0.10, hint: '损10盈10费减半' },
    /* v1.8 只割不锁：下行有底（损13%自动割，v1.9 起）、上行保留期权——QA 实证玩家真正想要的保险形态；
       凸性不免费：开仓收 2% 权益保费，抛硬币买不起这个期权 */
    cut: { id: 'cut', name: '只割不锁', icon: '剪', sl: 0.13, tp: 0, hint: '损13·上行不限' },
  };
  /* 经济 v2：一切价格挂钩当前权益——前期每一块钱都肉疼，后期刷得起但可能刷光也凑不齐
     刷新费 = 4% 权益 × 1.6^本轮已刷次数（几何递增，追组合会烧钱）
     跳过构筑返还 = 1.5% 权益（v1.6 起；持仓才兑现）；透支上限 = 25% 权益（保证金借贷） */
  const REROLL_PCT = 0.04, REROLL_GROWTH = 1.6, REROLL_MIN = 250;
  const SKIP_PCT = 0.015, SKIP_MIN = 150;   // v1.6 3%→1.5%：5x 抛硬币+全程跳过曾稳赚 1.41x
  const LOAN_LIMIT = 0.25;
  const MILESTONES = [2, 3, 5, 10, 20, 50, 100];
  /* v4 膨胀刹车（叙事化，不做硬截断）：倍率加成在 SOFT_CAP×轮初权益内全额兑现；
     超额部分越大概率引来「SEC 突击检查」，没收超额的 60%——但到手仍远超旧封顶。
     贪婪有代价，没有天花板 */
  const SOFT_CAP = 2.5;
  const RAID_SEIZE = 0.6;   // 首次没收超额的 60%，惯犯逐级加码（raidHeat）
  const ENGINE_IDLE = 0.008;
  /* v1.8.1 被动收益体量衰减：利息/雪球/轰鸣是无风险复利，旧版在刹车阈值之下悄悄 1.13^15（econ6 空仓 med 7.5x、liq 0%，
     风险调整后支配交易流）。大资金拿不到同样收益率——市场深度不吃这套 */
  function passiveMul() {
    const size = equity() / Math.max(G.player.start, 1);
    return 1 / (1 + Math.pow(Math.log2(Math.max(size, 1)), 2.2));   // v1.8.3 指数 1.8→2.2：真实经济吃息流 1.26 双轴支配 smart → 压回 ≤1.1
  }   // 引擎轰鸣：每 (multBase-1) 每轮落袋 0.8% 权益
  /* v1.5 落袋两档：≥ 本轮最优可得 93% = 神级逃顶 ×1.8；≥ 75% = 精准落袋 ×1.3
     （v1.2 单档 90%/×1.5 触发率 ~10%，所有止盈规则都不如扛到底——见好就收得有回报） */
  const CUT_PREMIUM = 0.02;   // v1.8 只割不锁保费 = 轮初权益 2%
  // v1.8.4 行权费基数 = 收费时点的真实本金（act 阶段 E_roundStart 还是上一轮的旧值）
  function cutBase() { const p = G.player; return equity() - (p.pos ? upnl() : 0); }
  // v1.8.6 现金扣款一律不超过可用现金：保证金还锁在仓里时整额扣现金会把 cash 打负，equity 的 0 钳位随之吞掉恒等式
  /* v1.8.8 监管强制落袋：刹车要没收的是「权益」，而权益可能锁在持仓保证金里——
     spend() 只扣现金会被 cash≈0 上限架空（QA16 P1：携带鲸鱼构筑 53,217x 复利）。
     没收前先按市价强制 realization，叙事 = 监管强制平仓 */
  function forceRealize() {
    const p = G.player;
    if (!p.pos) return;
    const u = upnl();
    p.cash += p.pos.M + u;
    p.stats.actions.push({ round: G.round, act: 'forceclose', pnl: u, opened: p.pos.openedRound });
    (G.forceCloseNotes = G.forceCloseNotes || []).push({ pnl: u, opened: p.pos.openedRound });   // v1.8.9 notes 循环早于刹车：凭证行延后补
    p.pos = null;
    p.consecutiveSameDir = 0; p.patientStacks = 0; p.curHoldStreak = 0;
  }

  function spend(p, amount) { const applied = Math.min(amount, Math.max(p.cash, 0)); p.cash -= applied; return applied; }
  function creditTpBonus(p, b) { p.cash += b; p.tpBonusRound = (p.tpBonusRound || 0) + b; p.stats.tpBonusTotal = (p.stats.tpBonusTotal || 0) + b; if (G.phase === 'act') p.tpBonusAct = (p.tpBonusAct || 0) + b; }   // v1.8.10 act 段奖金单记入锚
  function chargeCut(p) { const f = spend(p, MANUAL_CUT_FEE * cutBase()); p.stats.fees += f; p.exerciseFee = (p.exerciseFee || 0) + f; if (G.phase === 'act') p.exerciseFeeAct = (p.exerciseFeeAct || 0) + f; return f; }   // v1.8.9 act 段行权费单记：大数字锚要减它   // v1.8.2 裸奔手动割肉行权费 = 凸性定价（实测 3% 压不住：无卡抛硬币+手动割 1.82x 仍支配）
  const SNIPE_TIERS = [{ r: 0.93, key: 'snipe', name: '神级逃顶', val: 1.8 }, { r: 0.75, key: 'clean', name: '精准落袋', val: 1.3 }];
  const RADAR_MIN_ADV = 0.012, RADAR_CAP = 15, RADAR_CAP_EXACT = 30;   // v1.5 雷达读数下限 / 建议杠杆硬顶
  /* 盘口语言的形态读数：只描述路径（与涨跌方向无关），用来判断止损会不会被扫 */
  const SHAPE_CN = { drift: '匀速', waterfall: '尾段加速', squeeze: '尾段加速', spike: '单根插针', gap: '开盘跳空', chop: '来回震荡', v: '先反后正', wick: '冲过头回收' };

  let G = null;
  const bus = MC.bus;
  const toast = (text, cls, ms) => bus.emit('toast', { text, cls, ms });

  /* ── 新游戏 ─────────────────────────────────────────── */
  function newGame(opts) {
    opts = opts || {};
    const seed = opts.seed === undefined ? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 : opts.seed;
    const rnd = MC.rng(seed);
    const scen = Market.variant(opts.scenario ? Market.byId(opts.scenario) : Market.random(rnd), rnd);
    const mkt = Market.generate(scen, rnd);

    // 盘前历史：PRE 个 warm-up tick，其后紧接剧本起点 base
    const pre = [];
    let drift = 0;
    for (let i = 0; i < PRE; i++) {
      drift += (rnd() - 0.5) * 0.008 - drift * 0.12;
      pre.push(scen.base * (1 + drift));
    }
    mkt.prices = pre.concat(mkt.prices);
    for (const b of mkt.roundBounds) { b.start += PRE; b.end += PRE; }
    const cc = Market.toCandles(mkt);

    G = {
      seed, rnd, mkt, scen,
      candles: cc.candles, roundCandle: cc.roundCandle,
      round: 1, phase: 'buff',
      revealedTick: PRE - 1,           // 已揭示到盘前最后一根
      player: {
        start: START, cash: START, pos: null,
        E_roundStart: START,
        levCapOverride: null, levCapRounds: 0,
        profitPenalty: 0,
        highProfitRounds: 0, highLevRounds: 0,
        consecutiveSameDir: 0, lastDir: 0,
        patientStacks: 0, diamondArmed: 0,
        gamblerRevive: false, rescueUsed: false, reviveUsed: false,
        liquidatedThisRound: false,
        riskMode: 'sl', feesThisRound: 0, raidHeat: 0, posSizeMul: 1,   // v1.9 仓位三档：轻仓0.4/标准1/重仓1.75（保证金倍率）
        // 倍率引擎动态状态
        snowMult: 0, winStreak: 0, winStreakEnter: 0,
        rerollsThisRound: 0, liqNearMin: 1, milestonesHit: {},
        stats: {
          trades: 0, correctDirs: 0, wrongDirs: 0, holdRounds: 0,
          maxHoldStreak: 0, curHoldStreak: 0, maxLev: 0, sumLev: 0, levOpens: 0,
          fees: 0, liqs: 0, regs: 0, flips: 0, chase: 0, panic: 0,
          bestRound: 0, worstRound: 0, bonusTotal: 0, rumorVictims: 0,
          diamondUses: 0, patienceMax: 0, stops: 0, tps: 0, actions: [],
          spentBuffs: 0, rerolls: 0, maxMult: 1, crits: 0, milestones: 0,
          cashouts: 0, cashSaved: 0, snipes: 0,
        },
      },
      buffs: { slots: Array(6).fill(null), offer: [], prices: [0, 0, 0], locked: [false, false, false], rerollIdx: 0, totalRerolls: 0, guarantee: null, freeNext: false },
      mods: Buffs.computeMods([]),
      bots: Bots.createBots(),
      hints: [], ghost: null, rumorTargets: null, roundInfo: {},
      trueRet: 0, pendingEvents: [],
      equityCurve: [{ round: 0, eq: START }],
      tickCurve: [{ t: PRE - 1, eq: START }],
      peak: START, trough: START,
      regLog: [], actionTaken: null,
      newSets: [],   // 本轮新触发套装（演出用）
    };

    bus.emit('game:start', { seed, scenarioHidden: true });
    beginRound(true);
    return G;
  }

  /* ── 只读查询 ───────────────────────────────────────── */
  function P(i) { return G.mkt.prices[i === undefined ? G.revealedTick : i]; }
  function equity() {
    // v1.8.7 不钳位：借贷期内负权益是真实债务，钳 0 会吞掉对账恒等式（QA15 P2-02）；显示与公式各自兜底
    const p = G.player;
    if (!p.pos) return p.cash;
    return p.cash + p.pos.M + upnl();
  }
  function upnl() {
    const p = G.player;
    if (!p.pos) return 0;
    return p.pos.N * (P() / p.pos.entry - 1) * p.pos.dir;
  }
  function liqPrice() {
    const p = G.player;
    if (!p.pos) return null;
    const mmr = MMR * (1 - G.mods.mmrCut);
    const adverse = Math.max((1 / p.pos.lev - mmr) * G.mods.liqBuffer, 0.0008);
    return p.pos.dir > 0 ? p.pos.entry * (1 - adverse) : p.pos.entry * (1 + adverse);
  }
  function levSteps() {
    /* cap 本身必须成为可选档位：巨鲸 2 件套 +50x（cap 175）这类加成
       在离散档位表里会被 filter 吞掉（125 与 250 之间没有 175）——
       玩家买了抬上限的卡却看不到任何变化。补上 cap 档，任何加成可见 */
    const cap = currentLevCap();
    const steps = LEV_STEPS.filter(s => s <= cap);
    if (cap > 1 && steps[steps.length - 1] !== cap) steps.push(cap);
    return steps;
  }
  /* v1.7 体量滑点：你的规模就是行情本身——身家越大，可用杠杆上限越低（对数衰减）。
     这是信息×杠杆复利坡道的通用刹车：任何「确定方向」的策略都会在自己的体量上失效 */
  function sizeLevMul() {
    const size = equity() / Math.max(G.player.start, 1);
    return 1 / (1 + Math.log2(Math.max(size, 1)) * 0.5);
  }
  function currentLevCap() {
    const p = G.player;
    return Math.max(1, Math.floor(Math.min(G.mods.levMax, p.levCapOverride || Infinity) * sizeLevMul()));
  }
  function standings() {
    const rows = G.bots.map(b => ({ id: b.def.id, name: b.def.name, avatar: b.def.avatar, eq: b.equity, alive: !!b.alive, isBot: true, roundPnl: b.roundPnl, lastAct: b.lastAct, busted: b.busted }));
    rows.push({ id: 'you', name: '你', avatar: '😎', eq: equity(), alive: true, isBot: false });
    rows.sort((a, b) => b.eq - a.eq);
    rows.forEach((r, i) => r.rank = i + 1);
    return rows;
  }

  /* ── 轮开始：路径扰动 + bot 计划 + buff 供给 ────────── */
  function beginRound(isFirst) {
    const p = G.player;
    if (p.levCapRounds > 0) { p.levCapRounds--; if (p.levCapRounds === 0) p.levCapOverride = null; }

    const b = G.mkt.roundBounds[G.round];
    // 赌徒狂热：上轮刷新次数放大本轮波动
    const bump = p.rerollVolBump || 0;
    if (bump > 0) {
      const p0 = G.mkt.prices[b.start];
      for (let i = b.start + 1; i <= b.end; i++) {
        G.mkt.prices[i] = p0 + (G.mkt.prices[i] - p0) * (1 + bump);
      }
      p.rerollVolBump = 0;
    }
    G.trueRet = G.mkt.prices[b.end] / G.mkt.prices[b.start] - 1;

    // 谣言散布
    G.rumorTargets = new Set();
    if (G.mods.rumor > 0 && G.rnd.chance(G.mods.rumor)) {
      const target = G.rnd.pick(G.bots.filter(x => x.alive && x.def.id !== 'insider'));
      if (target) G.rumorTargets.add(target.def.id);   // 风味：AI 对手被误导；玩家侧效果在 startResolve 造势
    }
    // bot 计划（只看已揭示行情）
    const revealed = G.mkt.prices.slice(0, G.revealedTick + 1);
    for (const bot of G.bots) {
      bot.roundStartEquity = bot.equity;
      Bots.planRound(bot, { prices: revealed, round: G.round, trueRet: G.trueRet, rnd: G.rnd, rumorTargets: G.rumorTargets });
    }

    // 本轮状态快照（倍率引擎 ctx 用）
    p.winStreakEnter = p.winStreak;
    p.rerollsThisRound = 0;
    p.liqNearMin = 1;
    p.feesThisRound = 0;
    G.roundInfo = { hintDir: 0, tapeRange: null, ghostDir: 0, leaderDir: 0,
      // v1.8.5 携带仓在本轮开盘时的浮盈标记（上轮已计入权益）——结算对账的拆分基准
      carryMark: G.player.pos ? upnl() : 0 };
    const alive = G.bots.filter(x => x.alive);
    if (alive.length) {
      const leader = alive.slice().sort((a, b) => b.equity - a.equity)[0];
      // v1.8 沉默契约覆盖派生信号：首富是内幕哥时 leaderDir 归零（followedLeader 芯片同口径）
      G.roundInfo.leaderDir = leader.def.id === 'insider' ? 0 : ((leader.plan && leader.plan.dir) || 0);
    }

    // buff 供给：差一张就触发套装的流派加权（制造 chase）
    const bf = G.buffs;
    bf.rerollIdx = 0;
    if (p.gamblerRevive) { bf.freeNext = true; bf.guarantee = 'epic'; p.gamblerRevive = false; }
    else bf.guarantee = null;
    const setChase = {};
    const counts = G.mods.sets || {};
    for (const school of ['whale', 'seer', 'econ']) {
      const c = counts[school] || 0;
      if (c === 1 || c === 3 || c === 5) setChase[school] = true;
    }
    bf.offer = Buffs.rollOffer(G.rnd, { slots: bf.slots, rerollStreak: bf.totalRerolls, guarantee: bf.guarantee, setChase });
    bf.locked = [false, false, false];
    priceOffer();
    G.newSets = [];

    G.phase = 'buff';
    bus.emit('phase', 'buff');
    bus.emit('offer:show', offerState());
    if (!isFirst) bus.emit('round:start', { round: G.round });
    else bus.emit('round:start', { round: 1 });
  }

  /* 刷新费：挂钩当前权益 + 本轮几何递增——前期肉疼，后期追组合烧钱 */
  function rerollCost() {
    const bf = G.buffs;
    if (bf.freeNext) return 0;
    const base = Math.max(equity(), 1000) * REROLL_PCT * Math.pow(REROLL_GROWTH, bf.rerollIdx);
    let c = Math.round(base / 50) * 50;
    if (G.mods.gamblerReroll) c = Math.round(c / 2);
    return Math.max(c, REROLL_MIN);
  }

  /* 为当前 offer 定价（锁定卡保持旧价 = 锁价） */
  function priceOffer(keepLocked) {
    const bf = G.buffs;
    const E = equity();
    bf.prices = bf.offer.map((d, i) => (keepLocked && bf.locked[i] && bf.prices[i]) ? bf.prices[i] : Buffs.priceOf(d.rarity, E));
  }

  /* 支付判定：现金够直接付；不够但透支不超 25% 权益 → 保证金借贷 */
  function canPay(amount) {
    const p = G.player;
    if (amount <= 0) return true;
    if (p.cash >= amount) return true;
    return p.cash - amount >= -LOAN_LIMIT * Math.max(equity(), 0);
  }
  function pay(amount, what) {
    const p = G.player;
    p.cash -= amount;
    p.stats.spentBuffs += amount;
    bus.emit('purchase', { amount, what, loan: p.cash < 0 });
  }

  function offerState() {
    return {
      cards: G.buffs.offer, prices: G.buffs.prices.slice(), locked: G.buffs.locked.slice(),
      cost: rerollCost(), cash: G.player.cash, equity: equity(), round: G.round,
      slots: G.buffs.slots, guarantee: G.buffs.guarantee, freeNext: G.buffs.freeNext,
      multBase: G.mods.multBase, rerollIdx: G.buffs.rerollIdx,
    };
  }

  function toggleLock(i) {
    const bf = G.buffs;
    const anyLocked = bf.locked.indexOf(true);
    if (!bf.locked[i] && anyLocked >= 0 && anyLocked !== i) { MC.Audio.play('error'); return false; }
    bf.locked[i] = !bf.locked[i];
    MC.Audio.play('click');
    bus.emit('offer:update', offerState());
    return true;
  }

  function rerollOffer() {
    if (!G || G.phase !== 'buff') return false;
    const bf = G.buffs, p = G.player;
    const cost = rerollCost();
    if (!canPay(cost)) { MC.Audio.play('error'); toast('资金不足', 'bad'); bus.emit('shake:cash'); return false; }
    if (cost > 0) pay(cost, 'reroll');
    if (bf.freeNext) bf.freeNext = false;
    else bf.rerollIdx++;
    bf.totalRerolls++;
    p.rerollsThisRound++;
    p.stats.rerolls++;
    p.rerollVolBump = (p.rerollVolBump || 0) + (G.mods.gamblerReroll ? 0.08 : 0);
    const setChase = {};
    const counts = G.mods.sets || {};
    for (const school of ['whale', 'seer', 'econ']) {
      const c = counts[school] || 0;
      if (c === 1 || c === 3 || c === 5) setChase[school] = true;
    }
    const keptN = bf.locked.filter(Boolean).length;
    const fresh = Buffs.rollOffer(G.rnd, { slots: bf.slots, rerollStreak: bf.totalRerolls, guarantee: bf.guarantee && keptN === 0 ? 'epic' : null, setChase });
    let fi = 0;
    bf.offer = bf.offer.map((d, i) => bf.locked[i] ? d : (fresh[fi++] || d));
    if (bf.guarantee && !bf.offer.some(d => d.rarity >= 3)) {
      // 赌徒复苏保底紫
      const hi = Buffs.DEFS.filter(d => d.rarity >= 3 && !bf.slots.some(s => s && s.def.id === d.id && s.lvl >= 3));
      if (hi.length) bf.offer[2] = G.rnd.pick(hi);
    }
    priceOffer(true);
    MC.Audio.play('reroll');
    if (G.mods.gamblerReroll) toast(`赌徒：本轮 +${(p.rerollsThisRound * 0.05).toFixed(2)}x`, 'gold');
    bus.emit('offer:update', offerState());
    return true;
  }

  /* 选择 offer[i]（要花钱）；slots 满时 replaceIdx 指定替换哪格（null=取消）
     返回 true / false / 'need-replace' / 'no-funds' */
  function pickOffer(i, replaceIdx) {
    if (!G || G.phase !== 'buff') return false;
    const bf = G.buffs, def = bf.offer[i];
    if (!def) return false;
    const price = bf.prices[i] || 0;
    if (!canPay(price)) {
      MC.Audio.play('error');
      toast(price > 0 ? `买不起 · 差 ¥${MC.fmt.num(price - G.player.cash)}` : '资金不足', 'bad');
      bus.emit('shake:cash');
      return 'no-funds';
    }
    const prevSets = JSON.stringify((G.mods.setNames || []).map(s => s.name));

    const existing = bf.slots.findIndex(s => s && s.def.id === def.id);
    let slotIdx, newLvl;
    if (existing >= 0) {
      if (bf.slots[existing].lvl >= 3) { toast('已满级', 'bad'); return false; }
      slotIdx = existing; newLvl = bf.slots[existing].lvl + 1;
    } else if (bf.slots.every(s => s)) {
      if (replaceIdx === undefined || replaceIdx === null) return 'need-replace';
      slotIdx = replaceIdx; newLvl = 1;
    } else {
      slotIdx = bf.slots.findIndex(s => !s); newLvl = 1;
    }

    // 扣款（可为借贷）→ 入槽
    if (price > 0) pay(price, 'card');
    if (existing >= 0) bf.slots[existing].lvl++;
    else bf.slots[slotIdx] = { def, lvl: 1 };

    G.mods = Buffs.computeMods(bf.slots);
    MC.Audio.play(newLvl > 1 ? 'lvlup' : 'cardPick');

    // 新套装演出
    const fresh = (G.mods.setNames || []).filter(s => !JSON.parse(prevSets).includes(s.name));
    G.newSets = fresh;

    bus.emit('buff:picked', { def, slots: bf.slots, newSets: fresh, slotIdx, lvl: newLvl, price });
    finishBuffPhase();
    return true;
  }

  function skipBuffs() {
    if (!G || G.phase !== 'buff') return false;
    /* v1.4 返还改为「本轮有持仓才兑现」：旧版立即到账，15 轮挂机（跳过+不动）稳拿 1.56x，比认真玩还赚 */
    const refund = Math.max(SKIP_MIN, Math.round(equity() * SKIP_PCT));
    G.player.skipRefund = refund;
    toast(`跳过·持仓返 ${refund >= 10000 ? (refund / 10000).toFixed(1) + '万' : MC.fmt.money(refund)}`, '', 1200);   // v1.8.4 万元域不越 13 字
    MC.Audio.play('click');
    finishBuffPhase();
  }

  /* buff 阶段结束 → 情报 → 行动阶段 */
  function finishBuffPhase() {
    computeHints();
    G.phase = 'act';
    G.actionTaken = null;
    // v1.7.2 跨轮持仓提示：本轮涨跌相对本轮开盘价，旧仓盈亏相对旧入场价——两件事别混
    if (G.player.pos && G.round - G.player.pos.openedRound >= 1) {
      toast(`持仓跨轮，盈亏按旧入场价`, '', 2600);   // 13 字红线
    }
    bus.emit('phase', 'act');
    bus.emit('hints', G.hints);
  }

  /* v4 情报即火力：内幕/谣言直接改写本轮未揭示的行情。
     bend 只触碰 revealedTick 之后的 tick（K 线不会跳变），改完同步 trueRet 与蜡烛缓存 */
  function bendRound(targetRet, why) {
    const t = clamp(targetRet, -0.45, 0.45);
    const got = Market.bend(G.mkt, G.round, t);
    G.trueRet = got;
    const cc = Market.toCandles(G.mkt);
    G.candles = cc.candles; G.roundCandle = cc.roundCandle;
    bus.emit('market:bent', { round: G.round, ret: got, why });
  }

  function computeHints() {
    const m = G.mods, hints = [];
    const b = G.mkt.roundBounds[G.round];
    const p0 = G.mkt.prices[b.start];

    if (m.dealer) {
      hints.push({ kind: 'dealer', icon: '🎩', glyph: '庄', title: '坐庄', text: '持仓方向牵引行情 1%/轮', cls: 'gold' });
      G.roundInfo.hintDir = 0; // 坐庄时方向即自己
    } else if (m.hintInsider > 0) {
      /* v1.7 体量衰减：全视的「方向锁定 + 保底幅度」只在身家 ≤10x 本金时成立——巨头自己就是行情，
         消息面随体量失效（push 递减）。旧版无上限：seer 6 件 p90 3.7 万倍、max 146 万倍 */
      const size = equity() / G.player.start;
      const fade = size <= 10 ? 1 : size <= 40 ? 0.6 : 0.3;
      const omniOn = m.seerOmni && size <= 10;
      const push = m.insiderPush * (omniOn ? 2 : 1) * fade;
      const sign = G.trueRet >= 0 ? 1 : -1;
      if (omniOn) {
        // 全视：方向确定 + 保底幅度（牵引翻倍——市场必须服从）
        bendRound(sign * Math.max(Math.abs(G.trueRet), push), 'omni');
        hints.push({
          kind: 'omni', icon: '👁', glyph: '视', title: '全 视', cls: 'gold', bent: true,
          text: `市场必须服从：本轮向${sign > 0 ? '上' : '下'} ${Math.abs(G.trueRet) * 0.7 * 100 | 0}%~${Math.abs(G.trueRet) * 1.3 * 100 | 0}%`,
        });
      } else {
        // 内幕 = 自我实现的预言，但消息会错：说对时幅度不足补到牵引下限；说错时行情照旧（被反向收割）
        const acc = clamp((m.insiderAcc || 0.76) + (m.hintAcc || 0), 0, 0.85);   // v1.8 上限 85%：95% 的方向通道是支配策略的发动机
        const right = G.rnd.chance(acc);
        const shown = right ? sign : -sign;
        if (right && Math.abs(G.trueRet) < push) bendRound(sign * push, 'insider');
        hints.push({
          kind: 'insider', icon: '📻', glyph: '密', title: `内幕消息 · 准 ${Math.round(acc * 100)}%`, cls: 'good', bent: true,   // 金边恒亮：不许用样式泄露这条说没说对
          text: `大资金正在${shown > 0 ? '买入' : '出货'}`,
        });
        G.roundInfo.hintDir = shown;
      }
      if (omniOn) G.roundInfo.hintDir = sign;   // 体量上去后全视退化为普通内幕（会错）
    }
    if (m.hintFollow > 0) {
      const st = standings().filter(r => r.isBot && r.alive !== false);
      const leader = st[0];
      if (leader && leader.id !== 'you') {
        const bot = G.bots.find(x => x.def.id === leader.id);
        if (bot && bot.def.id === 'insider') {
          // 首富是内幕哥时闭麦：它的计划带未来知识，转述出去就是条件泄露通道（leader 分桶 68% 命中）
          hints.push({ kind: 'follow', icon: '🐠', glyph: '随', title: '跟单大佬', text: `首富「${bot.def.name}」渠道沉默`, cls: 'info' });
        } else if (bot && bot.plan && bot.plan.dir) {
          const acc = clamp(m.hintFollow + m.hintAcc, 0, 0.99);
          const right = G.rnd.chance(acc);
          const shown = right ? bot.plan.dir : -bot.plan.dir;
          hints.push({ kind: 'follow', icon: '🐠', glyph: '随', title: '跟单大佬', text: `首富「${bot.def.name}」倾向${shown > 0 ? '做多' : '做空'}`, cls: 'info' });
        }
      }
    }
    if (m.hintTape) {
      const mag = Math.abs(G.trueRet);
      const lo = Math.max(0.5, mag * 70), hi = mag * 130 + 1;
      const shape = (G.scen.rounds[G.round - 1] || [])[1] || 'drift';
      hints.push({ kind: 'tape', icon: '📼', glyph: '盘', title: '盘口语言', text: `波动 ±${lo.toFixed(1)}%~±${hi.toFixed(1)}% · 形态「${SHAPE_CN[shape] || '匀速'}」`, cls: 'info' });
      G.roundInfo.tapeRange = { lo: lo * 0.85, hi: hi * 1.15 };
    }
    /* v1.1 风控雷达：单人局情报的核心价值——本轮最深逆向回撤 → 安全杠杆。
       v1.4 只报「方向对时」的回撤（不分多空的一个数）：旧版多/空各报一个，浅的一侧 96% 就是本轮方向——
       雷达只回答「开多大」，「开哪边」留给内幕/盘口/玩家判断。
       放在 insider/omni 改写之后计算；之后的造势/坐庄只会朝玩家方向推，不会让读数变得更危险 */
    if (m.radar > 0) {
      let up = 0, dn = 0;
      for (let i = b.start + 1; i <= b.end; i++) {
        const r = G.mkt.prices[i] / p0 - 1;
        if (r > up) up = r; if (r < dn) dn = r;
      }
      const fuzz = m.radarExact || m.radar >= 2.2 ? 0 : m.radar >= 1.6 ? 0.15 : 0.35;
      const blur = v => Math.max(0.001, v * (1 + fuzz * (G.rnd() * 2 - 1)));
      const trueDir = G.trueRet >= 0 ? 1 : -1;
      // 读数下限：再顺的行情也有噪声，0.1% 的读数会把建议杠杆顶到上限（旧版半数轮「可≤125x」）
      const adv = Math.max(RADAR_MIN_ADV, blur(trueDir > 0 ? -dn : up));
      const cap = Math.min(currentLevCap(), m.radarExact ? RADAR_CAP_EXACT : RADAR_CAP);
      const capMul = clamp(m.capMul * (G.player.posSizeMul || 1), 0.05, 1.1);   // v1.9 雷达安全杠杆按实际仓位档
      const budget = RISK_MODES.sl.sl * (1 + (m.slWiden || 0));
      // 止损档：亏损 = 保证金×杠杆×逆向幅度 ≤ 预算；同时不得先撞强平
      // 有误差档按误差上沿保守折算：雷达给的安全线宁紧勿松
      const safe = clamp(Math.floor(Math.min(budget / (capMul * adv), 0.95 * m.liqBuffer / adv) / (1 + fuzz)), 1, cap);
      G.roundInfo.radar = { adv, safe, fuzz };
      hints.push({
        kind: 'radar', icon: '📡', glyph: '雷', title: fuzz ? `风控雷达 ±${Math.round(fuzz * 100)}%` : '风控雷达', cls: 'info',
        text: `方向对时回撤 -${(adv * 100).toFixed(1)}% · 可≤${safe}x`,
      });
    }
    if (m.foresight > 0) {
      const n = Math.max(2, Math.round(TPR * m.foresight));
      const fake = G.rnd.chance(m.foresightFake);
      const ticks = [];
      for (let i = 1; i <= n; i++) {
        const price = G.mkt.prices[b.start + i];
        ticks.push(fake ? p0 * (p0 / price) : price);
      }
      G.ghost = { from: b.start, ticks, fake };
      G.roundInfo.ghostDir = Math.sign(ticks[ticks.length - 1] - p0) || 0;
      hints.push({ kind: 'foresight', icon: '🔮', glyph: '窥', title: '先知一闪', text: `幽灵线浮现（幻觉率 ${Math.round(m.foresightFake * 100)}%）`, cls: 'magic' });
    } else G.ghost = null;

    G.hints = hints;
    G.hintsHad = hints.some(h => ['insider', 'omni', 'follow', 'tape', 'foresight', 'dealer', 'radar'].includes(h.kind));
  }

  /* ── 行动 ───────────────────────────────────────────── */
  function openOrResize(dir, lev) {
    if (G.phase !== 'act') return false;
    const p = G.player;
    lev = clamp(Math.round(lev), 1, currentLevCap());
    const price = P();
    const E = equity();
    if (E <= 0) { toast('负权益不能开仓', 'bad', 1600); return false; }   // v1.8.7 债务状态禁止再加杠杆

    // 平掉旧仓（反手 / 加仓重开）
    if (p.pos) {
      const u = upnl();
      // v1.8.3 反手/加仓重开 = 手动平仓旧仓：裸奔浮亏同收行权费；v1.8.4 记入 actions 供小结对账
      if (u < 0 && p.riskMode === 'bare') chargeCut(p);
      p.stats.actions.push({ round: G.round, act: 'close', pnl: u, opened: p.pos.openedRound });
      if (p.pos.dir === dir) {
        p.consecutiveSameDir++;
      } else {
        p.consecutiveSameDir = 1;
        p.stats.flips++;
      }
      p.cash += p.pos.M + u;
      if (u > 0 && G.mods.tpBonus > 0) { creditTpBonus(p, u * G.mods.tpBonus); toast(`落袋为安 +${MC.fmt.money(u * G.mods.tpBonus)}`, 'good'); }
      p.pos = null;
    } else {
      p.consecutiveSameDir = p.lastDir === dir ? p.consecutiveSameDir + 1 : 1;
      // 追涨杀跌判定
      const lastRet = G.mkt.roundBounds[G.round].start >= 10 ?
        G.mkt.prices[b_start(G.round)] / G.mkt.prices[b_start(G.round) - 10] - 1 : 0;
      if ((dir > 0 && lastRet > 0.04) || (dir < 0 && lastRet < -0.04)) p.stats.chase++;
    }

    // 摊平成本
    let entryAdj = 0, feeMul = 1;
    if (G.mods.avgDown > 0 && p.consecutiveSameDir >= 2) {
      entryAdj = G.mods.avgDown; feeMul = G.mods.avgDownFee || 0.5;
      toast(`摊平成本：入场价改善`, 'good');
    }

    /* v3 仓位模型：保证金 = 身家 × capMul（基础 40%，巨鲸卡拉高）——
       下错方向最多亏掉保证金对应的敞口，而不是整副身家；杠杆只放大名义与强平距离 */
    const M = E * clamp(G.mods.capMul * (p.posSizeMul || 1), 0.05, 1.1);   // v1.9 仓位档参与保证金
    const N = M * lev;
    /* v1.7.2 拉盘手/摊平成本改为开仓后的行情推动（bend），不再是入场价优惠：
       旧版 entry 标记在开仓瞬间产生 N×pushPrice 的幻影浮盈，杠杆把它放大成几百%的虚高权益 */
    const pushTotal = (G.mods.pushPrice || 0) + entryAdj;
    const entry = price;
    p.cash -= M;
    let fee = spend(p, N * FEE * feeMul);
    p.feesThisRound += fee;
    // 风险档位 → 自动离场价（按轮初身家的浮亏/浮盈预算换算成价格）
    const risk = RISK_MODES[p.riskMode] || RISK_MODES.sl;
    // 只割不锁的期权保费：进 stats.fees 供对账，但不进 feesThisRound（返佣/退费基数），杜绝保费倒贴套利
    if (risk.id === 'cut') { const prem = spend(p, E * CUT_PREMIUM); p.stats.fees += prem; p.premiumThisRound = (p.premiumThisRound || 0) + prem; }
    let sl = null, tp = null;
    /* v1.7.1 止损线 = max(预算距离, 噪声地板)：旧版高杠杆时止损线落在噪声带内，
       方向做对的轮也会被随机游走扫掉——「K线按我的方向走却亏损」的根源。
       地板 = 本轮随机游走的典型逆向 excursion（vol 为剧本公开参数，tape 同口径） */
    const volEff = Math.max((G.scen.rounds[G.round - 1] || [0, 0, 0.01])[2] || 0.01, Math.abs(G.trueRet) * 0.18);
    const noiseFloor = ((MC.TUNE && MC.TUNE.floor) || 1.6) * volEff * Market.noise * Math.sqrt(TPR);   // v1.9 地板 1.2→1.6：止损线移到典型噪声 excursion 之外
    /* v1.9 止损线必须落在强平线内侧：旧版高杠杆时噪声地板(3–4%)宽于强平距离(25x≈3.5%)，
       方向做对的轮先撞强平 = 「K线方向对却爆仓」的最后一根刺；止损承诺(-10%E 兜底)依旧 */
    const mmrNow = MMR * (1 - G.mods.mmrCut);
    const liqDist = Math.max((1 / lev - mmrNow) * G.mods.liqBuffer, 0.0008);
    if (risk.sl > 0) {
      const mv = Math.min(Math.max(risk.sl * (1 + (G.mods.slWiden || 0)) * E / N, noiseFloor), liqDist * 0.85);
      sl = dir > 0 ? entry * (1 - mv) : entry * (1 + mv);
    }
    if (risk.tp > 0) {
      const mv = risk.tp * E / N;
      tp = dir > 0 ? entry * (1 + mv) : entry * (1 - mv);
    }
    p.pos = { dir, lev, entry, N, M, openedRound: G.round, patienceBonus: 0, sl, tp, risk: risk.id,
      slBudget: risk.sl * (1 + (G.mods.slWiden || 0)) * E };   // 止损的承诺：至多亏本轮身家的这个比例
    p.lastDir = dir;

    // 耐心爆发：攒的层数一次性转成本轮倍率加成
    if (G.mods.patientStack > 0 && p.patientStacks > 0) {
      p.pos.patienceBonus = p.patientStacks * G.mods.patientStack;
      toast(`耐心爆发 +${p.pos.patienceBonus.toFixed(2)}x`, 'gold');
      MC.Audio.play('patience');
      bus.emit('patience:burst', { stacks: p.patientStacks, bonus: p.pos.patienceBonus });
    }
    p.patientStacks = 0; p.curHoldStreak = 0;

    const st = p.stats;
    st.trades++; st.fees += fee; st.maxLev = Math.max(st.maxLev, lev);
    st.sumLev += lev; st.levOpens++;
    st.actions.push({ round: G.round, act: dir > 0 ? 'long' : 'short', lev });

    if (pushTotal > 0) {
      bendRound(G.trueRet + dir * pushTotal, 'pump');
      toast(`拉盘手：顺势推 ${(pushTotal * 100).toFixed(1)}%`, 'good');
    }
    MC.Audio.play('trade');
    bus.emit('trade', { dir, lev, entry, N, M, fee, sl, tp, risk: risk.id });
    startResolve('open');
    return true;
  }
  function b_start(r) { return G.mkt.roundBounds[r].start; }

  function closePosition(isPanic) {
    if (G.phase !== 'act') return false;
    const p = G.player;
    if (!p.pos) return hold();
    const u = upnl();
    if (u < 0 && p.riskMode === 'bare') chargeCut(p);   // v1.8.4 全部平仓（非恐慌）同价：堵第四路免费旁路
    p.cash += p.pos.M + u;
    if (u > 0 && G.mods.tpBonus > 0) creditTpBonus(p, u * G.mods.tpBonus);   // v1.8.6 留痕
    if (isPanic) p.stats.panic++;
    p.stats.actions.push({ round: G.round, act: 'close', pnl: u, opened: p.pos.openedRound });
    p.pos = null;
    p.consecutiveSameDir = 0;
    p.patientStacks = 0; p.curHoldStreak = 0;
    MC.Audio.play(isPanic ? 'panic' : 'trade');
    bus.emit('trade', { dir: 0, pnl: u, panic: isPanic });
    toast(`${isPanic ? '恐慌全平 ' : '平仓 '}${MC.fmt.signed(u)}`, u >= 0 ? 'good' : 'bad');
    startResolve('close');
    return true;
  }

  function hold() {
    if (G.phase !== 'act') return false;
    const p = G.player;
    p.stats.holdRounds++;
    p.curHoldStreak++;
    p.stats.maxHoldStreak = Math.max(p.stats.maxHoldStreak, p.curHoldStreak);
    if (G.mods.patientStack > 0 && !p.pos) {   // 只有空仓观望才积层（持仓「不动」= 续持，不是等待）
      p.patientStacks = Math.min(5, p.patientStacks + 1);
      p.stats.patienceMax = Math.max(p.stats.patienceMax, p.patientStacks);
      toast(`耐心 ${p.patientStacks}/5 层`, '', 1400);
      MC.Audio.play('patience');
    }
    if (G.mods.diamond) { p.diamondArmed = G.mods.diamondVal || 2; toast(`钻石手：下轮 ×${p.diamondArmed}`, 'good'); p.stats.diamondUses++; }
    p.stats.actions.push({ round: G.round, act: 'hold' });
    MC.Audio.play('click');
    bus.emit('status:changed');
    startResolve('hold');
    return true;
  }

  /* ── 结算阶段（UI 驱动逐 tick） ────────────────────── */
  function startResolve(action) {
    const p = G.player, b = G.mkt.roundBounds[G.round];
    G.phase = 'resolve';
    G.actionTaken = action;
    G.roundDir = p.pos ? p.pos.dir : 0;
    G.roundLev = p.pos ? p.pos.lev : 0;
    /* v1.8.7 轮初基准 = 本轮开始时的真实权益（含携带仓浮盈——它上轮已计入权益，本轮口径必须从它起算）。
       v1.7.2 的「减 upnl()」是为 pump 入场标记的幻影浮盈而生；v1.7.2 起 entry=市价，幻影不存在，
       减法反而把携带浮盈从基准里挖掉 → 同一笔浮盈逐轮重复吃倍率、真亏轮显示为胜（QA15 P1） */
    p.E_roundStart = equity();
    p.liquidatedThisRound = false;
    p.liqNearMin = 1;

    // 坐庄：持仓方向牵引本轮剩余行情
    if (G.mods.dealerDrift > 0 && p.pos) {
      const f = Math.pow(1 + G.mods.dealerDrift * p.pos.dir, 1 / TPR);
      for (let i = b.start + 1; i <= b.end; i++) {
        G.mkt.prices[i] = G.mkt.prices[i - 1] * (G.mkt.prices[i] / G.mkt.prices[i - 1]) * f;
      }
      G.trueRet = G.mkt.prices[b.end] / G.mkt.prices[b.start] - 1;
    }
    /* v1.1 舆论造势：替玩家仓位造势（方向由玩家决定）。只改写未揭示段——此刻 revealedTick = 轮起点 */
    if (G.mods.rumorPush > 0 && p.pos && G.rnd.chance(G.mods.rumor)) {
      bendRound(G.trueRet + p.pos.dir * G.mods.rumorPush, 'rumor');
      p.stats.rumorVictims++;   // 历史字段名保留（THEME-GUIDE 已公开），语义 = 造势成功次数
      G.roundInfo.rumorFired = true;
      toast(`舆论造势 +${(G.mods.rumorPush * 100).toFixed(1)}%`, 'gold');
    }
    // bot 执行本轮计划
    for (const bot of G.bots) Bots.reposition(bot, { P: P(), emit: (ev, b2) => bus.emit(ev === 'botBust' ? 'bot:bust' : 'bot:revive', b2) });

    bus.emit('phase', 'resolve');
  }

  function stepTick() {
    if (G.phase !== 'resolve') return { done: true };
    const b = G.mkt.roundBounds[G.round];
    if (G.revealedTick >= b.end) return { done: true };
    G.revealedTick++;
    const price = P();
    const p = G.player;
    let liqNear = 0, event = null;

    // bot 逐 tick
    for (const bot of G.bots) Bots.tick(bot, price, { emit: (ev, x) => bus.emit(ev === 'botBust' ? 'bot:bust' : 'bot:revive', x), roundStart: true });

    const events = [];
    if (p.pos) {
      const u = upnl();
      /* v1.9 利润锁阶梯（只割不锁档除外——它的名字就是不上锁）：浮盈每上一档，止损线上移锁住一半以上，
         「先显示赚、界面一跳变亏」变成「越赚锁得越多」；方向做对的轮至少带着锁定的利润离场 */
      const tpE = (RISK_MODES[p.riskMode] || RISK_MODES.sl).tp || 0;
      if (p.pos.sl != null && tpE > 0) {   // v1.9.2 阶梯置于止盈带内（旧版二档=13%=止盈同点，永被止盈抢占 → 锁利离场行不可达）
        const E0g = Math.max(p.E_roundStart, 1);
        const LADDER = [[0.4 * tpE, 0], [0.7 * tpE, 0.4 * tpE], [0.92 * tpE, 0.6 * tpE], [1.6 * tpE, 1.1 * tpE], [2.4 * tpE, 1.8 * tpE]];
        const lvl = p.pos.beLvl || 0;
        if (lvl < LADDER.length && u >= LADDER[lvl][0] * E0g) {
          p.pos.beLvl = lvl + 1;
          const lockAt = LADDER[lvl][1] * E0g;   // 锁定的权益利润
          p.pos.lockVal = lockAt;   // v1.9.1 锁定值入账：stopOut 按此兜底，跳空打不穿锁
          const mv = lockAt / (p.pos.N || 1);    // 换算成价格距离
          p.pos.sl = p.pos.dir > 0 ? p.pos.entry * (1 + mv) : p.pos.entry * (1 - mv);
          toast(lockAt === 0 ? '已锁保本' : `已锁 +${Math.round(lockAt / E0g * 100)}%`, 'good', 1200);
        }
      }
      // 大而不倒：单轮亏损封顶
      const uRound = u - (G.roundInfo.carryMark || 0);   // v1.8.5 大而不倒按本轮亏损判定（携带仓剔除前轮标记）
      if (G.mods.lossCap > 0 && uRound < -G.mods.lossCap * Math.max(p.E_roundStart, 1)) {
        const capped = -G.mods.lossCap * Math.max(p.E_roundStart, 1);   // v1.8.7 债务轮基准兜底 1
        const carry0 = G.roundInfo.carryMark || 0;
        p.cash += p.pos.M + carry0 + capped;   // v1.8.7 携带仓：前轮标记须随仓返还，否则现金凭空少一块
        p.stats.actions.push({ round: G.round, act: 'losscap', pnl: capped + carry0, opened: p.pos.openedRound });
        p.pos = null;
        events.push({ type: 'losscap', loss: capped });
      } else {
        // 止损 / 止盈：先于强平判定（风险预算花完就离场，轮内自动执行）
        const hitSl = p.pos.sl != null && (p.pos.dir > 0 ? price <= p.pos.sl : price >= p.pos.sl);
        const hitTp = !hitSl && p.pos.tp != null && (p.pos.dir > 0 ? price >= p.pos.tp : price <= p.pos.tp);
        const lp = liqPrice();
        const hit = p.pos.dir > 0 ? price <= lp : price >= lp;
        // 跳空同时越过止损线与强平线：按强平处理（保留 10% + 救市），不许「止损」亏穿保证金把身家打成 0
        if ((hitSl || hitTp) && !(hitSl && hit)) {
          events.push(stopOut(hitTp ? 'tp' : 'sl'));
        } else {
          if (hit) {
            events.push(...liquidate());
          } else {
            const dist = lp ? Math.abs(price - lp) / price : 1;
            if (dist < p.liqNearMin) p.liqNearMin = dist;
            liqNear = clamp(1 - dist / 0.06, 0, 1);
          }
        }
      }
    }
    if (events.length) event = events[0];

    const eq = equity();
    G.tickCurve.push({ t: G.revealedTick, eq });
    if (eq > G.peak) G.peak = eq;
    if (eq < G.trough) G.trough = eq;

    // 身家里程碑（非阻塞庆祝事件）
    for (const mult of MILESTONES) {
      if (eq >= p.start * mult && !p.milestonesHit[mult]) {
        p.milestonesHit[mult] = true;
        p.stats.milestones++;
        events.push({ type: 'milestone', mult, eq });
      }
    }

    return {
      done: G.revealedTick >= b.end,
      i: G.revealedTick, price, eq,
      upnl: p.pos ? upnl() : 0,
      liqNear, event, events,
      trueRet: price / G.mkt.prices[b.start] - 1,
    };
  }

  /* 止损/止盈自动离场：按触发 tick 的价格平仓，剩余轮次空仓观看 */
  function stopOut(kind) {
    const p = G.player;
    const openedR = p.pos.openedRound;
    const lockInfo = { lock: p.pos.lockVal || 0, beLvl: p.pos.beLvl || 0 };   // v1.9.2 pos 置空前提取
    let u = Math.max(upnl(), -p.pos.M);   // 自动离场最多亏掉保证金（跳空按市价成交，但不穿仓）
    // v1.7.1 止损档兑现承诺：「浮亏 10% 自动全平」= 最多亏 10% 轮初权益，噪声插针不多收
    if (kind === 'sl' && p.pos.slBudget) u = Math.max(u, -p.pos.slBudget);
    // v1.9.1 利润锁是承诺不是建议：跳空穿过锁定线时按锁定价成交（曾浮盈 5%E 后亏损收盘 5.8% → 契约 ≤2%）
    if (kind === 'sl' && p.pos.lockVal != null) u = Math.max(u, p.pos.lockVal);
    const uMarket = u;   // v1.8.4 小结/明细记市价盈亏，行权费单列——naive 求和不再双计
    if (kind === 'cash' && u < 0 && p.riskMode === 'bare') chargeCut(p);
    p.cash += p.pos.M + uMarket;
    if (u > 0 && G.mods.tpBonus > 0) creditTpBonus(p, u * G.mods.tpBonus);   // v1.8.6 留痕
    p.pos = null;
    p.consecutiveSameDir = 0;
    p.patientStacks = 0; p.curHoldStreak = 0;
    if (kind === 'tp') p.stats.tps++; else if (kind === 'cash') p.stats.cashouts++; else p.stats.stops++;
    p.stats.actions.push({ round: G.round, act: kind, pnl: uMarket, opened: openedR, lock: lockInfo.lock, beLvl: lockInfo.beLvl });   // v1.9.2 锁信息随行：小结可区分保本/锁利离场
    bus.emit('trade', { dir: 0, pnl: u, stop: kind });
    return { type: kind, pnl: uMarket };
  }

  /* v1.2 盘中落袋（crash 式见好就收）：逐 tick 演出中唯一的交互。按当前 tick 平仓，剩余行情空仓观看；
     快照仓位留给轮末算「若扛到收盘」的反事实与逃顶判定（轮末才算——绝不泄露未来） */
  function cashOut() {
    if (!G || G.phase !== 'resolve' || !G.player.pos) return null;
    const b = G.mkt.roundBounds[G.round];
    if (G.revealedTick >= b.end) return null;
    const p = G.player;
    const snap = Object.assign({}, p.pos, { tick: G.revealedTick, lp: liqPrice() });
    const ev = stopOut('cash');
    G.roundInfo.cashSnap = Object.assign(snap, { pnl: ev.pnl });
    MC.Audio.play('trade');
    return ev;
  }

  /* 反事实：快照仓位扛完本轮剩余 tick（照常吃止损/止盈/强平）的盈亏；best = 本轮任一 tick 平仓的最好盈亏 */
  function cashCounterfactual(s) {
    const b = G.mkt.roundBounds[G.round];
    const u = i => s.N * (G.mkt.prices[i] / s.entry - 1) * s.dir;
    let held = null, heldExit = 'close', best = -Infinity;
    for (let i = b.start + 1; i <= b.end; i++) {
      if (i <= s.tick || held === null) best = Math.max(best, u(i));
      if (i <= s.tick || held !== null) continue;
      const pr = G.mkt.prices[i];
      const hitSl = s.sl != null && (s.dir > 0 ? pr <= s.sl : pr >= s.sl);
      const hitTp = !hitSl && s.tp != null && (s.dir > 0 ? pr >= s.tp : pr <= s.tp);
      const hitLiq = s.lp != null && (s.dir > 0 ? pr <= s.lp : pr >= s.lp);
      if (hitSl || hitTp) { held = u(i); heldExit = hitTp ? 'tp' : 'sl'; }
      else if (hitLiq) { held = -s.M; heldExit = 'liq'; }
    }
    if (held === null) held = u(b.end);
    return { held, heldExit, best };
  }

  function liquidate() {
    const p = G.player;
    const uLiq = Math.max(upnl(), -p.pos.M), openedR = p.pos.openedRound;   // v1.8.5 先取值后清仓
    const eqBefore = equity();   // v1.8.5 对账：强平真实权益变动 = 保底现金 - 强平前权益（含保证金与浮亏）
    const events = [];
    const keepRatio = (G.mods.reviveOnce && !p.reviveUsed) ? 0.20 : 0.10;
    if (keepRatio > 0.10) p.reviveUsed = true;
    p.cash = Math.max(p.E_roundStart * keepRatio, 500);   // 爆仓后至少留 ¥500 操作空间（旧 200 连手续费都不够）
    const liqDelta = p.cash - p.E_roundStart;   // v1.8.6 含开盘至强平的浮亏段；手续费自有单行，此处不得加回（v1.8.5 双计）
    p.pos = null;
    p.liquidatedThisRound = true;
    p.gamblerRevive = true;
    p.stats.liqs++;
    p.stats.actions.push({ round: G.round, act: 'liq', pnl: liqDelta, opened: openedR });
    p.consecutiveSameDir = 0;
    events.push({ type: keepRatio > 0.10 ? 'revive' : 'liquidated', keep: p.cash });
    // 国家队救市
    if (p.cash < p.start * 0.2 && !p.rescueUsed) {
      p.rescueUsed = true;
      const before = p.cash;
      p.cash = p.start * 0.25;
      p.rescueAmt = (p.rescueAmt || 0) + (p.cash - before);
      events.push({ type: 'rescue', cash: p.cash });
    }
    return events;
  }

  /* 倍率条件上下文：结算与 HUD 实时芯片共用一份口径。
     涨跌一律用「已揭示」价格计算——轮末等于 trueRet，轮中绝不泄露未来行情 */
  function multCtx() {
    const p = G.player, b = G.mkt.roundBounds[G.round];
    const ret = P() / G.mkt.prices[b.start] - 1;
    const ri = G.roundInfo || {};
    const mag = Math.abs(ret) * 100;
    /* v1.2 盈利落袋保留「方向/仓位」类条件（跟情报、跟首富、幽灵线、名义仓位、持仓轮数）；
       只有「活到收盘」类（pos：风控雷达/擦弹而过/时间价值/刀口舔血）随落袋作废 */
    const cs = ri.cashSnap;
    const dp = p.pos || (cs && cs.pnl > 0.5 ? cs : null);
    return {
      round: G.round, isFinal: G.round >= ROUNDS,
      equity: equity(), start: p.start,
      pos: p.pos, dir: dp ? dp.dir : 0, lev: dp ? dp.lev : 0,
      notionalRatio: dp ? dp.N / Math.max(p.E_roundStart, 1) : 0,
      heldRounds: dp ? G.round - dp.openedRound + 1 : 0,
      trueRet: ret, volBig: Math.abs(ret) > 0.08,
      hadHint: !!G.hintsHad, hintCount: (G.hints || []).length,
      followedHint: !!(dp && ri.hintDir && dp.dir === ri.hintDir),
      followedLeader: !!(dp && ri.leaderDir && dp.dir === ri.leaderDir),
      tapeHit: !!(ri.tapeRange && mag >= ri.tapeRange.lo && mag <= ri.tapeRange.hi),
      ghostHit: !!(dp && ri.ghostDir && dp.dir === ri.ghostDir),
      liqNearMin: p.liqNearMin,
      action: G.actionTaken,
      tradePnl: equity() - p.E_roundStart,
    };
  }

  /* 落袋代价预览（落袋按钮实时显示）：此刻落袋会让哪些已达成的倍率失效。
     只比较「活到收盘」一维（pos→null），不读未来行情 */
  function cashLoss() {
    if (!G || G.phase !== 'resolve' || !G.player.pos) return { n: 0, mult: 1 };
    const p = G.player;
    const ctx = multCtx(), ctx2 = Object.assign({}, ctx, { pos: null });
    // 随持仓消失的动态源：耐心爆发（加法，开仓轮）、刀口舔血（裸奔 ×1.15）
    const posExtras = [];
    if (p.pos.patienceBonus > 0 && p.pos.openedRound === G.round) posExtras.push({ key: 'patience', op: '+', val: p.pos.patienceBonus });
    if (p.pos.risk === 'bare') posExtras.push({ key: 'bare', op: 'x', val: 1.15 });
    const keep = Buffs.evalMult(G.mods, ctx, posExtras), lose = Buffs.evalMult(G.mods, ctx2, []);
    const keys = new Set(lose.adds.concat(lose.muls).map(x => x.src));
    const n = keep.adds.concat(keep.muls).filter(x => !keys.has(x.src)).length;
    return { n, mult: lose.total > 0 ? keep.total / lose.total : 1 };
  }

  /* 条件倍率卡的实时状态（HUD 芯片）：构筑页买下的每张条件卡，局中都能看见「待命 / 达成 / 正在兑现」
     ——条件卡此前只在盈利轮结算时出现一次，玩家感知不到它存在 */
  function condStates() {
    if (!G || !G.mods) return [];
    const live = G.phase === 'resolve' || G.phase === 'between';
    const ctx = live ? multCtx() : null;
    const out = [];
    for (const s of (G.mods.multCond || [])) {
      if (typeof s.val !== 'number') continue;
      let met = false;
      if (ctx && s.test) { try { met = !!s.test(ctx); } catch (e) { met = false; } }
      out.push({ key: s.key, name: s.name, icon: s.icon, school: s.school, val: s.val, label: s.label, met, pay: met && ctx.tradePnl > 0.5 });
    }
    return out;
  }

  /* 最后一 tick 之后：轮末结算（UI 调 nextRound 前先调这个）
     v2 结算管线：交易盈亏 → 收益倍率引擎(逐源演出) → SEC 罚没 → 固定加成 */
  function settleRoundEnd() {
    if (G.phase !== 'resolve') return null;
    const p = G.player, m = G.mods, b = G.mkt.roundBounds[G.round];
    const priceEnd = P();
    const trueRet = G.trueRet;
    const notes = [];

    /* 轮内自动离场明细：止损/强平后行情可能继续朝原方向走，但仓位已平、盈亏已锁死。
       「方向对 ≠ 赚钱」必须给出离场原因，否则玩家看到阳线收盘却亏损会当成 bug
       （盘中 centerFlash 只闪 1 秒；结算 notes 是可回看的凭证，与K线上的止损/强平虚线呼应） */
    const carry = G.roundInfo.carryMark || 0;
    const rpn = a => (a.act === 'liq' ? a.pnl : a.pnl - ((a.opened !== undefined && a.opened < G.round) ? carry : 0));   // v1.8.5 本轮口径；v1.8.7 强平行天然是本轮口径（keep−E0），不再减 carry
    for (const a of p.stats.actions) {
      if (a.round !== G.round) continue;
      if (a.act === 'sl') {
        const v = rpn(a);
        // v1.9.2 锁离场三态：锁利（锁定档>0）/ 保本（一档锁、≈0 也列行，它是承诺兑现的凭证）/ 真止损
        const lab = a.beLvl >= 1 ? (a.lock > 0.5 ? '锁利离场' : '保本离场') : '止损离场';
        const cls = a.beLvl >= 1 ? (v >= -0.5 ? 'good' : 'bad') : (v >= 0 ? 'good' : 'bad');
        const amt = lab === '保本离场' && Math.abs(v) <= 0.5 ? '' : ` ${MC.fmt.signed(v)}`;   // 保本≈0 时不写金额（零额行契约），凭证语义保留
        notes.push({ text: `${lab}${amt} · 后续行情与仓位无关`, cls });
      }   // v1.9 利润锁触发的「止损」是落袋
      else if (a.act === 'tp') notes.push({ text: `止盈落袋 ${MC.fmt.signed(rpn(a))}`, cls: 'good' });
      else if (a.act === 'liq') notes.push({ text: `爆仓强平 ${MC.fmt.signed(rpn(a))} · 盈亏锁定在触发 tick`, cls: 'bad' });
      else if (a.act === 'cash' && Math.abs(rpn(a)) > 0.5) notes.push({ text: `盘中落袋 ${MC.fmt.signed(rpn(a))}`, cls: rpn(a) >= 0 ? 'good' : '' });   // v1.8.10 零额不列行
      else if (a.act === 'losscap' && Math.abs(rpn(a)) > 0.5) notes.push({ text: `大而不倒 · 亏损封顶 ${MC.fmt.signed(rpn(a))}`, cls: 'bad' });
      else if (a.act === 'close' && Math.abs(rpn(a)) > 0.5) notes.push({ text: `平仓盈亏 ${MC.fmt.signed(rpn(a))}`, cls: rpn(a) >= 0 ? 'good' : 'bad' });   // v1.8.9 零额不列行
      else if (a.act === 'forceclose') notes.push({ text: `监管强制平仓 ${MC.fmt.signed(rpn(a))}`, cls: rpn(a) >= 0 ? 'good' : 'bad' });
    }
    if (carry !== 0) notes.push({ text: '含携带仓：前轮已计浮盈不重复计入本轮', cls: '' });

    G.forceCloseNotes = [];   // v1.8.9 本轮刹车产生的强制平仓凭证（循环后补行）
    const exActPaid = p.exerciseFeeAct || 0;   // v1.8.9 先取再用：行块会清零
    const tpBonusActPaid = p.tpBonusAct || 0;
    let roundPnl = equity() - p.E_roundStart;
    const tradePnl = roundPnl;

    // 盘中落袋的反事实：躲过多少 / 卖飞多少；吃到本轮最优盈亏 90% 以上 = 神级逃顶（倍率源）
    let cashInfo = null;
    const cs = G.roundInfo && G.roundInfo.cashSnap;
    if (cs) {
      const cf = cashCounterfactual(cs);
      const delta = cs.pnl - cf.held;
      // 本轮最优可得 < 3% 轮初权益 = 没有「顶」可逃，不发逃顶倍率（防止第一个绿 tick 就刷 ×1.8）
      const tier = cs.pnl > 0.5 && cf.best > 0.03 * Math.max(p.E_roundStart, 1) ? SNIPE_TIERS.find(t => cs.pnl >= cf.best * t.r) || null : null;
      const snipe = !!tier && tier.key === 'snipe';
      cashInfo = { pnl: cs.pnl, held: cf.held, heldExit: cf.heldExit, delta, snipe, tier: tier ? tier.key : null, capture: cf.best > 0 ? cs.pnl / cf.best : 0 };
      p.stats.cashSaved += delta;
      if (snipe) p.stats.snipes++;
      // 文案口径：差额由「显示后的取整值」相减，玩家心算对得上
      const heldR = Math.round(cf.held), dR = Math.round(cs.pnl) - heldR;
      const why = cf.heldExit === 'liq' ? '扛着会爆仓' : cf.heldExit === 'sl' ? `扛着会止损 ${MC.fmt.signed(heldR)}`
        : cf.heldExit === 'tp' ? `扛着会止盈 ${MC.fmt.signed(heldR)}` : `扛到收盘 ${MC.fmt.signed(heldR)}`;
      const head = cs.pnl >= 0 ? '见好就收' : '及时止损';
      if (dR > 0) notes.push({ text: `${head} · ${why} · 多保住 ${MC.fmt.money(dR)}`, cls: 'good' });
      else if (dR < 0) notes.push({ text: `${cs.pnl >= 0 ? '卖飞了' : '割早了'} · ${why} · ${cs.pnl >= 0 ? '少赚' : '多亏'} ${MC.fmt.money(-dR)}`, cls: 'bad' });
    }

    // 雪球累积（本轮立即生效）
    const snowGain = (m.compoundSnow || 0) + (m.setSnow || 0);
    if (snowGain > 0) p.snowMult += snowGain;

    // ── 收益倍率引擎：只放大盈利轮 ──
    let multInfo = null, raidSeized = 0;
    if (roundPnl > 0.5 && !p.liquidatedThisRound) {   // 爆仓轮的「盈利」是保底/救市金，不吃倍率
      const ctx = multCtx();
      // 动态源（引擎状态驱动）
      const extras = [];
      if (p.diamondArmed > 0) {
        extras.push({ key: 'diamond', name: '钻石手', icon: '钻', school: 'wild', slotIdx: null, op: 'x', val: p.diamondArmed, label: '上轮蓄能' });
      }
      if (p.winStreakEnter >= 2) {
        extras.push({ key: 'streak', name: '热手连胜', icon: '连', school: 'wild', slotIdx: null, op: '+', val: Math.min(0.3, 0.05 * (p.winStreakEnter - 1)), label: `${p.winStreakEnter} 连胜` });
      }
      if (p.snowMult > 0) {
        extras.push({ key: 'snow', name: '雪球复投', icon: '滚', school: 'econ', slotIdx: null, op: '+', val: p.snowMult, label: `已滚 ${Math.round(p.snowMult * 100) / 100}x` });
      }
      if (m.gamblerReroll && p.rerollsThisRound > 0) {
        extras.push({ key: 'gambler', name: '赌徒狂热', icon: '赌', school: 'wild', slotIdx: null, op: '+', val: p.rerollsThisRound * 0.05, label: `本轮刷了 ${p.rerollsThisRound} 次` });
      }
      if (p.pos && p.pos.patienceBonus > 0 && p.pos.openedRound === G.round) {   // 只兑现开仓那一轮
        extras.push({ key: 'patience', name: '耐心爆发', icon: '忍', school: 'econ', slotIdx: null, op: '+', val: p.pos.patienceBonus, label: '等待的复利' });
      }
      if (p.pos && p.pos.risk === 'bare') {
        extras.push({ key: 'bare', name: '刀口舔血', icon: '刃', school: 'wild', slotIdx: null, op: 'x', val: 1.15, label: '裸奔到轮末（无止损）' });
      }
      if (cashInfo && cashInfo.tier) {
        const t = SNIPE_TIERS.find(x => x.key === cashInfo.tier);
        extras.push({ key: t.key, name: t.name, icon: '狙', school: 'wild', slotIdx: null, op: 'x', val: t.val, label: `落袋吃到本轮最优的 ${Math.round(cashInfo.capture * 100)}%` });
      }
      if (m.critChance > 0 && G.rnd.chance(m.critChance)) {
        ctx.critHit = true;
        extras.push({ key: 'crit', name: '会心一击！', icon: '暴', school: 'wild', slotIdx: null, op: 'x', val: m.critMult || 2.5, label: '暴击！', crit: true });
      }

      const ev = Buffs.evalMult(m, ctx, extras);
      if (ev.total > 1.001) {
        /* v4：硬封顶已拆除。软阈值内全额兑现；超额越大越可能引来 SEC 突击检查
           （没收超额 60%）——刹车是叙事化的监管，不是数字截断 */
        const rawGain = roundPnl * (ev.total - 1);
        const heat = p.raidHeat || 0;   // 惯犯升温：被查过就越被盯紧——安全区收窄、没收率提高
        const safe = Math.max(1.0, SOFT_CAP - 0.3 * heat) * Math.max(p.E_roundStart, 1);   // v1.8.7 债务轮基准兜底
        let gain = rawGain;
        if (rawGain > safe) {
          const excess = rawGain - safe;
          const pRaid = Math.min(0.95, 0.25 + 0.12 * heat + excess / (5 * p.E_roundStart)) * (1 - (m.regCut || 0));
          if (G.rnd.chance(pRaid)) {
            forceRealize();   // v1.8.8 先落袋为现金，没收才咬得住
            raidSeized = spend(p, excess * Math.min(0.9, RAID_SEIZE + 0.06 * heat));
            gain = rawGain - raidSeized;
            p.raidHeat = heat + 1;   // v1.8.6 没收已体现在下面的「倍率放大」净额里，不再单列（旧版双扣）
          }
        }
        const effTotal = 1 + gain / roundPnl;
        p.cash += rawGain;   // v1.8.6 spend() 已扣没收额，此处加毛收益（旧版 gain 再扣一次 = 双扣）
        roundPnl += gain;
        if (gain > 0.5) notes.push({ text: `倍率放大 ${MC.fmt.signed(gain)}${raidSeized > 0 ? '（SEC 已没收超额）' : ''}`, cls: 'good' });   // v1.8.5 对账行；v1.8.10 零额不列行
        p.stats.bonusTotal += gain;
        p.stats.maxMult = Math.max(p.stats.maxMult, effTotal);
        if (ctx.critHit) p.stats.crits++;
        if (!G.bestChain || effTotal > G.bestChain.total) G.bestChain = { total: effTotal, round: G.round, gain, base: tradePnl };
        if (p.diamondArmed > 0) p.diamondArmed = 0;
        multInfo = {
          base: tradePnl, total: effTotal, rawTotal: ev.total, gain, crit: !!ctx.critHit,
          raid: raidSeized > 0 ? raidSeized : null,
          steps: ev.adds.concat(ev.muls).map(x => ({
            key: x.src.key, name: x.src.name, icon: x.src.icon, school: x.src.school,
            slotIdx: x.src.slotIdx === undefined ? null : x.src.slotIdx,
            op: x.src.op, val: x.v, label: x.src.label || '', crit: !!x.src.crit,
          })),
        };
      } else if (p.diamondArmed > 0) {
        // 亏损轮不消耗钻石蓄能（原语义保留）
      }
    }

    /* v1.7 总刹车：单轮总盈利（含交易盈亏本身）超过软阈值也进突击检查没收池——
       旧版只管倍率加成部分，管不住「信息×杠杆」拉出来的基础盈亏复利 */
    {
      const heat2 = p.raidHeat || 0;
      const safeAll = Math.max(1.0, SOFT_CAP - 0.3 * heat2) * Math.max(p.E_roundStart, 1);
      if (roundPnl > safeAll) {
        const excess = roundPnl - safeAll;
        const pRaid = Math.min(0.95, 0.3 + 0.12 * heat2 + excess / (5 * p.E_roundStart)) * (1 - (m.regCut || 0));
        if (G.rnd.chance(pRaid)) {
          forceRealize();   // v1.8.8
          const seized = spend(p, excess * Math.min(0.9, RAID_SEIZE + 0.06 * heat2));
          roundPnl -= seized;
          p.raidHeat = heat2 + 1;
          if (seized > 0.5) notes.push({ text: `SEC 突击没收 -${MC.fmt.money(seized)}`, cls: 'bad' });   // v1.8.6 零额不列行
          if (!raidSeized) raidSeized = seized;
        }
      }
    }

    /* v1.7 深度上限（确定性硬刹车）：单轮权益倍数封顶，惯犯逐级收紧。
       概率没收挡不住「按比例复利」，只有与身家解耦的增长率上限能把任何坡道变成有界曲线 */
    {
      const heat3 = p.raidHeat || 0;
      const growCap = Math.max(1.35, 2.4 - 0.3 * heat3);   // v1.9.2 地板 1.45→1.35：carryWhale6 回历史上界内
      const maxEq = Math.max(p.E_roundStart, 1) * growCap;
      const eqNow = equity();
      if (eqNow > maxEq) {
        forceRealize();   // v1.8.8 浮盈锁在仓里时现金上限会架空深度上限
        const eaten = spend(p, equity() - maxEq);
        roundPnl -= eaten;
        p.raidHeat = heat3 + 1;
        if (eaten > 0.5) notes.push({ text: `深度上限 ×${growCap.toFixed(1)} · 滑点吃掉 -${MC.fmt.money(eaten)}`, cls: 'bad' });   // v1.8.5 金额带符号入对账；v1.8.6 零额不列行
      }
    }

    // SEC 关注函：收益罚没（对倍率放大后的收益生效——膨胀的刹车）
    if (p.profitPenalty > 0 && roundPnl > 0) {
      const take = spend(p, roundPnl * p.profitPenalty);
      roundPnl -= take;
      if (take > 0.5) notes.push({ text: `SEC 罚没 -${MC.fmt.money(take)}`, cls: 'bad' });   // v1.8.6 零额不列行
      p.profitPenalty = 0;
    }

    const E = () => equity();
    const addBonus = (amount, label) => {
      if (amount <= 0.5) return;
      p.cash += amount;
      p.stats.bonusTotal += amount;
      notes.push({ text: `${label} +${MC.fmt.money(amount)}`, cls: 'good' });
      bus.emit('coinburst', { amount, label });   // 现金落袋 = 爆金币演出的触发点
    };

    /* 跳过返还按敞口兑现：名义 ≥ 2 倍权益（≈5x）全额，1x 只返 20%；没持仓/爆仓作废——堵「跳过+1x」稳赚 */
    if (p.skipRefund) {
      const expo = G.roundDir && !p.liquidatedThisRound ? Math.min(1, (G.roundLev || 0) * clamp(m.capMul * (p.posSizeMul || 1), 0.05, 1.1) / 2) : 0;
      if (expo > 0) addBonus(p.skipRefund * expo, expo < 1 ? `跳过返还 ${Math.round(expo * 100)}%` : '跳过返还');
      else notes.push({ text: '跳过返还作废 · 本轮没有有效持仓', cls: '' });
      p.skipRefund = 0;
    }
    const premPaid = p.premiumThisRound || 0;
    if (premPaid > 0.5) { notes.push({ text: `只割不锁保费 -${MC.fmt.money(premPaid)}`, cls: '' }); p.premiumThisRound = 0; }
    if (p.exerciseFee) { notes.push({ text: `裸奔行权费 -${MC.fmt.money(p.exerciseFee)}`, cls: '' }); p.exerciseFee = 0; }
    p.exerciseFeeAct = 0; p.tpBonusAct = 0;
    if (p.feesThisRound > 0.5) notes.push({ text: `开仓手续费 -${MC.fmt.money(p.feesThisRound)}`, cls: '' });   // v1.8.5 对账行
    if (p.rescueAmt) { notes.push({ text: `国家队救市 +${MC.fmt.money(p.rescueAmt)}`, cls: 'good' }); p.rescueAmt = 0; }
    if (p.tpBonusRound > 0.5) { notes.push({ text: `落袋为安奖金 +${MC.fmt.money(p.tpBonusRound)}`, cls: 'good' }); p.tpBonusRound = 0; } else p.tpBonusRound = 0;   // v1.8.10 零额不列行
    const pm = passiveMul();
    if (!p.pos && m.interest > 0) addBonus(E() * m.interest * pm, '稳定币利息');
    if (m.snowball > 0) addBonus(E() * m.snowball * pm, '雪球复投');
    if (p.pos && m.funding > 0) addBonus(p.pos.N * m.funding, '资金费率');
    if (roundPnl < 0 && !p.liquidatedThisRound && m.lossCut > 0) addBonus(-roundPnl * m.lossCut, '对冲返还');
    if (m.feeRebate > 0 && p.feesThisRound > 0) addBonus(p.feesThisRound * m.feeRebate, '做市返佣');
    if (p.riskMode === 'both' && p.feesThisRound > 0) addBonus(p.feesThisRound * 0.5, '双保险退费');
    // 引擎轰鸣：构筑本身会印钱——静态倍率越高，每轮固定落袋越多（buff 叠加的直接分红）
    if (m.multBase >= 1.3) addBonus(E() * ENGINE_IDLE * (m.multBase - 1) * pm, '引擎轰鸣');

    // 连胜更新
    if (roundPnl > 0.5) p.winStreak++; else p.winStreak = 0;
    // 惯犯热度衰减：安静一轮降 1（旧版只升不降，后期幸运局也被永久压到 ×1.5）
    if (roundPnl <= 0.5 * Math.max(p.E_roundStart, 1) && p.raidHeat > 0) p.raidHeat = p.raidHeat - 1;

    // 方向对错统计：按本轮实际持有的方向（盘中止损/落袋/强平的轮次也算）
    {
      const dir = G.roundDir || 0;   // 全部平仓的轮次没有敞口，不计对错
      if (dir) {
        if (dir * trueRet > 0) p.stats.correctDirs++; else p.stats.wrongDirs++;
      }
    }

    const Eend = equity();
    roundPnl = Eend - p.E_roundStart;
    p.stats.bestRound = Math.max(p.stats.bestRound, roundPnl / p.E_roundStart);
    p.stats.worstRound = Math.min(p.stats.worstRound, roundPnl / p.E_roundStart);
    G.equityCurve.push({ round: G.round, eq: Eend });
    if (Eend > G.peak) G.peak = Eend;
    if (Eend < G.trough) G.trough = Eend;

    // bot 轮末
    for (const bot of G.bots) Bots.settleRound(bot, priceEnd);

    // ── 监管判定 ──
    G.pendingEvents = [];
    G.regEvents = G.regEvents || [];
    // SEC 突击检查（超额倍率召唤的叙事化刹车）：电报在轮末演出
    if (raidSeized > 0) {
      p.stats.regs++;
      G.regLog.push('raid');
      G.regEvents.push({ kind: 'raid', round: G.round });
      G.pendingEvents.push({ kind: 'raid', seized: raidSeized, heat: p.raidHeat || 1 });
    }
    const retOnEq = Eend / Math.max(p.E_roundStart, 1) - 1;   // v1.8.7 债务轮基准兜底
    // v1.8 稳态复利刹车：身家越大，触发窗口指导的单轮盈利阈值越低（旧版恒 0.5，+25%/轮的坡道永远碰不到）
    const sizeNow = equity() / p.start;
    const heatThr = sizeNow >= 4 ? 0.15 : sizeNow >= 2 ? 0.25 : 0.5;   // v1.9.2 稳态坡道阈值再收紧（oracle 携带线 19%/轮 复利）
    if (retOnEq > heatThr) { p.highProfitRounds++; } else p.highProfitRounds = 0;
    if (p.highProfitRounds === 3) {
      const cut = 0.3 * (1 - m.regCut);   // v1.9.1 回调 25%→30%（carryWhale6 7.14x 超历史上界）
      p.profitPenalty = cut;
      p.stats.regs++;
      G.regLog.push('sec');
      G.regEvents.push({ kind: 'sec', round: G.round });
      G.pendingEvents.push({ kind: 'sec', penalty: cut });
    } else if (p.highProfitRounds >= 5) {
      // 窗口指导：连续 5 轮暴利 = 任何复利坡道（全视/内幕+雷达/…）的硬刹车，罚没下一轮盈利的 60%
      p.highProfitRounds = 3;
      const cut = 0.6 * (1 - m.regCut);   // v1.9.1 回调 50%→60%
      p.profitPenalty = Math.max(p.profitPenalty || 0, cut);
      p.stats.regs++;
      G.regLog.push('sec');
      G.regEvents.push({ kind: 'sec', round: G.round });
      G.pendingEvents.push({ kind: 'sec', penalty: cut });
      notes.push({ text: `窗口指导 · 下轮盈利罚没 ${Math.round(cut * 100)}%`, cls: 'bad' });
    }
    if ((G.roundLev || 0) > 20) p.highLevRounds++; else p.highLevRounds = 0;   // 按本轮开过的杠杆判（盘中落袋不能规避拔网线）
    if (p.highLevRounds >= 3) {
      p.highLevRounds = 0;
      p.stats.regs++;
      G.regLog.push('plug');
      G.regEvents.push({ kind: 'plug', round: G.round });
      // 强制降至 5x
      if (p.pos) {
        const u = upnl();
        p.cash += p.pos.M + u;
        // v1.8.9 拔网线的强制平仓也是对账事件：就地补本轮口径平仓行（notes 循环早于监管段）
        { const v = u - ((p.pos.openedRound < G.round) ? (G.roundInfo.carryMark || 0) : 0);
          if (Math.abs(v) > 0.5) notes.push({ text: `平仓盈亏 ${MC.fmt.signed(v)}`, cls: v >= 0 ? 'good' : 'bad' }); }
        const dir = p.pos.dir;
        p.pos = null;
        const E2 = equity();
        // v1.8.8 负权益不重开（旧版产出 M/N 为负的僵尸仓，PnL 语义反转且玩家无法修复）
        if (E2 > 0) {
          const M2 = E2 * clamp(G.mods.capMul * (p.posSizeMul || 1), 0.05, 1.1);
          const N2 = M2 * 5;
          p.cash -= M2;
          p.pos = { dir, lev: 5, entry: priceEnd, N: N2, M: M2, openedRound: G.round, sl: null, tp: null, risk: p.riskMode };
        }
      }
      p.levCapOverride = 5; p.levCapRounds = 2;
      G.pendingEvents.push({ kind: 'plug' });
    }
    if (G.round >= 5 && G.round - (G.lastAntitrust || -9) >= 5) {
      const st = standings().filter(r => r.eq > 500);
      if (st.length >= 2) {
        const top = st[0], bottom = st[st.length - 1];
        if (top.eq > bottom.eq * 5 && !G.regLog.includes('antitrust' + G.round)) {
          p.stats.regs++;
          G.regLog.push('antitrust' + G.round);
          G.lastAntitrust = G.round;
          let fine, payer = top.name;
          if (top.id === 'you') {
            fine = spend(p, top.eq * 0.10 * (1 - m.regCut));
          } else {
            const bot = G.bots.find(x => x.def.id === top.id);
            fine = top.eq * 0.10;
            if (bot) { bot.cash -= fine; bot.equity -= fine; }
          }
          // 分给垫底（含玩家若在垫底）
          const receivers = st.slice(-2);
          const share = fine / receivers.length;
          // v1.2.1 救济封顶 = 受助人权益 50%：避免终局一笔救济金主导结局（曾出现 2.8 万 → 47.7 万）
          let youGotAmt = 0;
          for (const r of receivers) {
            // 没有敞口（本轮空仓观望）的玩家不领救济：挂机不能靠垫底吃补贴
            const got = r.id === 'you' && !G.roundDir ? 0 : Math.min(share, Math.max(r.eq, 0) * 0.5);
            if (r.id === 'you') { p.cash += got; youGotAmt = got; }
            else { const bot = G.bots.find(x => x.def.id === r.id); if (bot) { bot.cash += got; bot.equity += got; } }
          }
          G.regEvents.push({ kind: 'antitrust', round: G.round });
          G.pendingEvents.push({ kind: 'antitrust', payer, fine, share, youGot: youGotAmt, youPaid: top.id === 'you' ? fine : 0 });
          // 小结明细要能对上本轮数字（电报在后面才演）
          if (top.id === 'you') notes.push({ text: `反垄断罚款 -${MC.fmt.money(fine)}`, cls: 'bad' });
          if (youGotAmt > 0.5) notes.push({ text: `反垄断救济 +${MC.fmt.money(youGotAmt)}`, cls: 'good' });
        }
      }
    }

    // 监管结算后的权益才是本轮终值：曲线 / 巅峰 / 结算页与终局数字对齐
    // v1.8.9 刹车之后补行：强制平仓凭证 + 仍持仓者的本轮浮盈（brakes 可能已 realization，顺序不可颠倒）
    for (const fc of (G.forceCloseNotes || [])) {
      const v = fc.pnl - ((fc.opened !== undefined && fc.opened < G.round) ? carry : 0);
      notes.push({ text: `监管强制平仓 ${MC.fmt.signed(v)}`, cls: v >= 0 ? 'good' : 'bad' });
    }
    G.forceCloseNotes = [];
    if (p.pos) {
      const held = upnl() - (p.pos.openedRound < G.round ? carry : 0);
      if (Math.abs(held) > 0.5) notes.push({ text: `持仓浮盈 ${MC.fmt.signed(held)}${p.pos.openedRound < G.round ? ` · 第${p.pos.openedRound}轮开仓` : ''}`, cls: held >= 0 ? 'good' : 'bad' });   // v1.8.9 零额不列行（拔网线重开的零仓不再出 +¥0）
    }

    const Efinal = equity();
    if (Efinal !== Eend) {
      G.equityCurve[G.equityCurve.length - 1].eq = Efinal;
      if (Efinal > G.peak) G.peak = Efinal;
      if (Efinal < G.trough) G.trough = Efinal;
      roundPnl = Efinal - p.E_roundStart;
    }
    G.tickCurve.push({ t: G.revealedTick, eq: Efinal });

    const summary = {
      round: G.round, ret: trueRet,
      // v1.8.8 大数字 = Σ明细行口径（含手续费/保费），旧版锚在 E0（费后）与行和差一笔费
      pnl: roundPnl - p.feesThisRound - premPaid - exActPaid + tpBonusActPaid, equity: Efinal,   // v1.9.1 用捕获值（p.tpBonusAct 此时已清零=死变量）   // v1.8.10 act 段落袋奖金入锚（Σ行含该行）   // v1.8.9 锚=Σ行（再减 act 段行权费；resolve 段已在 roundPnl 内）
      notes, standings: standings(), pending: G.pendingEvents,
      playerPct: Efinal / p.E_roundStart - 1,
      mult: multInfo, winStreak: p.winStreak, snowMult: p.snowMult, cash: cashInfo,
    };
    G.phase = 'between';
    bus.emit('round:end', summary);
    return summary;
  }

  function nextRound() {
    if (G.phase === 'end') return G.results;   // 终局后任何推进都无效（旧演出循环/快捷键不得把已结束的局拉回构筑）
    if (G.round >= ROUNDS) return finalize();
    G.round++;
    beginRound(false);
  }

  function surrender() {
    if (!G || G.phase === 'end') return G ? G.results : null;
    G.surrenderedAt = G.round;
    return finalize();
  }

  /* ── 终局 ───────────────────────────────────────────── */
  function finalize() {
    if (G.phase === 'end') return G.results;   // 幂等：投降快进与演出循环竞态时不得二次结算/二次弹结算页
    const p = G.player, st = p.stats;
    // 强制平仓
    if (p.pos) {
      const u = upnl();
      p.cash += p.pos.M + u;
      if (u > 0 && G.mods.tpBonus > 0) { const b = u * G.mods.tpBonus; p.cash += b; p.stats.tpBonusTotal = (p.stats.tpBonusTotal || 0) + b; }   // v1.8.7 终局路径留痕
      p.pos = null;
    }
    for (const bot of G.bots) Bots.forceClose(bot, P());

    const finalEq = Math.max(equity(), 0);
    G.equityCurve.push({ round: ROUNDS, eq: finalEq, final: true });
    if (finalEq > G.peak) G.peak = finalEq;   // 终局强平（含落袋为安加成）后的权益也算巅峰
    if (G.tickCurve.length) G.tickCurve.push({ t: G.revealedTick, eq: finalEq });
    // 揭晓统计按最终价格（含情报改写）重算，只取 15 轮对局段——与玩家看到的 K 线一致
    const rb = G.mkt.roundBounds;
    const live = Market.statsOf(G.mkt.prices.slice(rb[1].start, rb[ROUNDS].end + 1));
    const totalRet = live.totalRet;
    const buyHold = p.start * (1 + totalRet);

    const trades = st.trades + st.liqs;
    const accuracy = (st.correctDirs + st.wrongDirs) ? st.correctDirs / (st.correctDirs + st.wrongDirs) : 0;
    const avgLev = st.levOpens ? st.sumLev / st.levOpens : 0;
    const holdRatio = st.holdRounds / ROUNDS;

    /* 奖项：人人有奖 */
    const awards = [];
    if (st.liqs === 0) awards.push({ icon: '存', name: '存活奖', desc: '全场零爆仓' });
    if (st.bestRound > 0.3) awards.push({ icon: '财', name: '财神附体', desc: `单轮最高收益 +${(st.bestRound * 100).toFixed(0)}%` });
    if (st.worstRound < -0.3) awards.push({ icon: '怨', name: '最佳怨种', desc: `单轮最惨 ${(st.worstRound * 100).toFixed(0)}%` });
    if (st.maxHoldStreak >= 4) awards.push({ icon: '钻', name: '钻石手奖', desc: `连续 ${st.maxHoldStreak} 轮不动` });
    if (st.maxLev >= 50) awards.push({ icon: '赌', name: '赌徒勋章', desc: `动用过 ${st.maxLev}x 杠杆` });
    if (st.chase + st.panic >= 4) awards.push({ icon: '韭', name: '韭菜之光', desc: `追涨 ${st.chase} · 恐慌 ${st.panic}` });
    if (accuracy >= 0.7 && st.correctDirs + st.wrongDirs >= 5) awards.push({ icon: '知', name: '先知奖', desc: `命中率 ${(accuracy * 100).toFixed(0)}% · 建议自查穿越` });
    if (st.regs >= 2) awards.push({ icon: '监', name: '监管之友', desc: `监管 ${st.regs} 次 · SEC 关注你` });
    if (st.fees > p.start * 0.05) awards.push({ icon: '费', name: 'ATM 机', desc: `手续费贡献 ${MC.fmt.money(st.fees)}` });
    if (st.maxLev <= 3 && st.trades >= 5 && finalEq > p.start) awards.push({ icon: '龟', name: '时光旅行者', desc: '全程低杠杆还能赚' });
    if (st.maxMult >= 3) awards.push({ icon: '倍', name: '倍率大师', desc: `单轮倍率 ×${st.maxMult.toFixed(2)}` });
    if (st.crits >= 2) awards.push({ icon: '暴', name: '暴击狂魔', desc: `会心一击 ${st.crits} 次` });
    if (st.spentBuffs > p.start * 0.5) awards.push({ icon: '氪', name: '构筑氪佬', desc: `卡牌豪掷 ${MC.fmt.money(st.spentBuffs)}` });
    if (!awards.length) awards.push({ icon: '参', name: '重在参与', desc: '看完行情就是收益' });

    /* 风格画像 */
    const profile = buildProfile({ accuracy, avgLev, holdRatio, chase: st.chase, liqs: st.liqs, finalMult: finalEq / p.start, regs: st.regs, flips: st.flips });

    const results = {
      seed: G.seed,
      start: p.start, finalEq, mult: finalEq / p.start,
      peak: G.peak, trough: G.trough, peakMult: G.peak / p.start,
      equityCurve: G.equityCurve, tickCurve: G.tickCurve,
      scenario: {
        id: G.scen.id, name: G.scen.name, reveal: G.scen.reveal, asset: G.scen.asset, base: G.scen.base, mirror: !!G.scen.mirror,
        // 本局事实动态生成（方向逐轮随机后，原型史实只作「原型」注脚，不再与 K 线打架）
        fact: `本局 ${G.scen.asset} ${Market.fmtPrice(live.first)} → ${Market.fmtPrice(live.last)}（${live.totalRet >= 0 ? '+' : ''}${(live.totalRet * 100).toFixed(1)}%）`,
        origin: G.scen.fact,
        stats: Object.assign({}, G.mkt.stats, live),
      },
      buyHold, totalRet,
      standings: standings(),
      awards, profile,
      stats: Object.assign({}, st, { accuracy, avgLev, holdRatio, finalEq }),
      slots: G.buffs.slots.filter(Boolean).map(s => ({ name: s.def.name, icon: s.def.icon, glyph: s.def.glyph, school: s.def.school, lvl: s.lvl })),
      setNames: G.mods.setNames, hiddenSets: G.mods.hiddenSets.map(h => h.name),
      regLog: G.regLog,
      surrenderedAt: G.surrenderedAt || null,
      tremorPeak: MC.Tremor.peak,
      multEngine: {
        maxMult: st.maxMult || 1, snowMult: p.snowMult, spent: st.spentBuffs,
        rerolls: st.rerolls, crits: st.crits, milestones: st.milestones,
        bestChain: G.bestChain || null,
      },
    };
    G.phase = 'end';
    G.results = results;
    bus.emit('game:end', results);
    return results;
  }

  function buildProfile(f) {
    const scores = {
      '韭菜': (1 - f.accuracy) * 40 + f.chase * 12 + f.liqs * 15 + (f.finalMult < 1 ? 20 : 0),
      '庄家': f.accuracy * 50 + (f.finalMult > 1.5 ? 25 : 0) + (f.avgLev > 5 && f.avgLev < 30 ? 15 : 0) + (f.chase <= 1 ? 10 : 0),
      '赌徒': (f.avgLev > 15 ? 35 : f.avgLev * 2) + f.liqs * 18 + (f.flips > 3 ? 12 : 0),
      '老龟': f.holdRatio * 60 + (f.avgLev < 4 ? 25 : 0) + (f.liqs === 0 ? 15 : 0),
      '量化机器': (f.accuracy > 0.55 && f.accuracy < 0.8 ? 30 : 0) + (f.avgLev >= 3 && f.avgLev <= 8 ? 25 : 0) + Math.max(0, 25 - f.chase * 8),
      '钻石手': f.holdRatio * 45 + (f.avgLev < 6 ? 20 : 0) + (f.finalMult > 1 ? 20 : 0),
    };
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((a, b) => a + Math.max(b[1], 5), 0);
    const main = sorted[0], sub = sorted[1];
    const pct = Math.round(Math.max(main[1], 5) / total * 100);
    const FIGURES = {
      '韭菜': ['小明本人', '「每一根韭菜都觉得自己是镰刀。」'],
      '庄家': ['杰西·利弗莫尔', '投机之王 · 破产过四次'],
      '赌徒': ['尼克·里森', '一人干翻巴林银行'],
      '老龟': ['沃伦·巴菲特', '没人愿意慢慢变富，但你愿意'],
      '量化机器': ['吉姆·西蒙斯', '大奖章年化 66%'],
      '钻石手': ['HODL 侠', '醉汉打错的词成了信仰'],
    };
    const fig = FIGURES[main[0]] || FIGURES['韭菜'];
    return {
      title: main[0], pct,
      sub: sub[0], subPct: Math.max(5, Math.round(Math.max(sub[1], 5) / total * 100)),
      figure: fig[0], figureDesc: fig[1],
      all: sorted.map(([k, v]) => ({ k, v: Math.round(Math.max(v, 5) / total * 100) })),
    };
  }

  /* 风险档位切换（下单坞的三档芯片） */
  function setRiskMode(id) {
    if (!G || !RISK_MODES[id] || G.phase !== 'act') return false;
    G.player.riskMode = id;
    MC.Audio.play('click');
    bus.emit('risk:changed', id);
    return true;
  }

  /* ── 公共 API ───────────────────────────────────────── */
  MC.Engine = {
    get G() { return G; },
    newGame, equity, upnl, liqPrice, price: P, standings, levSteps, currentLevCap,
    rerollOffer, pickOffer, toggleLock, skipBuffs, rerollCost,
    openOrResize, closePosition, hold, setRiskMode, RISK_MODES,
    get cutFee() { return MANUAL_CUT_FEE; },
    startResolve, stepTick, cashOut, cashLoss, settleRoundEnd, nextRound, finalize, surrender, condStates,
    offerState,
    get phase() { return G ? G.phase : 'title'; },
    get round() { return G ? G.round : 0; },
  };

})(window.MC);
