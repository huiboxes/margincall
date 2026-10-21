# 《全仓以赴》主题（皮肤）开发指南

一套主题 = 两个文件，零依赖、纯 CSS/JS，运行时热切换：

| 文件 | 职责 |
|---|---|
| `css/themes/<id>.css` | 全部视觉：变量 + 任意规则覆盖（布局骨架见 `css/base.css`） |
| `js/themes/<id>.js` | `MC.Themes.register({...})`：图表画风 / 音色 / 文案风味 / logo |

参考实现：`css/themes/neon.css` + `js/themes/neon.js`（霓虹夜）。

---

## 1. 注册 API

```js
MC.Themes.register({
  id: 'sumi',                 // 与 css 文件名一致
  name: '水墨长卷',            // 中文名（主题卡显示）
  en: 'INK SCROLL',           // 英文副标（标题栏 document.title 用）
  tagline: '…一句话气质…',     // 主题卡 + 标题页副标
  css: 'css/themes/sumi.css', // 相对 demo/ 的路径
  accentColor: '#f5efe0',     // <meta theme-color>
  audio: 'guqin',             // 音色预设：synth | guqin | crt | toy | felt | printer | wave | harp
  logo: '<div class="xx-logo">…</div>',  // 注入 #logo-slot 的 HTML
  chart: { …见下… },
  copy: { …见下… },
  onApply() {},               // 可选钩子（切主题时执行一次）
});
```

### chart（Canvas K线画风）

```js
chart: {
  bg(ctx, w, h, now),            // 可选：自绘背景（网格地平线/宣纸晕染/…）
  grid:   { color, width, dash:[...] },
  axisText: { color, font },
  up:   { body, wick, border },  // 阳线三色
  down: { body, wick, border },
  candle: 'rect' | 'round' | 'block' | 'brush' | 'engraved' | function(ctx, o, now){},
        // o = {x, y, w, h, cx, dir, col, style, top, bottom, price}
        //   x/y/w/h = 实体矩形；top/bottom = 影线端点；col = 当前方向颜色对象
  hollow: bool,                  // 阳线空心（雕版/老式美式）
  glow: px, glowColor,           // 霓虹辉光
  priceTag: { bg, fg, radius, font }, priceTagDown: {...},
  entryLine, liqLine, ghostLine, // 开仓线 / 强平线 / 先知幽灵线
  lastDot: color,
  roundDivider, roundLabel,
  scanlines: 0~1,                // CRT 扫描线强度
  vignette: [内色, 外色],         // 暗角
  padRight, padTop, padBottom,
}
```

渲染契约（共享层保证，主题只读勿改）：蜡烛 2 tick 一根、相邻蜡烛共享边界 tick
（前收 = 后开），每轮收盘 tick 画进本轮最后一根——所以 K 线首尾相接不断裂；
canvas 尺寸由 ResizeObserver 实时跟随 `#market` 容器（对局中布局行高会变），
`bg(ctx,w,h,now)` 每帧拿到真实尺寸；主题**不得**手写 canvas 宽高或假设固定高度。
初期窄振幅按中价 6% 最小振幅垂直缩放（防"针柱"）；前半局现价 tag 贴最后一根蜡烛；
强平/止损/止盈线仅距现价 35% 内才参与坐标范围。主题可覆盖 `slLine/tpLine`
（止损橙 / 止盈绿虚线色）。

### copy（文案风味；全部可选，缺省见 `js/ui/theme.js` DEFAULT_COPY）

```js
copy: {
  gameTitle, startBtn, buy, sell, chargeHint, buffTitle,
  phaseNames: { buff, act, resolve, between, end },
  resultKicker, revealKicker, roastTitle, againBtn,
  telegram: { agency, kicker, stamp },
  telegramText: {                 // fn(event) → {title, body}；body 支持 \n
    sec:    t => ({...}),         // t.penalty
    plug:   t => ({...}),
    antitrust: t => ({...}),      // t.payer / t.fine / t.share / t.youGot / t.youPaid
  },
  roast(stats, results) { return '一段毒舌复盘长文本…'; },  // 不返回则用通用模板
}
```

`stats` 关键字段：`start, finalEq, mult, peak, liqs, trades, fees, maxLev, accuracy,
holdRounds, maxHoldStreak, chase, panic, correctDirs, wrongDirs, bonusTotal,
rumorVictims, regs(liqRounds 见 results), bestRound, worstRound`。

**v5 文案密度红线（2026-10-18 起，全主题生效）**：电报 `telegramText` 正文 ≤3 行；
`roast` ≤4 句、每句 ≤18 字；`chargeHint/buffTitle/resultKicker/revealKicker` 等
≤10 字；kicker 等装饰位禁用彩色 emoji（⚡ 一类也算，用排版符号或空格断字）；
copy 内不出现"皮肤/换装/demo"字样。腔调保留在标题与句尾金句，正文只讲事实与数字。
（v1.0.0 起八套全部达标：2026-10-18 七套迁移完成，工具见 tools/tokenize-theme.py。）

---

## 2. CSS 约定

