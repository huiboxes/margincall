/* ═══════════════════════════════════════════════════════════
   主题注册表：CSS 文件切换 + 图表画风 + 音色 + 文案风味
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  /* v5 文案红线：电报正文 ≤3 行、toast ≤13 字、卡牌描述一行「条件→效果」。
     腔调保留在标题与金句里，正文只讲事实与数字。 */
  const DEFAULT_COPY = {
    buy: '开多', sell: '开空', closeAll: '全部平仓', hold: '本轮不动',
    chargeHint: '长按蓄力 · 松手下单',
    phaseNames: { buff: '构筑', act: '行动', resolve: '行情', between: '结算', end: '终局' },
    telegram: { agency: 'SEC', kicker: '紧急电文', stamp: '立即执行' },
    telegramText: {
      sec: t => ({ title: 'SEC 关注函', body: `连续三轮收益超 50%，你上榜了。\n下一轮收益罚没 ${Math.round(t.penalty * 100)}%。\n请低调发财。` }),
      plug: () => ({ title: '交易所拔网线', body: '杠杆超 20x 三轮，服务器「恰好」深夜维护。\n仓位强制降至 5x。请勿追问技术原因。' }),
      antitrust: t => ({ title: '反垄断调查', body: `首富「${t.payer}」领先末位超 5 倍。\n罚没 ${MC.fmt.money(t.fine)} 均分垫底。${t.youGot ? `\n你分到 ${MC.fmt.money(t.youGot)}。` : ''}` }),
      raid: t => ({ title: t.heat >= 2 ? 'SEC 突击检查 · 惯犯' : 'SEC 突击检查', body: `收益跑太快，检查组「恰好」路过。\n没收超额 ${MC.fmt.money(t.seized)}。${t.heat >= 2 ? `第 ${t.heat} 次立案。` : ''}\n发财可以，别太明显。` }),
    },
    roast: null, // 主题可覆盖：fn(stats) → [句子...]，每句 ≤18 字
  };

  const registry = {};
  const order = [];
  let currentId = null;

  function register(def) {
    def.copy = Object.assign({}, DEFAULT_COPY, def.copy || {});
    def.copy.telegram = Object.assign({}, DEFAULT_COPY.telegram, (def.copy || {}).telegram || {});
    def.copy.telegramText = Object.assign({}, DEFAULT_COPY.telegramText, (def.copy || {}).telegramText || {});
    def.copy.phaseNames = Object.assign({}, DEFAULT_COPY.phaseNames, (def.copy || {}).phaseNames || {});
    registry[def.id] = def;
    order.push(def.id);
  }

  function apply(id, opts) {
    const def = registry[id];
    if (!def) return false;
    currentId = id;
    document.documentElement.setAttribute('data-theme', id);
    const link = document.getElementById('theme-css');
    if (link) link.href = def.css;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && def.accentColor) meta.setAttribute('content', def.accentColor);
    if (def.audio) MC.Audio.setPreset(def.audio);
    if (def.onApply) def.onApply();
    if (!opts || !opts.silent) MC.save.write({ theme: id });
    MC.bus.emit('theme:changed', def);
    return true;
  }

  MC.Themes = {
    register, apply,
    get(id) { return registry[id]; },
    get all() { return order.map(i => registry[i]); },
    get current() { return registry[currentId]; },
    get currentId() { return currentId; },
    get copy() { return (registry[currentId] || {}).copy || DEFAULT_COPY; },
    get chartStyle() { return (registry[currentId] || {}).chart || {}; },
    DEFAULT_COPY,
  };

})(window.MC);
