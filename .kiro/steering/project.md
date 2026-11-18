# MarginCall 项目规则

- 移动端优先：竖屏、Pointer Events、拇指区按钮、safe-area；禁止缩放、选中和长按菜单。
- 使用原生 HTML、CSS、经典 `<script defer>` 和 Canvas 2D；禁止框架、构建工具、外部资源。音效用 WebAudio 合成。
- 保持 `file://` 双击可玩，因此不改用 ES Modules。
- 先读 `docs/design.md` 和相关 `.kiro/specs/<feature>/`，实现与已完成设计冲突时先问。
- 新增玩法数值必须集中在所属模块的命名配置区；跨模块数值变更先建立专门 Spec，避免无验证的大规模迁移。
- 新文件必须少于 300 行。存量超长文件受 `check-source.mjs` 棘轮限制，只能变短。
- 优先手感、反馈、状态正确性和触控边界；不做无关重构。