- **一切规则用 `[data-theme="<id>"]` 作用域**（`<html>` 上会挂该属性），
  CSS 变量直接覆盖在 `[data-theme="<id>"] { --bg: …; }`。
- 可覆盖变量：`--bg --bg-2 --panel --panel-2 --card --line --ink --ink-dim
  --ink-faint --up --down --gold --accent --accent-2 --warn --font-display
  --font-body --font-num --radius-s/m/l`。
- 字体是同源自托管的子集（`css/fonts.css` + `assets/fonts/*.woff2`，由 `tools/build-fonts.py` 生成，
  不依赖 Google Fonts / 任何外部域名）：Orbitron / Chakra Petch / Ma Shan Zheng /
  ZCOOL XiaoWei / ZCOOL KuaiLe / VT323 / Share Tech Mono / Fredoka /
  Cormorant Garamond / Noto Sans SC / Noto Serif SC（+系统回退）。
  新增字体家族或改了中文文案后跑一次 `python3 tools/build-fonts.py`（需要 `fonttools` + `brotli`，
  构建时要能访问 `raw.githubusercontent.com`；字体产物已入库，日常运行不需要重跑），
  脚本会扫描 js/css/html 里出现过的所有字符重新子集化；漏掉的字会回退系统字体，不会出豆腐块。
- 纹理一律 CSS 生成（渐变 / repeating-gradient / radial / SVG data-uri /
  box-shadow / mask），**不引外部图片**。
- 关键 DOM 钩子（完整清单读 `css/base.css`）：
  - 标题：`#screen-title .title-bg .title-scroll .logo .tagline .theme-picker
    .theme-card .tc-preview .title-stats .title-actions
    .mode-switch .mode-opt(.on/.soon/.nope) #mode-solo #mode-multi`（v1.1）
  - 对局：`#hud .hud-round .equity .pnl .tremor-meter .regulator-lights
    #slots-bar .slot .sl-icon .sl-glyph .sl-lvl .set-prog .sp(.near)
    #engine-row #status-row .st-chip .st-cond(.met/.pay) #mult-badge[data-tier=base|hot|gold|fire]
    #theme-picker .theme-cards #rail-prev #rail-next.rail-btn   标题页界面风格横轨（滚轮/拖拽/箭头，v1.6）
    #dock .charge-zone #btn-cashout.cashout-btn(.loss) .co-k #co-val #co-cost.co-cost .co-key   v1.2 盘中落袋（覆盖蓄力区；浮盈 = --up 实心 + --bg 字，.loss = --down 描边态）
    #market(#market.glow-up/.glow-down/--pnl-a) .pos-card .pos-dir .hint-stack .hint-chip
    #rank-strip .rank-row #dock .trade-btn.buy/.sell .charge-fill
    .charge-core .lev-big .lev-track .lev-needle .lev-hint .btn-close .btn-hold`
  - 演出层（v2，全部走变量契约；主题可加签名演绎但不强制）：
    `#float-layer .float-txt(.good/.bad/.gold/.mult/.crit) #fx-vignette(.gold/.red/.green/.nearliq)
    #app.shake-soft/.shake-mid/.shake-hard .center-flash(.milestone/.setflash/.crit)
    .round-summary.score .rs-steps .rs-step(.add/.mul/.crit) .slot.scoring/.pop/.lvup
    .fly-card .mult-panel .mp-row(.whale/.seer/.econ/.wild) .me-card .me-row`
  - 构筑：`#overlay-buffs .buff-panel .buff-head .buff-cash .buff-mult .buff-cards .buff-card.r1~r4.<school>(.poor/.locked/.maxed)
    .bc-top .bc-school .bc-rarity .bc-mult(倍率预览chip) .bc-set-chip(套装追逐金标) .bc-cond
    .bc-icon .bc-emoji .bc-glyph .bc-name .bc-sub
    .bc-desc .bc-own .bc-lock .bc-pick(b+small 价格) .buff-foot .btn-reroll(.hot/.free)`
    （水墨系想用汉字代替 emoji：`.bc-emoji{display:none} .bc-glyph{display:grid}`，
    槽位同理 `.sl-icon/.sl-glyph`）
  - 流派可读性（v3）：`.school-bar .sb-item(.near)(.whale/.seer/.econ)`（商店头部流派
    进度条，i/b/small 三段）；图鉴弹层 `#overlay-school .school-panel .school-close
    .school-scroll .sch-intro .sch-sec(.whale/.seer/.econ/.wild/.hidden-set/.risk)`
  - 风险三档（v3，下单坞首行）：`#dock .risk-row .risk-label .risk-chip(.on)
    [data-risk=bare|sl|both] .risk-hint`（盘面读数：动量箭头+波动档位；芯片纯文字无 emoji）
  - 字印系统（v4，base.css 默认）：`.bc-glyph`/`.sl-glyph` 默认显示、`.bc-emoji`/
    `.sl-icon` 默认隐藏（**唯一例外 pop**：pop.css 把 emoji 卡面开回来）；
    印章盒钩子：`.hint-chip .hc-icon` `.aw-icon` `.sb-item i` `.sch-sec h3 em`
    `.br-chip em` `.drama-icon` `.st-chip i`（1px currentColor 描边方章，随主题变色）；
    `.hint-chip.bent` 金边 = 该情报正在改写本轮行情
  - 电报：`#overlay-telegram .telegram .tg-head .tg-kicker .tg-title .tg-body
    .tg-stamp .tg-ok`（打字机逐字 + 盖章动画由 JS 驱动，`.stamped` 类触发）
  - 剧情：`#overlay-drama .drama .drama-liq/.drama-rescue/.drama-revive/.drama-hidden/.drama-cap`
  - 结算（v3 四幕步进）：`#screen-result #result-scroll .res-pager
    .res-step(.on)(.st-final/.st-replay/.st-awards/.st-recap) .res-quick
    .res-banner .rb-* .res-sec .rs-title .curve-box
    .reveal-card .rc-back .rc-front .award-grid .award-card .profile-card .pf-*
    .roast-card .final-standings .build-row .me-card .res-actions
    .res-nav(.end) .res-dots i(.on) #res-home #res-next`
    结构契约：四幕各占一屏、.res-nav 常驻底部且只有两个出口——#res-home「回到主界面」
    + #res-next 下一幕；**终幕（.res-nav.end）主按钮即「再来一局」**，主题可换文案腔调
    （copy.againBtn）但不得隐藏这两个按钮或改回长滚动。
  - 通用：`.btn .btn-primary .btn-ghost .btn-xl .toast .round-summary .rs-main
    .center-flash #fx-layer .overlay`
