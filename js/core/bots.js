/* ═══════════════════════════════════════════════════════════
   5 个有性格的 bot：规则引擎驱动，逐 tick 结算，实时排名
   会计模型：cash = 总资金（保证金内含）；持仓时 equity = cash + 浮动盈亏
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  const BOT_DEFS = [
    {
      id: 'allin', name: '梭哈怪', avatar: '🦍',
      bio: '永远满仓 10x，不是暴富就是暴毙。名言：「梭哈是一种智慧。」',
      quips: { open: '这次一定是底！满上！', bust: '……下次一定。', revive: '我亲戚又借了我一点。' },
    },
    {
      id: 'turtle', name: '老乌龟', avatar: '🐢',
      bio: '跌 5% 才买，零杠杆，买了就装死。名言：「急什么，钱是坐着赚来的。」',
      quips: { open: '这个价格……勉强可以。', bust: '（缓慢地缩回壳里）', revive: '壳还在，钱还在。' },
    },
    {
      id: 'insider', name: '内幕哥', avatar: '🕴',
      bio: '操作总是「恰好」对。从不解释。名言：「你不懂，我有渠道。」',
      quips: { open: '（压低声音）这轮别跟太紧。', bust: '消息……消息居然是假的？', revive: '里面有人罩着我。' },
    },
    {
      id: 'ming', name: '韭菜小明', avatar: '🌱',
      bio: '追涨杀跌情绪单担当，全场情绪安慰剂。名言：「这次不一样！」',
      quips: { open: '冲了冲了！不可能跌回去！', bust: '我妈说让我别玩了……', revive: '打工三个月，我又回来了！' },
    },
    {
      id: 'quant', name: '量化狗', avatar: '🤖',
      bio: '机械双均线策略，没有感情。名言：「BEEP. 信号触发。BEEP.」',
      quips: { open: 'MA3 上穿 MA8，信号确认。', bust: '策略回撤超限…重…启…', revive: '参数已重新拟合。BEEP.' },
    },
  ];

  const START_CASH = 10000;
  const FEE = 0.0004;
  const MMR = 0.005;

  function createBots() {
    return BOT_DEFS.map(def => ({
      def,
      cash: START_CASH,
      pos: null,          // {dir, lev, entry, N, margin}
      equity: START_CASH,
      roundStartEquity: START_CASH,
      alive: true,
      sitOut: 0,
      busted: 0,
      trades: 0,
      hist: [START_CASH],
      plan: null,
      lastAct: '观望',
      rumored: false,
      roundPnl: 0,
    }));
  }

  function equityOf(bot, P) {
    if (!bot.pos) return bot.cash;
    return bot.cash + bot.pos.N * (P / bot.pos.entry - 1) * bot.pos.dir;
  }

  /* 轮初决策（玩家行动前；可被窃听） */
  function planRound(bot, ctx) {
    const { prices, round, trueRet, rnd } = ctx;
    const P = prices[prices.length - 1];
    const lastRet = prices.length > 11 ? P / prices[prices.length - 11] - 1 : 0;
    let plan = { hold: false, flat: false, dir: 0, lev: 0, note: '' };

    if (!bot.alive) { bot.plan = null; return; }
    if (bot.sitOut > 0) { bot.plan = { flat: true, note: '在场外筹钱' }; return; }

    switch (bot.def.id) {
      case 'allin': {
        const dir = round === 1 ? 1 : (lastRet >= 0 ? 1 : -1);
        plan = { dir, lev: 10, note: '满仓' + (dir > 0 ? '做多' : '做空') + ' 10x' };
        break;
      }
      case 'turtle': {
        const win = prices.slice(-30);
        const hi = Math.max(...win);
        if (bot.pos && bot.pos.dir === 1) plan = { hold: true, note: '趴着不动' };
        else if (P < hi * 0.95) plan = { dir: 1, lev: 1, note: '跌够了，捡一点' };
        else plan = { flat: true, note: '太贵，不买' };
        break;
      }
      case 'insider': {
        /* v1.7 渠道消息带幅度噪声 + 随机休息：旧版 |trueRet|<0.5% 必休息，等于向玩家广播平轮；
           跟单大佬转述它的方向也曾合成 67.5% 的未来通道 */
        const accurate = rnd.chance(0.75);
        const believed = (accurate ? trueRet : -trueRet) + (rnd() - 0.5) * 0.06;
        if (Math.abs(believed) < 0.004 || rnd.chance(0.2)) plan = { flat: true, note: '渠道安静，休息' };
        else plan = { dir: believed >= 0 ? 1 : -1, lev: 5, note: '「渠道」有消息' };
        break;
      }
      case 'ming': {
        if (lastRet > 0.06) plan = { dir: 1, lev: rnd.chance(0.25) ? 8 : 3, note: '涨了这么多！冲！' };
        else if (lastRet < -0.06) plan = { dir: -1, lev: rnd.chance(0.25) ? 8 : 3, note: '完了完了！反手空！' };
        else if (lastRet > 0.005) plan = { dir: 1, lev: 3, note: '感觉要起飞' };
        else if (lastRet < -0.005) plan = { dir: -1, lev: 3, note: '感觉要崩' };
        else if (bot.pos) plan = { hold: true, note: '看不懂，拿着' };
        else plan = { flat: true, note: '观望中' };
        break;
      }
      case 'quant': {
        const closes = [];
        for (let i = prices.length; i > 0; i -= 10) closes.unshift(prices[Math.max(0, i - 1)]);
        const ma = n => closes.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, closes.length);
        const fast = ma(3), slow = ma(8);
        if (fast > slow * 1.002) plan = { dir: 1, lev: 3, note: 'MA3>MA8 多头信号' };
        else if (fast < slow * 0.998) plan = { dir: -1, lev: 3, note: 'MA3<MA8 空头信号' };
        else if (bot.pos) plan = { hold: true, note: '无信号，维持' };
        else plan = { flat: true, note: '等待信号' };
        break;
      }
    }

    // 谣言散布：中招 bot 方向反转
    if (ctx.rumorTargets && ctx.rumorTargets.has(bot.def.id) && plan.dir) {
      plan.dir = -plan.dir;
      plan.note = '收到「小道消息」';
      bot.rumored = true;
    } else bot.rumored = false;

    bot.plan = plan;
  }

  /* 轮初执行计划（resolve 开始时） */
  function reposition(bot, ctx) {
    const { P } = ctx;
    if (bot.sitOut > 0) {
      bot.sitOut--;
      if (bot.sitOut === 0 && !bot.alive) {
        bot.alive = true;
        bot.cash = Math.max(bot.cash, 2000);
        ctx.emit && ctx.emit('botRevive', bot);
      }
      return;
    }
    if (!bot.alive) return;
    const plan = bot.plan;
    if (!plan) return;

    if (plan.hold) { bot.lastAct = plan.note; return; }

    // 平掉现有仓
    if (bot.pos) {
      bot.cash += bot.pos.N * (P / bot.pos.entry - 1) * bot.pos.dir;
      const wasDir = bot.pos.dir;
      bot.pos = null;
      if (plan.flat) { bot.lastAct = '平仓了'; ctx.flipFee && 0; return; }
      // 反手/重开：收旧名义手续费（近似摩擦）
      bot.cash -= 0;
      void wasDir;
    }
    if (plan.flat) { bot.lastAct = plan.note || '观望'; return; }

    // 开新仓
    const eq = Math.max(bot.cash, 0);
    const N = eq * plan.lev;
    const fee = N * FEE;
    bot.cash -= fee;
    bot.pos = { dir: plan.dir, lev: plan.lev, entry: P, N, margin: N / plan.lev };
    bot.lastAct = plan.note;
    bot.trades++;
  }

  /* 逐 tick 更新（浮动盈亏 + 强平判定） */
  function tick(bot, P, ctx) {
    if (!bot.pos) { bot.equity = bot.cash; return; }
    const u = bot.pos.N * (P / bot.pos.entry - 1) * bot.pos.dir;
    bot.equity = bot.cash + u;
    // 强平：equity < 名义 × 维持保证金率
    if (bot.equity < bot.pos.N * MMR) {
      bot.cash = Math.max(bot.roundStartEquity * 0.1, 150);
      bot.pos = null;
      bot.equity = bot.cash;
      bot.alive = false;
      bot.sitOut = 2;
      bot.busted++;
      bot.roundPnl = bot.cash - bot.roundStartEquity;
      ctx.emit && ctx.emit('botBust', bot);
    }
  }

  /* 轮末结算 */
  function settleRound(bot, P) {
    if (bot.pos) {
      // 浮动盈亏留在仓上（cash 不动），equity 已随 tick 更新
      bot.equity = bot.cash + bot.pos.N * (P / bot.pos.entry - 1) * bot.pos.dir;
    } else {
      bot.equity = bot.cash;
    }
    bot.roundPnl = bot.equity - bot.roundStartEquity;
    bot.hist.push(bot.equity);
    if (bot.equity < 250 && bot.alive && !bot.pos) {
      bot.alive = false; bot.sitOut = 2;
    }
  }

  /* 终局强制平仓 */
  function forceClose(bot, P) {
    if (bot.pos) {
      bot.cash += bot.pos.N * (P / bot.pos.entry - 1) * bot.pos.dir;
      bot.pos = null;
    }
    bot.equity = Math.max(bot.cash, 0);
  }

  MC.Bots = {
    BOT_DEFS, START_CASH,
    createBots, planRound, reposition, tick, settleRound, forceClose, equityOf,
  };

})(window.MC);
