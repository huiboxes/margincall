# Requirements: 主题系统与视觉风格

## Goal
让同一套玩法可以用多套视觉、图表、音色和文案风格呈现。

## Requirements
- [x] 设计令牌集中在 `css/tokens.css`，结构层与主题层分离。
- [x] 主题注册表统一管理 CSS、图表画法、音色预设与文案。
- [x] 实现 neon、sumi、crt、pop、vault、receipt、vapor、tarot 八套主题。
- [x] 主题 CSS 作用域为 `[data-theme=id]`，不会污染其他主题。
- [x] 主题可在标题页选择和对局暂停菜单热切换，游戏状态不丢失。

## Acceptance
八套主题均能加载；切换后 Canvas、音频和文案使用对应预设，控制台无错误。