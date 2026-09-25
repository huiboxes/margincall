/* ═══════════════════════════════════════════════════════════
   行情系统：程序生成剧本 × 名场面库（盲开，局末揭晓）
   每局 15 轮 × 每轮 10 tick = 150 tick，2 tick 合成 1 根K线
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  const ROUNDS = 15;
  const TPR = 10;          // ticks per round
  const TPC = 2;           // ticks per candle
  const NOISE = (MC.TUNE && MC.TUNE.noise) || 0.55;   // tick 噪声系数（路径风险 = 杠杆决策的税；v1.2.1 0.35→0.8）
  const RET_NOISE = (MC.TUNE && MC.TUNE.retNoise) || 0.18;   // 噪声下限随本轮幅度：大行情路径更颠——盲开高杠杆会被洗掉，读雷达定杠杆才是技巧
  const WICK_OVER = 1.8;   // wick 冲高峰值 = 1.8× 目标对数收益（再叠加收尾修正后 ≈ 2.2×）

  /* shape 权重：决定轮内价格走势形态
     drift 匀速 / waterfall 尾段加速下跌 / squeeze 尾段加速上涨
     spike 单根针 / wick 大幅 overshoot 后收回 / v 先反后正
     chop 震荡 / gap 首 tick 跳空 */
  function shapeWeights(shape) {
    switch (shape) {
      case 'waterfall': return [0.03, 0.04, 0.05, 0.06, 0.07, 0.09, 0.11, 0.15, 0.19, 0.21];
      case 'squeeze':   return [0.03, 0.04, 0.05, 0.06, 0.07, 0.09, 0.11, 0.15, 0.19, 0.21];
      case 'spike':     return [0.02, 0.02, 0.02, 0.02, 0.78, 0.06, 0.03, 0.02, 0.02, 0.01];
      case 'gap':       return [0.62, 0.08, 0.06, 0.05, 0.04, 0.04, 0.03, 0.03, 0.03, 0.02];
      case 'chop':      return [0.28, -0.2, 0.24, -0.16, 0.2, -0.14, 0.16, -0.12, 0.1, 0.04];
      case 'v':         return [-0.1, -0.14, -0.12, -0.08, -0.02, 0.1, 0.18, 0.24, 0.26, 0.24];
      case 'wick':      return [0.3, 0.5, 0.7, 0.9, 0.4, -0.3, -0.6, -0.7, -0.6, -0.5];
      case 'drift':
      default:          return [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    }
  }

  /* 轮定义速记：[收益率, 形态, 微噪声幅度] */
  function R(ret, shape, vol) { return [ret, shape || 'drift', vol === undefined ? Math.min(0.02, Math.abs(ret) * 0.35 + 0.004) : vol]; }

  /* ── 名场面剧本库 ─────────────────────────────────────── */
  const SCENARIOS = [
    {
      id: '312', base: 7900, asset: 'BTC',
      name: '黑色星期四',
      reveal: '2020-03-12 · 比特币熔断日（312）',
      fact: 'BTC 24 小时从 $7,900 砸穿 $3,800，全网爆仓逾 10 亿美元，多家交易所宕机拔网线。',
      rounds: [R(0.01, 'drift'), R(-0.02, 'drift'), R(-0.04, 'drift', 0.012), R(-0.12, 'waterfall'), R(-0.18, 'waterfall', 0.03),
      R(0.08, 'wick', 0.03), R(-0.15, 'waterfall', 0.025), R(-0.10, 'drift', 0.02), R(0.12, 'v', 0.025), R(-0.06, 'chop', 0.02),
      R(0.05, 'chop', 0.015), R(-0.03, 'drift', 0.012), R(0.04, 'chop', 0.012), R(-0.02, 'drift', 0.01), R(0.03, 'drift', 0.01)],
    },
    {
      id: '519', base: 43000, asset: 'BTC',
      name: '黑色星期三',
      reveal: '2021-05-19 · 比特币 519 大暴跌',
      fact: '三部门联手发声，BTC 当日暴跌 30%+，近 300 万人爆仓。一个月后收复大半失地——恐慌盘倒在黎明前。',
      rounds: [R(0.03, 'drift'), R(0.02, 'drift'), R(-0.01, 'chop', 0.01), R(-0.08, 'waterfall'), R(-0.16, 'waterfall', 0.025),
      R(-0.10, 'waterfall', 0.02), R(0.14, 'v', 0.02), R(0.10, 'squeeze'), R(-0.05, 'wick', 0.02), R(0.06, 'chop', 0.015),
      R(-0.03, 'chop', 0.012), R(0.04, 'drift'), R(0.05, 'drift'), R(-0.02, 'chop', 0.01), R(0.03, 'drift')],
    },
    {
      id: 'luna', base: 80, asset: 'LUNA',
      name: '死亡螺旋',
      reveal: '2022-05 · LUNA 归零事件',
      fact: 'UST 脱锚，LUNA 一周内从 $80 跌到 $0.00001，600 亿美元蒸发。每次 30% 反弹都是下一波崩塌的助跑。',
      rounds: [R(0.04, 'drift'), R(-0.03, 'chop', 0.012), R(-0.08, 'waterfall'), R(0.22, 'squeeze', 0.02), R(-0.12, 'waterfall'),
      R(-0.25, 'waterfall', 0.03), R(0.26, 'wick', 0.04), R(-0.30, 'waterfall', 0.04), R(-0.26, 'waterfall', 0.04), R(0.15, 'wick', 0.03),
      R(-0.32, 'waterfall', 0.05), R(-0.26, 'drift', 0.04), R(0.10, 'chop', 0.03), R(-0.25, 'waterfall', 0.04), R(-0.20, 'drift', 0.04)],
    },
    {
      id: 'ftx', base: 21000, asset: 'BTC',
      name: '帝国崩塌',
      reveal: '2022-11 · FTX 交易所暴雷',
      fact: '全球第二大交易所挪用用户资产，48 小时破产。BTC 跌向 $15,500——币不是亏了，是取不出来了。',
      rounds: [R(0.01, 'drift'), R(0.02, 'drift'), R(-0.01, 'chop', 0.008), R(-0.03, 'drift'), R(-0.06, 'waterfall', 0.012),
      R(0.02, 'chop', 0.01), R(-0.20, 'gap', 0.02), R(-0.25, 'waterfall', 0.03), R(0.08, 'wick', 0.02), R(-0.18, 'waterfall', 0.025),
      R(-0.10, 'drift', 0.02), R(0.04, 'chop', 0.015), R(-0.05, 'drift', 0.012), R(0.03, 'chop', 0.01), R(-0.02, 'drift', 0.01)],
    },
    {
      id: 'gme', base: 65, asset: 'GME',
      name: '逼空史诗',
      reveal: '2021-01 · GameStop 世纪逼空',
      fact: '散户集体买入被重仓做空的 GameStop，10 天暴涨 16 倍。券商深夜禁买——规则是谁定的？',
      rounds: [R(0.05, 'drift'), R(0.12, 'squeeze'), R(0.22, 'squeeze', 0.03), R(-0.15, 'waterfall', 0.025), R(0.32, 'squeeze', 0.05),
      R(0.18, 'squeeze', 0.03), R(-0.35, 'waterfall', 0.04), R(-0.20, 'waterfall', 0.03), R(0.15, 'v', 0.025), R(-0.10, 'chop', 0.02),
      R(0.08, 'chop', 0.02), R(-0.06, 'chop', 0.015), R(0.05, 'chop', 0.015), R(-0.04, 'chop', 0.012), R(0.03, 'chop', 0.01)],
    },
    {
      id: 'nickel', base: 29000, asset: 'NICKEL',
      name: '妖镍冲天',
      reveal: '2022-03 · LME 镍逼空事件',
      fact: '伦镍两日暴涨 250%，金属史最大逼空。LME 史上首次取消交易，「大宗之王」一夜变「大宗笑话」。',
      rounds: [R(0.01, 'drift'), R(-0.01, 'chop', 0.008), R(0.02, 'drift'), R(0.08, 'squeeze'), R(0.22, 'squeeze', 0.03),
      R(0.45, 'spike', 0.04), R(0.28, 'squeeze', 0.05), R(-0.05, 'chop', 0.01), R(-0.20, 'waterfall', 0.03), R(-0.25, 'waterfall', 0.03),
      R(0.06, 'wick', 0.02), R(-0.10, 'drift', 0.02), R(0.04, 'chop', 0.015), R(-0.06, 'drift', 0.015), R(0.03, 'chop', 0.012)],
    },
    {
      id: 'bull', base: 25000, asset: 'BTC',
      name: '慢牛爬坡',
      reveal: '2023-Q4 · 比特币慢牛复苏',
      fact: 'ETF 预期发酵，BTC 三个月从 $25,000 爬到 $44,000。没有暴跌没有插针，「每天涨一点」最折磨空头。',
      rounds: [R(0.02, 'drift'), R(0.04, 'drift'), R(0.03, 'drift'), R(-0.03, 'chop', 0.01), R(0.04, 'drift'),
      R(0.03, 'drift'), R(0.05, 'drift'), R(-0.02, 'chop', 0.008), R(0.04, 'drift'), R(0.03, 'drift'),
      R(-0.04, 'chop', 0.01), R(0.05, 'drift'), R(0.03, 'drift'), R(0.04, 'drift'), R(0.03, 'drift')],
    },
    {
      id: 'crab', base: 100, asset: 'SYNTH',
      name: '织布机行情',
      reveal: '某不知名交易所 · 横盘震荡市',
      fact: '上下 6% 箱体织布：追涨被埋，杀跌被抽。老手只做一件事——等。73% 的爆仓发生在震荡市。',
      rounds: [R(0.05, 'chop', 0.012), R(-0.06, 'chop', 0.014), R(0.04, 'chop', 0.012), R(-0.05, 'chop', 0.012), R(0.06, 'chop', 0.014),
      R(-0.04, 'chop', 0.01), R(0.05, 'chop', 0.012), R(-0.07, 'chop', 0.015), R(0.05, 'chop', 0.012), R(-0.04, 'chop', 0.01),
      R(0.06, 'chop', 0.014), R(-0.05, 'chop', 0.012), R(0.04, 'chop', 0.01), R(-0.06, 'chop', 0.014), R(0.05, 'chop', 0.012)],
    },
    {
      id: 'memecoin', base: 0.00042, asset: 'DOGE-LIKE',
      name: '土狗升天',
      reveal: '2021 · 某 MEME 币拉高出货',
      fact: '电报群喊单的土狗币 5 天拉 8 倍，项目方凌晨 3 点清仓——K 线画出对称大山，山顶的人至今在等解套。',
      rounds: [R(0.08, 'squeeze'), R(0.15, 'squeeze', 0.02), R(0.12, 'squeeze', 0.02), R(0.20, 'squeeze', 0.03), R(0.10, 'squeeze', 0.025),
      R(-0.08, 'waterfall', 0.02), R(-0.15, 'waterfall', 0.025), R(-0.22, 'waterfall', 0.03), R(0.06, 'wick', 0.025), R(-0.18, 'waterfall', 0.03),
      R(-0.12, 'waterfall', 0.02), R(0.04, 'chop', 0.015), R(-0.08, 'drift', 0.015), R(0.03, 'chop', 0.012), R(-0.05, 'drift', 0.012)],
    },
    {
      id: 'swan', base: 8800, asset: '???',
      name: '周末黑天鹅',
      reveal: '某个周日的凌晨 · 流动性真空闪崩',
      fact: '周日凌晨 4 点，一条无人证实的推文让价格 90 秒蒸发 38%。等你看到爆仓短信，价格已修复一半。',
      rounds: [R(0.01, 'drift'), R(0.0, 'drift', 0.002), R(0.01, 'drift'), R(-0.02, 'drift', 0.006), R(0.0, 'drift', 0.002),
      R(-0.32, 'gap', 0.03), R(0.20, 'v', 0.03), R(-0.08, 'chop', 0.02), R(0.10, 'v', 0.02), R(-0.04, 'chop', 0.015),
      R(0.03, 'drift', 0.01), R(-0.02, 'chop', 0.01), R(0.05, 'drift'), R(0.02, 'drift'), R(-0.03, 'chop', 0.01)],
    },
  ];

  /* ── 生成器 ───────────────────────────────────────────── */
  function gauss(rnd) { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function generate(scen, rnd) {
    rnd = rnd || MC.rng(Date.now() & 0xffffffff);
    const prices = [scen.base];
    const roundBounds = [{ start: 0, end: 0 }]; // round i 占据 tick (start, end]
    const roundRets = [];
    let p = scen.base;

    for (let r = 0; r < ROUNDS; r++) {
      const [ret, shape, vol] = scen.rounds[r];
      const weights = shapeWeights(shape);
      /* 形态权重 → 目标对数收益的占比（w/norm 与收益正负无关，负收益自然翻转形态）。
         一般形态按权重和归一；wick 的权重和只有 0.1，按和归一会把冲高放大到 ~28× 目标
         （luna 单轮 640 倍尖针）——改按累计峰值归一：冲高峰值 = WICK_OVER × 目标，再收回 */
      let norm = weights.reduce((a, b) => a + b, 0) || 1;
      if (shape === 'wick') {
        let c = 0, pk = 0;
        for (const w of weights) { c += w; pk = Math.max(pk, c); }
        norm = pk / WICK_OVER;
      }
      const logTarget = Math.log(1 + ret);

      // 分配对数收益 + 高斯微噪声
      const raw = [];
      for (let t = 0; t < TPR; t++) {
        raw.push((weights[t] / norm) * logTarget + gauss(rnd) * Math.max(vol, Math.abs(ret) * RET_NOISE) * NOISE);
      }
      // 重归一化：确保本轮乘出来正好是目标收益（噪声只改变路径不改变终点）
      const rawSum = raw.reduce((a, b) => a + b, 0);
      const fix = logTarget - rawSum;
      const startTick = prices.length - 1;
      for (let t = 0; t < TPR; t++) {
        p = p * Math.exp(raw[t] + fix / TPR);
        prices.push(Math.max(p, scen.base * 1e-6));
      }
      roundBounds.push({ start: startTick, end: prices.length - 1 });
      roundRets.push(prices[prices.length - 1] / prices[startTick] - 1);
    }

    // 统计特征（揭晓页用）
    let peak = prices[0], maxDD = 0, minP = Infinity, maxP = -Infinity;
    for (const v of prices) {
      if (v > peak) peak = v;
      const dd = 1 - v / peak;
      if (dd > maxDD) maxDD = dd;
      if (v < minP) minP = v;
      if (v > maxP) maxP = v;
    }
    let maxRoundUp = -Infinity, maxRoundDown = Infinity;
    for (const rr of roundRets) { if (rr > maxRoundUp) maxRoundUp = rr; if (rr < maxRoundDown) maxRoundDown = rr; }

    return {
      scen, prices, roundBounds, roundRets,
      stats: {
        totalRet: prices[prices.length - 1] / prices[0] - 1,
        maxDD, maxRoundUp, maxRoundDown,
        minP, maxP,
      },
    };
  }

  /* v1.6 每局剧本变体：名场面只提供「节奏」（每轮幅度/形态/噪声），方向逐轮独立抛硬币——
     v1.5 的整局镜像不改变相邻轮自相关，第 1 轮就暴露镜像，记谱者仍有 85% 命中（QA 第 5 轮）。
     唯一保留关联的是「名场面轮」（|收益|最大的一轮）：它跟随整局基调翻转，揭晓页据此写「平行宇宙」 */
  function variant(scen, rnd) {
    const mirror = rnd() < 0.5;
    let climax = 0;
    scen.rounds.forEach((r, i) => { if (Math.abs(r[0]) > Math.abs(scen.rounds[climax][0])) climax = i; });
    const rounds = scen.rounds.map(([ret, shape, vol], i) => {
      const sgn = i === climax ? (mirror ? -1 : 1) : (rnd() < 0.5 ? -1 : 1);
      return [sgn * ret * (0.8 + rnd() * 0.4), shape, vol];
    });
    const k = 0.55 + rnd() * 1.25;
    const raw = scen.base * k, mag = Math.pow(10, Math.floor(Math.log10(raw)) - 2);
    const base = Math.round(raw / mag) * mag;
    return Object.assign({}, scen, {
      base, rounds, mirror, climax: climax + 1, origin: scen.reveal,
      reveal: (mirror ? '平行宇宙版 · ' : '节奏改编 · ') + scen.reveal,
    });
  }

  /* 揭晓页统计按「玩家实际看到的」最终价格重算（内幕/造势/坐庄改写之后），与 K 线一致 */
  function statsOf(prices) {
    let peak = prices[0], maxDD = 0, minP = Infinity, maxP = -Infinity;
    for (const v of prices) {
      if (v > peak) peak = v;
      const dd = 1 - v / peak;
      if (dd > maxDD) maxDD = dd;
      if (v < minP) minP = v;
      if (v > maxP) maxP = v;
    }
    return { totalRet: prices[prices.length - 1] / prices[0] - 1, maxDD, minP, maxP, first: prices[0], last: prices[prices.length - 1] };
  }

  /* v4 行情改写（情报即火力）：把第 r 轮的未揭示段平滑注入方向性漂移，
     使该轮收益落到 targetRet。乘法坡道 c^(t/T)：轮内形态与噪声全保留，
     只是整体倾斜——「行情被你的情报牵引」。
     只允许改写 revealedTick 之后的轮（已揭示 tick 动了 K 线会跳变）。 */
  function bend(mkt, r, targetRet) {
    const b = mkt.roundBounds[r];
    const p0 = mkt.prices[b.start];
    const cur = mkt.prices[b.end] / p0 - 1;
    if (cur <= -0.999) return targetRet;
    const c = (1 + targetRet) / (1 + cur);
    for (let i = b.start + 1; i <= b.end; i++) {
      const t = (i - b.start) / (b.end - b.start);
      mkt.prices[i] *= Math.pow(c, t);
    }
    mkt.roundRets[r - 1] = mkt.prices[b.end] / p0 - 1;
    return mkt.roundRets[r - 1];
  }

  /* 2 tick → 1 根 K 线；返回全部 candles 与 round→candle 映射 */
  function toCandles(mkt) {
    const candles = [];
    const roundCandle = [];
    for (let r = 1; r <= ROUNDS; r++) {
      const b = mkt.roundBounds[r];
      const firstIdx = candles.length;
      for (let t = b.start; t < b.end; t += TPC) {
        const seg = mkt.prices.slice(t, Math.min(t + TPC, b.end) + 1);
        candles.push({
          o: seg[0], c: seg[seg.length - 1],
          h: Math.max(...seg), l: Math.min(...seg),
          round: r, tick: t,
        });
      }
      roundCandle.push({ round: r, from: firstIdx, to: candles.length - 1 });
    }
    return { candles, roundCandle };
  }

  function fmtPrice(v) {
    if (v >= 1000) return Math.round(v).toLocaleString('en-US');
    if (v >= 100) return v.toFixed(1);
    if (v >= 1) return v.toFixed(2);
    if (v >= 0.01) return v.toFixed(4);
    return v.toPrecision(3);
  }

  MC.Market = {
    ROUNDS, TPR, TPC,
    SCENARIOS, variant, statsOf,
    generate, toCandles, fmtPrice, bend,
    get noise() { return NOISE; },
    random(rnd) { return rnd.pick(SCENARIOS); },
    byId(id) { return SCENARIOS.find(s => s.id === id); },
  };

})(window.MC);
