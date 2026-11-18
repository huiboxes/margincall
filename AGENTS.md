# MarginCall

《全仓以赴》是零依赖的竖屏金融肉鸽。双击 `index.html` 即玩。

- 策划与实际架构：`docs/design.md`。
- 已完成的功能 Spec：`.kiro/specs/`，按基础、引擎、构筑、手感、UI、主题、发布分阶段记录。
- Kiro 规则：`.kiro/steering/`；质量检查：`node scripts/hooks/check-source.mjs`。
- 不启动开发服务器或 watch 进程。保持 `file://` 可玩，不引入框架、构建工具或远端资源。
