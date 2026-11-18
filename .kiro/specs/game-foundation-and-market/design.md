# Design: 游戏基础与盲开行情

`js/core/util.js` 建立 `window.MC`、事件、PRNG、格式化和存档。`js/core/market.js` 以 `Market.init(seed, scenario)` 选择参数化剧本，将每轮抽象成固定数量的 tick；引擎只消费行情快照，UI 只消费引擎快照。

## Boundaries
- Market：生成和推进价格，不读 DOM。
- Engine：决定何时进入下一 tick。
- UI：绘制，不修改市场状态。

## Verification
相同 seed/scenario 的自动对局应得到相同结果。