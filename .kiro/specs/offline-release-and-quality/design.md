# Design: 离线发布与质量保障

游戏的运行入口是 `index.html`，按确定顺序 defer 加载本地脚本与样式。字体位于 `assets/fonts`。`check-source.mjs` 扫描 HTML/CSS/JS，禁止外部 URL、框架关键字，并以 `BASELINE` 防止存量超长文件继续增长。

三份 Steering 仅覆盖常用规则：项目总约束、JS 架构、手感。三个 Hook 只覆盖危险操作、保存源码、Spec 任务完成，避免打扰普通编辑。

## Verification
运行约束脚本，离线打开页面，使用自动对局钩子验证主循环。