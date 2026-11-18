# MarginCall 的 Kiro 工作方式

这个项目保留少量、真正会用到的 Kiro 配置。

| 类型 | 文件 | 使用时机 |
|---|---|---|
| 项目规则 | `.kiro/steering/project.md` | 每次开发 |
| JS 架构规则 | `.kiro/steering/javascript-architecture.md` | 读写 JS 时自动加载 |
| 手感规则 | `.kiro/steering/game-feel.md` | 玩法、反馈、移动端请求时自动加载 |
| 质量 Hook | `.kiro/hooks/source-quality-on-save.json` | 保存 HTML/CSS/JS 后检查 |
| Spec Hook | `.kiro/hooks/verify-after-spec-task.json` | 完成 Spec task 后检查 |
| 安全 Hook | `.kiro/hooks/confirm-dangerous-commands.json` | 删除文件、改写 Git 历史、强推前确认 |
| 专项审查 | `.kiro/agents/game-designer.md`、`game-qa.md` | 需要策划或 QA 二次意见时 |

## Spec 如何阅读

`.kiro/specs/` 中的七个目录按开发顺序记录已完成工作。每个目录都是 Kiro 标准的 requirements、design、tasks 三件套，任务均勾选完成。它们是该项目的开发档案，不是当前待办。

需要新功能时，新建一个对应功能的 Spec，例如 `new-buff-family` 或 `mobile-input-bugfix`。不要把多个不相关功能塞进同一个 Spec。

## 日常操作

1. 对功能需求：先建立或更新对应 Spec，再执行任务。
2. 保存源码后关注 Source Quality hook；它会拒绝新增外部资源、框架和超长文件。
3. 对有风险的设计改动：调用 `game-designer` 或 `game-qa` 审查。
4. 提交前运行：`node scripts/hooks/check-source.mjs`。
