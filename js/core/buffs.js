/* ═══════════════════════════════════════════════════════════
   Buff 体系 v2：收益倍率引擎
   巨鲸(力量) / 先知(信息) / 复利(经济) / 通用(混沌)
   6 槽位 · 2/4/6 套装 · 隐藏混合流派 · 可升 3 级 · 卡牌定价

   ── 倍率引擎 ──
   所有「盈利轮」的收益在结算时经过统一倍率管线：
     总倍率 = (1 + Σ加法源) × Π(通过判定的乘法源)
   加法源(op:'+')：始终生效或按局内状态动态取值（连胜/雪球/耐心…）
   乘法源(op:'x')：带 test(ctx) 条件，命中才乘（情报方向/大波动/低杠杆…）
   每个源都带 name/icon/slotIdx，供结算演出逐个点亮槽位。
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  /* icon = emoji（仅 pop 主题等展示）；glyph = 单字印章（默认 UI 一律用字印，去 AI 味） */
  const SCHOOLS = {
    whale: { name: '巨鲸流', axis: '力量', icon: '🐋', glyph: '鲸', color: 'whale' },
    seer: { name: '先知流', axis: '信息', icon: '🔮', glyph: '先', color: 'seer' },
    econ: { name: '复利流', axis: '经济', icon: '💰', glyph: '利', color: 'econ' },
    wild: { name: '通用', axis: '混沌', icon: '🃏', glyph: '混', color: 'wild' },
  };

  /* rarity: 1 白·普通  2 蓝·稀有  3 紫·史诗  4 金·传说 */
  const RARITY = { 1: '普通', 2: '稀有', 3: '史诗', 4: '传说' };

  /* ── 倍率源助手 ───────────────────────────────────────
     I = {def, idx}（槽位归属，用于结算演出点亮） */
  function addSrc(m, I, val, label) {
    m.multSrcs.push({ key: I.def.id, name: I.def.name, icon: I.def.glyph || I.def.icon, school: I.def.school || I.school, slotIdx: I.idx === undefined ? null : I.idx, op: '+', val, label: label || '始终生效' });
  }
  function mulSrc(m, I, val, test, label) {
    m.multSrcs.push({ key: I.def.id, name: I.def.name, icon: I.def.glyph || I.def.icon, school: I.def.school || I.school, slotIdx: I.idx === undefined ? null : I.idx, op: 'x', val, test, label });
  }

  /* apply(m, s, I)：s = 等级系数 Lv1=1 Lv2=1.6 Lv3=2.2 */
  const DEFS = [
    /* ── 巨鲸流 · 力量：仓位与杠杆的艺术 ─────────────── */
    {
      id: 'allin', school: 'whale', rarity: 2, icon: '🐋', glyph: '梭',
      name: '满仓梭哈', sub: 'ALL IN OR NOTHING',
      desc: s => `每单保证金 +${pct(0.22 * s)}（基础 40%）`,
      apply: (m, s) => { m.capMul += 0.22 * s; },
    },
    {
      id: 'pump', school: 'whale', rarity: 2, icon: '📣', glyph: '拉',
      name: '拉盘手', sub: 'PUMP IT',
      desc: s => `开仓后行情顺势推 ${pct(0.008 * s, 1)}（真实推动，可落袋可止损）`,
      apply: (m, s) => { m.pushPrice += 0.008 * s; },
    },
    {
      id: 'avgdown', school: 'whale', rarity: 1, icon: '🪜', glyph: '摊',
      name: '摊平成本', sub: 'AVG DOWN',
      desc: s => `同向第 2 单起：行情顺势推 ${pct(0.008 * s, 1)}，费减半`,
      apply: (m, s) => { m.avgDown = 0.008 * s; m.avgDownFee = 0.5; },
    },
    {
      id: 'faith', school: 'whale', rarity: 3, icon: '🕍', glyph: '信',
      name: '期货信仰', sub: 'LEVERAGE FAITH',
      desc: s => `杠杆上限 +125x${s > 1 ? `；强平线再退 ${pct(0.1 * (s - 1))}` : ''}`,
      // v1.1：加法叠加（旧版直接赋值 250，会覆盖其它上限加成）
      apply: (m, s) => { m.levMax += 125; if (s > 1) m.liqBuffer *= 1 + 0.1 * (s - 1); },
    },
    {
      /* v1.1：旧版「维持保证金 -30%」只把强平线挪动 0.15%，玩家完全无感。
         改为直接对抗路径风险：止损线与强平线外推，K 线上肉眼可见 */
      id: 'splitter', school: 'whale', rarity: 1, icon: '🧊', glyph: '宽',
      name: '宽幅止损', sub: 'WIDE STOP',
      desc: s => `止损线外推 ${pct(0.35 * s)}，强平线退 ${pct(0.08 * s)}`,
      apply: (m, s) => { m.slWiden += 0.35 * s; m.liqBuffer *= 1 + 0.08 * s; },
    },
    {
      id: 'tail', school: 'whale', rarity: 2, icon: '🌀', glyph: '鲸',
      name: '鲸尾扫盈', sub: 'WHALE TAIL',
      label: s => `名义≥300% ×${(1 + 0.25 * s).toFixed(2)}`,
      desc: s => `名义 ≥ 权益 300% 的盈利轮 ×${(1 + 0.25 * s).toFixed(2)}`,
      apply: (m, s, I) => { mulSrc(m, I, 1 + 0.25 * s, ctx => ctx.notionalRatio >= 3, '名义仓位≥300%权益'); },
    },
    {
      id: 'momentum', school: 'whale', rarity: 2, icon: '🏄', glyph: '势',
      name: '顺势而为', sub: 'MOMENTUM RIDER',
      label: s => `同向持仓≥2轮 ×${(1 + 0.15 * s).toFixed(2)}`,
      desc: s => `同向持仓 ≥2 轮的盈利轮 ×${(1 + 0.15 * s).toFixed(2)}`,
      apply: (m, s, I) => { mulSrc(m, I, 1 + 0.15 * s, ctx => ctx.heldRounds >= 2, '同向持仓≥2轮'); },
    },
    {
      id: 'liqdance', school: 'whale', rarity: 3, icon: '🩸', glyph: '擦',
      name: '擦弹而过', sub: 'LIQ DANCE',
      label: s => `与强平线擦肩 ×${(1 + 0.8 * s).toFixed(2)}`,
      desc: s => `距强平线 <1.5% 却存活的盈利轮 ×${(1 + 0.8 * s).toFixed(2)}`,
      apply: (m, s, I) => { mulSrc(m, I, 1 + 0.8 * s, ctx => ctx.pos && ctx.liqNearMin <= 0.015, '与强平线距离<1.5%且存活'); },
    },

    /* ── 先知流 · 信息：情报直接变成倍率 ─────────────── */
    {
      id: 'insider', school: 'seer', rarity: 3, icon: '📻', glyph: '密',
      name: '内幕消息', sub: 'SELF-FULFILLING',
      label: s => `按情报操作 ×${(1 + 0.15 * s).toFixed(2)}`,
      /* v1.6 内幕会错：准确率 76/82/88%，只在说对时把行情牵引到 ≥1.2%/级。旧版 100% 准 + 补幅度 3.5%/级，
         「刷内幕 + 雷达定杠杆」中位 ~1000x、最大 10^6——整局退化成抽没抽到内幕的彩票 */
      desc: s => `情报准 ${Math.round(Math.min(0.85, 0.70 + 0.06 * s) * 100)}%（说对时牵引 ≥${pct(0.012 * s, 1)}）；跟随盈利轮 ×${(1 + 0.15 * s).toFixed(2)}`,
      apply: (m, s, I) => {
        m.hintInsider = 1; m.insiderPush = 0.012 * s; m.insiderAcc = Math.max(m.insiderAcc || 0, 0.70 + 0.06 * s);
        mulSrc(m, I, 1 + 0.15 * s, ctx => ctx.followedHint, '跟随情报方向');
      },
    },
    {
      /* v1.1 单人化：旧「窃听对手」只对多人有意义。情报在单人局的价值 =
         看清本轮路径——最深逆向回撤直接决定「杠杆开多大不被止损」 */
      id: 'radar', school: 'seer', rarity: 1, icon: '📡', glyph: '雷',
      name: '风控雷达', sub: 'RISK RADAR',
      label: s => `持仓活到收盘 ×${(1 + 0.12 * s).toFixed(2)}`,
      desc: s => `显示方向对时的最深回撤与安全杠杆（误差 ${s >= 2.2 ? '0' : s >= 1.6 ? '±15' : '±35'}%）；持仓活到收盘盈利轮 ×${(1 + 0.12 * s).toFixed(2)}`,
      apply: (m, s, I) => {
        m.radar = Math.max(m.radar, s);
        mulSrc(m, I, 1 + 0.12 * s, ctx => !!ctx.pos, '持仓活到收盘（未被止损/强平）');
      },
    },
    {
      id: 'rumor', school: 'seer', rarity: 1, icon: '🗣', glyph: '谣',
      /* v1.1 单人化：旧版压向「首富持仓反向」——单人局玩家根本不看首富。
         改为替你的仓位造势：方向由你决定，卡牌让市场更可能服从 */
      name: '舆论造势', sub: 'SPREAD FOMO',
      desc: s => `开仓后 ${pct(Math.min(0.9, 0.4 * s))} 概率造势成功：行情顺你多走 ${pct(0.02 * s, 1)}`,
      apply: (m, s) => { m.rumor = Math.min(0.9, 0.4 * s); m.rumorPush = 0.02 * s; },
    },
    {
      id: 'followbig', school: 'seer', rarity: 2, icon: '🐠', glyph: '随',
      name: '跟单大佬', sub: 'COPY TRADE',
      label: s => `与首富同向 ×${(1 + 0.15 * s).toFixed(2)}`,
      desc: s => `转述准 ${pct(0.85 + 0.05 * (s - 1), 0)}：首富意图·非未来；同向盈利轮 ×${(1 + 0.15 * s).toFixed(2)}`,
      apply: (m, s, I) => {
        m.hintFollow = Math.min(0.98, 0.85 + 0.05 * (s - 1));
        mulSrc(m, I, 1 + 0.15 * s, ctx => ctx.followedLeader, '与首富同方向');
      },
    },
    {
      id: 'tape', school: 'seer', rarity: 1, icon: '📼', glyph: '盘',
      name: '盘口语言', sub: 'TAPE READING',
      label: s => `波动区间内 ×${(1 + 0.15 * s).toFixed(2)}`,
      desc: s => `显示本轮波动区间与走势形态；落区间内盈利轮 ×${(1 + 0.15 * s).toFixed(2)}`,
      apply: (m, s, I) => {
        m.hintTape = true;
        mulSrc(m, I, 1 + 0.15 * s, ctx => ctx.tapeHit, '实际波动落在预测区间');
      },
    },
    {
      id: 'foresight', school: 'seer', rarity: 3, icon: '👁', glyph: '窥',
      name: '先知一闪', sub: 'PRECOGNITION',
      label: s => `顺幽灵线方向 ×${(1 + 0.25 * s).toFixed(2)}`,
      desc: s => `预览本轮前 ${pct(0.4 * s, 0)} 路径（幻觉 ${s >= 2.2 ? '0%' : s >= 1.6 ? '12%' : '25%'}）；顺幽灵线盈利轮 ×${(1 + 0.25 * s).toFixed(2)}`,
      apply: (m, s, I) => {
        m.foresight = Math.min(0.8, 0.4 * s);
        m.foresightFake = s >= 2.2 ? 0 : s >= 1.6 ? 0.12 : 0.25;
        mulSrc(m, I, 1 + 0.25 * s, ctx => ctx.ghostHit, '与幽灵线指向一致');
      },
    },
    {
      id: 'prophecy', school: 'seer', rarity: 2, icon: '🗞', glyph: '讯',
      name: '信息就是力量', sub: 'INFORMATION WARS',
      label: s => `每条情报 +${(0.05 * s).toFixed(2)}x`,
      desc: s => `情报可信度 +${pct(0.12 * s)}；每条情报倍率 +${(0.05 * s).toFixed(2)}x（≤+0.45x）`,
      apply: (m, s, I) => {
        m.hintAcc += 0.12 * s;
        addSrc(m, I, ctx => Math.min(0.45, 0.05 * s * (ctx.hintCount || 0)), '每条情报 +0.05x/级');
      },
    },

    /* ── 复利流 · 经济：现金流与成长引擎 ─────────────── */
    {
      id: 'stable', school: 'econ', rarity: 1, icon: '🪙', glyph: '息',
      name: '稳定币信仰', sub: 'STABLE YIELD',
      desc: s => `空仓每轮得 ${pct(0.015 * s)} 权益利息（随体量递减）`,
      apply: (m, s) => { m.interest += 0.015 * s; },
    },
    {
      id: 'rebate', school: 'econ', rarity: 1, icon: '🧾', glyph: '返',
      name: '做市返佣', sub: 'FEE REBATE',
      desc: s => `轮末现金返还手续费 ${pct(Math.min(1.2, 0.6 * s))}（可超 100%）`,
      apply: (m, s) => { m.feeRebate = Math.min(1.2, 0.6 * s); },
    },
    {
      id: 'hedge', school: 'econ', rarity: 3, icon: '🛡', glyph: '护',
      name: '对冲大师', sub: 'HEDGE MASTER',
      desc: s => `亏损轮返还 ${pct(Math.min(0.9, 0.5 * s))} 损失（爆仓除外）`,
      apply: (m, s) => { m.lossCut = Math.min(0.9, 0.5 * s); },
    },
    {
      id: 'patient', school: 'econ', rarity: 2, icon: '⏳', glyph: '忍',
      name: '耐心资本', sub: 'PATIENT CAPITAL',
      desc: s => `空仓不动 1 轮积 1 层（≤5）；开仓轮倍率 +${pct(0.07 * s)}/层后清零`,
      apply: (m, s) => { m.patientStack = 0.07 * s; },
    },
    {
      id: 'timevalue', school: 'econ', rarity: 1, icon: '🍵', glyph: '稳',
      name: '时间价值', sub: 'TIME VALUE',
      label: s => `≤5x杠杆持仓 ×${(1 + 0.25 * s).toFixed(2)}`,
      desc: s => `≤5x 持仓到轮末的盈利轮 ×${(1 + 0.25 * s).toFixed(2)}`,
      apply: (m, s, I) => { mulSrc(m, I, 1 + 0.25 * s, ctx => ctx.pos && ctx.lev <= 5, '≤5x杠杆持仓到轮末'); },
    },
    {
      id: 'funding', school: 'econ', rarity: 2, icon: '🏦', glyph: '费',
      name: '资金费率', sub: 'FUNDING RATE',
      desc: s => `持仓每轮收名义 ${pct(0.0015 * s, 2)} 资金费`,
      apply: (m, s) => { m.funding += 0.0015 * s; },
    },
    {
      id: 'compound', school: 'econ', rarity: 2, icon: '❄', glyph: '滚',
      name: '雪球复投', sub: 'SNOWBALL',
      label: s => `每轮永久 +${(0.04 * s).toFixed(2)}x`,
      desc: s => `每轮结算后倍率永久 +${(0.04 * s).toFixed(2)}x（本局不重置）`,
      apply: (m, s) => { m.compoundSnow += 0.04 * s; },
    },
    {
      id: 'banker', school: 'econ', rarity: 3, icon: '💼', glyph: '阀',
      name: '银行家的微笑', sub: 'TOO RICH TO FAIL',
      label: s => `每10万权益 +${(0.1 * s).toFixed(1)}x`,
      desc: s => `权益每满 ¥10 万，倍率 +${(0.1 * s).toFixed(1)}x（至多 +${s}x）`,
      // v1.2 封顶 10 档：线性随权益增长的加法源 = 指数失控（sim 曾出 10^14 倍），封顶后仍是后期最强加法卡
      apply: (m, s, I) => { addSrc(m, I, ctx => Math.min(10, Math.floor(Math.max(ctx.equity, 0) / 100000)) * 0.1 * s, '每10万权益 +0.1x/级'); },
    },

    /* ── 通用池 · 混沌：赌狗的快乐 ───────────────────── */
    {
      id: 'diamond', school: 'wild', rarity: 2, icon: '💎', glyph: '钻',
      name: '钻石手', sub: 'DIAMOND HANDS',
      desc: s => `本轮不动 → 下轮收益 ×${2 + 0.5 * (s - 1)}`,
      apply: (m, s) => { m.diamond = true; m.diamondVal = 2 + 0.5 * (s - 1); },
    },
    {
      id: 'takeprofit', school: 'wild', rarity: 1, icon: '🧺', glyph: '袋',
      name: '落袋为安', sub: 'TAKE PROF',
      desc: s => `盈利平仓额外落袋 ${pct(0.1 * s)}`,
      apply: (m, s) => { m.tpBonus += 0.1 * s; },
    },
    {
      id: 'gambler', school: 'wild', rarity: 1, icon: '🎰', glyph: '赌',
      name: '赌徒狂热', sub: 'DEGEN FEVER',
      label: () => `刷新+0.05x/轮`,
      desc: () => `刷新费减半；本轮每刷 1 次倍率 +0.05x（行情更疯）`,
      apply: (m) => { m.gamblerReroll = true; },
    },
    {
      id: 'revive', school: 'wild', rarity: 4, icon: '⚰️', glyph: '生',
      name: '破产重整', sub: 'CHAPTER 11',
      desc: () => `爆仓保留 20% 权益复活（每局一次）`,
      apply: (m) => { m.reviveOnce = true; },
    },
    {
      id: 'calm', school: 'wild', rarity: 1, icon: '💉', glyph: '定',
      name: '镇定剂', sub: 'BETA BLOCKER',
      desc: () => `手抖恒为 0，蓄力不漂移`,
      apply: (m) => { m.calm = true; },
    },
    {
      id: 'limitup', school: 'wild', rarity: 2, icon: '🚀', glyph: '暴',
      name: '涨停基因', sub: 'VOLATILITY LOVE',
      label: s => `大波动轮 ×${(1 + 0.3 * s).toFixed(2)}`,
      desc: s => `单轮 |涨跌| >8% 的盈利轮 ×${(1 + 0.3 * s).toFixed(2)}`,
      apply: (m, s, I) => { mulSrc(m, I, 1 + 0.3 * s, ctx => ctx.volBig, '单轮|涨跌|>8%'); },
    },
    {
      id: 'taxhaven', school: 'wild', rarity: 2, icon: '🏝', glyph: '避',
      name: '避税天堂', sub: 'OFFSHORE',
      desc: s => `监管惩罚 -${pct(Math.min(0.9, 0.5 * s))}`,
      apply: (m, s) => { m.regCut = Math.min(0.9, 0.5 * s); },
    },
    {
      id: 'bubble', school: 'wild', rarity: 3, icon: '🫧', glyph: '泡',
      name: '泡沫盛宴', sub: 'BUBBLE FEED',
      label: s => `身家每翻倍 +${(0.2 * s).toFixed(2)}x`,
      desc: s => `身家每翻一倍，倍率 +${(0.2 * s).toFixed(2)}x（×2 起算）`,
      apply: (m, s, I) => { addSrc(m, I, ctx => Math.max(0, Math.floor(Math.log2(Math.max(ctx.equity / ctx.start, 1)))) * 0.2 * s, '身家每翻倍 +0.2x/级'); },
    },
    {
      id: 'crit', school: 'wild', rarity: 2, icon: '🎯', glyph: '暴',
      name: '会心一击', sub: 'CRITICAL HIT',
      label: s => `${Math.round((0.10 + 0.06 * (s - 1)) * 100)}% 概率 ×${(2.5 + 0.5 * (s - 1)).toFixed(1)}`,
      desc: s => `${Math.round((0.10 + 0.06 * (s - 1)) * 100)}% 概率暴击：该轮收益 ×${(2.5 + 0.5 * (s - 1)).toFixed(1)}`,
      apply: (m, s) => { m.critChance = Math.max(m.critChance, 0.10 + 0.06 * (s - 1)); m.critMult = Math.max(m.critMult || 2.5, 2.5 + 0.5 * (s - 1)); },
    },
    {
      id: 'doomsday', school: 'wild', rarity: 3, icon: '🎆', glyph: '决',
      name: '最后的决战', sub: 'DOOMSDAY',
      label: s => `第15轮 ×${(1.5 + 0.5 * (s - 1)).toFixed(1)}`,
      desc: s => `第 15 轮盈利收益 ×${(1.5 + 0.5 * (s - 1)).toFixed(1)}`,
      apply: (m, s, I) => { mulSrc(m, I, 1.5 + 0.5 * (s - 1), ctx => ctx.isFinal, '终局轮(第15轮)'); },
    },
  ];

  const pct = (v, d) => (v * 100).toFixed(d === undefined ? 0 : d) + '%';

  /* ── 套装定义 ─────────────────────────────────────── */
  const SETS = {
    whale: {
      2: { name: '杠杆艺术家', desc: '杠杆上限 +50x', apply: m => { m.levMax += 50; } },
      4: { name: '保证金大亨', desc: '强平线退 20%；>10x 盈利轮 ×1.3', apply: (m, I) => { m.liqBuffer *= 1.2; mulSrc(m, I, 1.3, ctx => ctx.lev > 10, '>10x杠杆的轮次'); } },
      6: { name: '大而不倒', desc: '单轮亏损封顶 15%；盈利轮 ×1.6', apply: (m, I) => { m.lossCap = 0.15; mulSrc(m, I, 1.6, () => true, '所有盈利轮'); }, legendary: true },
    },
    seer: {
      2: { name: '消息灵通', desc: '倍率 +0.1x；内幕牵引 +50%', apply: (m, I) => { m.hintAcc += 0.10; addSrc(m, I, 0.1); m.insiderPush *= 1.5; } },
      4: { name: '双面间谍', desc: '风控雷达开启且零误差；造势 ≥75% 且力度翻倍；跟情报盈利轮 ×1.4', apply: (m, I) => { m.radar = Math.max(m.radar, 1); m.radarExact = true; m.rumor = Math.max(m.rumor, 0.75); m.rumorPush *= 2; mulSrc(m, I, 1.4, ctx => ctx.followedHint, '跟随情报方向'); } },
      6: { name: '全 视', desc: '身家≤10x本金时方向锁定·牵引翻倍·保底幅度；持情报盈利轮 ×1.8', apply: (m, I) => { m.seerOmni = true; mulSrc(m, I, 1.8, ctx => ctx.hadHint, '拥有情报的轮次'); }, legendary: true },
    },
    econ: {
      2: { name: '利滚利', desc: '空仓利息 +0.5%；倍率 +0.1x', apply: (m, I) => { m.interest += 0.005; addSrc(m, I, 0.1); } },
      4: { name: 'VIP 费率', desc: '返佣率 +30%；倍率 +0.25x', apply: (m, I) => { m.feeRebate = Math.min(1.45, m.feeRebate + 0.3); addSrc(m, I, 0.25); } },
      6: { name: '雪 球', desc: '每轮得权益 0.5% 复投（随体量递减）；倍率每轮永久 +0.03x', apply: m => { m.snowball = 0.005; m.setSnow += 0.03; }, legendary: true },
    },
  };

  /* 隐藏混合流派（官方不公布——触发时全屏演出） */
  const HIDDEN = [
    {
      id: 'dealer', need: { whale: 3, seer: 3 }, name: '坐 庄',
      desc: '持仓牵引行情 1%/轮；内幕永指你的方向；倍率 +0.35x',
      apply: (m, I) => { m.dealerDrift = 0.01; m.hintInsider = Math.max(m.hintInsider, 0.999); m.dealer = true; addSrc(m, I, 0.35); },
    },
    {
      id: 'quant', need: { seer: 3, econ: 3 }, name: '量化基金',
      desc: '持情报的盈利轮 ×1.4',
      apply: (m, I) => { mulSrc(m, I, 1.4, ctx => ctx.hadHint, '拥有情报的轮次'); },
    },
    {
      id: 'retail', need: { wild: 6 }, name: '散户之光',
      desc: '所有数值构筑效果 ×1.5；倍率 +0.6x',
      apply: (m, I) => { m.allBoost = 1.5; addSrc(m, I, 0.6); },
    },
  ];

  function defaultMods() {
    return {
      /* 每单保证金 = 身家 × capMul（v3 仓位模型：基础 40%，巨鲸卡拉高）——
         一把方向错不再亏穿，杠杆只决定强平距离与名义敞口 */
      capMul: 0.4, levMax: 125, mmrCut: 0, liqBuffer: 1,
      feeRebate: 0, pushPrice: 0, avgDown: 0, avgDownFee: 1,
      hintInsider: 0, radar: 0, radarExact: false, slWiden: 0, rumor: 0, hintFollow: 0, hintTape: false,
      foresight: 0, foresightFake: 0.25, hintAcc: 0, seerOmni: false,
      insiderPush: 0, insiderAcc: 0, rumorPush: 0,   // v4：情报改写行情的牵引力度
      interest: 0, lossCut: 0, patientStack: 0, funding: 0,
      compoundSnow: 0, setSnow: 0, snowball: 0,
      diamond: false, diamondVal: 2, tpBonus: 0, gamblerReroll: false, reviveOnce: false,
      calm: false, regCut: 0, critChance: 0, critMult: 2.5,
      lossCap: 0, dealerDrift: 0, dealer: false, allBoost: 1,
      sets: { whale: 0, seer: 0, econ: 0, wild: 0 }, hiddenSets: [], setNames: [],
      multSrcs: [], multBase: 1, multCond: [],
    };
  }

  function levelScale(lvl) { return lvl === 1 ? 1 : lvl === 2 ? 1.6 : 2.2; }

  /* 由槽位计算全部修正值 + 倍率源 */
  function computeMods(slots) {
    const m = defaultMods();
    const counts = { whale: 0, seer: 0, econ: 0, wild: 0 };
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s) continue;
      counts[s.def.school]++;
      s.def.apply(m, levelScale(s.lvl), { def: s.def, idx: i });
    }
    m.sets = counts;
    // 构筑协同：每格卡都垫一点常驻加法倍率——买任何卡都"看得见地变强"
    let syn = 0, synN = 0;
    for (const s of slots) if (s) { syn += [0, 0.03, 0.05, 0.07][s.lvl] || 0.03; synN++; }
    if (syn > 0) m.multSrcs.push({ key: 'synergy', name: '构筑协同', icon: '鸣', school: 'wild', slotIdx: null, op: '+', val: syn, label: `${synN} 张卡共鸣（含等级）` });
    // 显性套装（2/4/6 逐级叠加）
    for (const school of ['whale', 'seer', 'econ']) {
      for (const n of [6, 4, 2]) {
        if (counts[school] >= n) {
          const st = SETS[school][n];
          const I = { def: { id: `set-${school}-${n}`, name: st.name, icon: SCHOOLS[school].icon, glyph: SCHOOLS[school].glyph, school }, idx: null, school };
          st.apply(m, I);
          m.setNames.push({ school, n, name: st.name, desc: st.desc, legendary: !!st.legendary });
        }
      }
    }
    // 隐藏混合流派
    for (const h of HIDDEN) {
      let ok = true;
      for (const k in h.need) if ((counts[k] || 0) < h.need[k]) { ok = false; break; }
      if (ok) {
        h.apply(m, { def: { id: h.id, name: h.name, icon: '✦', glyph: '✦', school: 'wild' }, idx: null, school: 'wild' });
        m.hiddenSets.push(h);
        m.setNames.push({ school: 'hidden', n: 0, name: h.name, desc: h.desc, legendary: true, hidden: true });
      }
    }
    // 散户之光：数值型效果 ×1.5（含倍率源）
    if (m.allBoost > 1) {
      for (const k of ['capMulAdd', 'pushPrice', 'interest', 'lossCut', 'patientStack', 'funding', 'tpBonus', 'feeRebate', 'regCut', 'compoundSnow', 'setSnow', 'hintAcc', 'snowball', 'insiderPush', 'rumorPush', 'slWiden']) {
        if (typeof m[k] === 'number' && m[k] > 0 && m[k] < 1) m[k] = Math.min(0.98, m[k] * m.allBoost);
      }
      m.capMul = 1 + (m.capMul - 1) * m.allBoost;
      for (const src of m.multSrcs) {
        if (src.key === 'retail') continue;
        if (typeof src.val === 'number') {
          src.val = src.op === '+' ? src.val * m.allBoost : 1 + (src.val - 1) * m.allBoost;
        }
      }
    }
    // 静态基础倍率（不含动态源，用于商店预览）
    let add = 0;
    for (const src of m.multSrcs) {
      if (src.op === '+' && typeof src.val === 'number') add += src.val;
    }
    m.multBase = 1 + add;
    m.multCond = m.multSrcs.filter(s => s.op === 'x');
    return m;
  }

  /* ── 结算倍率求值 ───────────────────────────────────────
     mods: computeMods 输出  ctx: 结算上下文  extra: 引擎动态源（连胜/雪球/钻石/暴击/耐心/赌徒）
     返回 {total, adds, muls}，adds/muls 已按演出顺序（小→大）排序 */
  function evalMult(mods, ctx, extra) {
    const all = (mods.multSrcs || []).concat(extra || []);
    const adds = [], muls = [];
    for (const s of all) {
      if (s.test && !s.test(ctx)) continue;
      const v = typeof s.val === 'function' ? s.val(ctx) : s.val;
      if (!(v > 0)) continue;
      if (s.op === '+') { if (v > 0.0005) adds.push({ src: s, v }); }
      else if (v > 1.0005) muls.push({ src: s, v });
    }
    adds.sort((a, b) => a.v - b.v);
    muls.sort((a, b) => a.v - b.v);
    const addSum = adds.reduce((x, y) => x + y.v, 0);
    const mulProd = muls.reduce((x, y) => x * y.v, 1);
    return { total: (1 + addSum) * mulProd, addSum, mulProd, adds, muls };
  }

  /* ── 商店预览：拿这张卡后倍率怎么变 ─────────────────── */
  function preview(slots, def, modsNow) {
    const next = slots.map(s => s ? { def: s.def, lvl: s.lvl } : null);
    const existing = next.findIndex(s => s && s.def.id === def.id);
    if (existing >= 0) next[existing] = { def, lvl: Math.min(3, next[existing].lvl + 1) };
    else {
      const empty = next.findIndex(s => !s);
      if (empty >= 0) next[empty] = { def, lvl: 1 };
      else next[0] = { def, lvl: 1 };
    }
    const m2 = computeMods(next);
    const before = {};
    for (const s of (modsNow.multSrcs || [])) before[s.key + s.op] = s;
    const newConds = [];
    for (const s of m2.multSrcs) {
      if (s.op !== 'x') continue;
      const old = before[s.key + s.op];
      if (!old || old.val !== s.val) newConds.push({ name: s.name, icon: s.icon, val: s.val, label: s.label });
    }
    return { baseNow: modsNow.multBase, baseNext: m2.multBase, newConds };
  }

  /* ── 卡牌定价：稀有度 × 当前权益，越富越贵（永远值得纠结） ── */
  const PRICE_PCT = { 1: 0.015, 2: 0.03, 3: 0.05, 4: 0.09 };
  const PRICE_MIN = { 1: 150, 2: 250, 3: 400, 4: 800 };
  function priceOf(rarity, equity) {
    const p = Math.max(equity, 0) * (PRICE_PCT[rarity] || 0.02);
    return Math.max(PRICE_MIN[rarity] || 150, Math.round(p / 10) * 10);
  }

  /* ── 卡池抽取 ─────────────────────────────────────── */
  const RARITY_W = { 1: 52, 2: 30, 3: 13, 4: 5 };

  function rollOffer(rnd, state) {
    /* state: {slots, rerollStreak, guarantee} guarantee:'epic'|null */
    const owned = {};
    for (const s of state.slots) if (s) owned[s.def.id] = s.lvl;
    const pool = DEFS.filter(d => (owned[d.id] || 0) < 3);

    const pickOne = (forceMinRarity) => {
      // 通用池固定 20% 出现率
      const wantWild = rnd() < 0.2;
      let cands = pool.filter(d => wantWild ? d.school === 'wild' : d.school !== 'wild');
      if (!cands.length) cands = pool;
      if (forceMinRarity) {
        const hi = cands.filter(d => d.rarity >= forceMinRarity);
        if (hi.length) cands = hi;
      }
      // 稀有度加权 + 连续刷新保底
      let weights = cands.map(d => {
        let w = RARITY_W[d.rarity] || 10;
        if (state.rerollStreak >= 3 && d.rarity >= 3) w *= 1 + (state.rerollStreak - 2) * 0.5;
        // 差一张就触发套装的流派略微加权（制造「就差一张」的 chase）
        if (state.setChase && state.setChase[d.school]) w *= 1.6;
        return w;
      });
      let sum = weights.reduce((a, b) => a + b, 0), r = rnd() * sum;
      for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) return cands[i]; }
      return cands[cands.length - 1];
    };

    const offer = [];
    const minR = state.guarantee === 'epic' ? 3 : null;
    if (minR) offer.push(pickOne(minR));
    while (offer.length < 3) {
      const d = pickOne(null);
      if (!offer.includes(d)) offer.push(d);
    }
    // 避免三张同流派（软性多样性）
    if (offer.every(d => d.school === offer[0].school)) {
      const other = pool.filter(d => d.school !== offer[0].school && !offer.includes(d));
      if (other.length) offer[2] = rnd.pick(other);
    }
    return rnd.shuffle(offer);
  }

  MC.Buffs = {
    SCHOOLS, RARITY, DEFS, SETS, HIDDEN,
    byId: id => DEFS.find(d => d.id === id),
    computeMods, rollOffer, levelScale, evalMult, preview, priceOf,
    descOf: (def, lvl) => def.desc(levelScale(lvl)),
    labelOf: (def, lvl) => def.label ? def.label(levelScale(lvl)) : null,
  };

})(window.MC);