- 动画/质感要有「签名动作」：一个只属于该主题的标志性视觉（霓虹=灯管闪烁，
  水墨=墨晕扩散，CRT=开机自检，波普=贴纸弹跳，老钱=火漆压印……）。
- 移动端竖屏 390×844 优先；桌面居中 480px 容器。禁止横向溢出。

### 视觉契约 v4 · 去 AI 味（2026-10-18）

- **UI 骨架默认不用彩色 emoji**：卡面/槽位/情报/状态/奖项/剧情/倍率源一律单字
  印章（glyph 取自 buffs.js 每卡 `glyph` 字段与 SCHOOLS.glyph）。pop 主题是唯一
  例外（贴纸玩具美学），在 pop.css 里开回 emoji 卡面。
- **按钮禁三件套**：紫粉渐变底 + 彩色外光晕 + 无限扫光/流光动画。base
  `.btn-primary` = 实色 + 顶部内高光 + 深色投影；主题签名按钮走材质/灯管/烫金
  路线（vapor=暗面板+霓虹细边+地平线双色线；neon=灯管描边+字发光；
  tarot=静态鎏金；vault=烫金实底）。签名动效保留在别处，按钮上不许无限循环。
- 装饰符号只用排版符号（✦ ☾ ★ ❚ ✓），不用彩色 emoji。
- 验收：title/phase 截图逐张对照 AGENT-PROMPTS checklist 的「去AI味」三行。

### 视觉契约 v5 · 令牌层与质感（2026-10-18）

- `css/tokens.css` 先于 base.css 加载，是**设计数值唯一来源**：
  中性色阶 `--n-000..--n-900`（禁纯黑纯白）、白色低透 `--w-*`、功能色 `--c-*`、
  字阶 `--fs-2xs..--fs-hero`、间距 `--sp-1..--sp-10`（4px 基）、圆角 `--r-xs..--r-full`、
  动效 `--dur-1..4`（120/200/320/480ms）× `--ease-out/--ease-snap/--ease-inout`、
  材质 `--hairline/--sheen/--press/--elev-1..4`、层级 `--z-*`。
- 主题只许覆盖两层：语义层（`--bg --ink --up --accent …`，即旧变量契约）与
  组件层（`--btn-primary-bg/-ink/-shadow/-shadow-active`）。**禁止在主题文件里
  新写死 px 色值/圆角/动效时长**——要新数值就在报告里申请加令牌。
- 质感公式：层级靠材质分层（发丝线 + 顶部内高光 + 分级投影），不靠彩色光晕；
  `prefers-reduced-motion` 下令牌时长归零，主题无需各自实现降级。
- 主 UI = neon：新皮肤的气质对照基准是 neon 的 title/phase 截图，不是别的皮肤。
- 验收：在 checklist「去AI味」三行之外，加查「文字密度」「令牌化」两行。

## 3. 验收

```bash
cd tools
node qa.js title <id>        # 标题页两张截图 → tools/shots/title-<id>.png
node qa.js phase <id> 42     # buff/蓄力/行情/电报 六张截图
node qa.js auto 7 luna <id>  # 无人值守整局 + 结算页六张截图 + console 报错
```

Read 截图逐张检查：对比度、溢出、字重层级、动效是否生效；**零 console 报错**；
至少迭代 3 轮视觉打磨。不得修改共享文件（base.css / app.js / engine.js / 其他主题），
发现共享层 bug 写在最终报告里。
