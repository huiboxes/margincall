# Design: 移动端控制与游戏手感

`js/ui/app.js` 将 Pointer Events 转成 Engine 的公开动作。它在 pointerdown 捕获指针，按帧更新蓄力，并在 up/cancel/lostcapture/visibilitychange 收尾。`tremor.js` 提供输入噪声；`audio.js` 仅合成短音，不影响游戏状态。

反馈按风险提升：蓄力与开仓给即时反馈，接近强平持续告警，强平同时使用画面、声音和振动。能力不可用时静默跳过。

## Verification
真机长按、取消、后台切换和双击全平都不应卡住输入。