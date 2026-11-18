---
inclusion: fileMatch
fileMatchPattern: "js/**/*.js"
---
# 原生 JavaScript 架构

- 代码以 `(function (MC) { ... })(window.MC)` 组织，接口挂到 `window.MC`。加载顺序由 `index.html` 定义：`core` → `ui` → `themes` → `main`。
- `Engine` 是交易状态和结算的唯一事实来源。UI、Canvas、Audio 只调用公开接口，不直接写游戏状态。
- Market 不读 DOM；Chart 不改变市场或引擎；Audio 与振动能力不可用时静默降级。
- 输入用 Pointer Events，必须处理 `pointercancel`、捕获丢失和页面隐藏。
- Canvas 使用 devicePixelRatio，动画使用 requestAnimationFrame，避免每帧创建大量对象。
- 新增脚本必须加入 `index.html` 的正确加载位置并带统一 `?v=` 缓存参数。