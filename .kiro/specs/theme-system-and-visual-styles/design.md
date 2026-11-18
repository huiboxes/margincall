# Design: 主题系统与视觉风格

`css/tokens.css` 定义共享令牌，`base.css` 定义结构。每套主题以 `[data-theme]` 覆盖令牌和素材感。`js/ui/theme.js` 注册主题能力，`js/themes/*.js` 提供主题特有的图表、音色或文案配置。

切换时先变更 document theme，再通知图表与音频读取新预设，不重建 Engine。

## Verification
逐一选择八套主题，并在对局暂停时切换，确认状态保留。