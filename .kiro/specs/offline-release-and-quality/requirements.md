# Requirements: 离线发布与质量保障

## Goal
把游戏交付为可靠、可检查、适合静态托管或本地双击运行的成品。

## Requirements
- [x] 字体与图标随仓库自托管，不依赖 CDN。
- [x] `?auto=1&seed=N&scen=S` 可无人值守跑完整局，用于回归检查。
- [x] 源码检查拒绝外部 URL、框架引用与新增超长源文件；存量超长文件使用只降不升的棘轮基线。
- [x] Kiro Steering 记录项目约束、游戏手感和 JavaScript 架构。
- [x] Kiro Hook 在保存源码与完成 Spec 任务后运行质量检查；危险 Git 或删除命令需确认。

## Acceptance
运行 `node scripts/hooks/check-source.mjs` 通过。离线打开页面不需要任何远端资源。