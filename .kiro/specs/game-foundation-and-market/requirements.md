# Requirements: 游戏基础与盲开行情

## Goal
建立零依赖、可离线启动的 MarginCall 基础循环，并提供可复现的盲开行情。

## Requirements
- [x] 页面通过双击 `index.html` 可启动，无网络请求与构建步骤。
- [x] 提供 `window.MC` 命名空间、事件工具、种子随机、格式化与本地存档。
- [x] 内置 10 个参数化名场面剧本；每局以 seed 可重复地选择剧本。
- [x] 每局固定 15 轮，每轮 10 个行情 tick；开局只展示有限历史，局末揭晓场景。
- [x] 行情模块不读取 DOM，也不直接修改 UI。

## Acceptance
使用相同的 seed 与 scenario 进入游戏时，行情序列一致。断网和 `file://` 页面启动不阻塞。