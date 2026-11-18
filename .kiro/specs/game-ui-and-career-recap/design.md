# Design: 游戏界面与生涯复盘

`app.js` 编排标题、对局和结果三屏以及暂停、构筑、事件覆盖层。`chart.js` 根据 Engine 快照在 Canvas 绘制，Canvas 不保存游戏状态。`main.js` 负责启动、桌面快捷键和 `?auto` QA 钩子。

终局从 Engine 的结果快照生成权益曲线、奖项、复盘和分享 Canvas。

## Verification
用 `?auto=1` 跑完整流程；手动检查标题、构筑、行动、终局与分享入口。