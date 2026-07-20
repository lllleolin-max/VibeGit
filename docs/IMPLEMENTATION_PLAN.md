# Implementation Plan

实施按“先保证文件安全，再完成闭环，再扩展接入”执行：

1. 审查空工作区、Node/pnpm/Git/gh/Codex/Claude 和可用产品设计 Skills。
2. 固化产品上下文、UI 方向、架构和安全决策，创建任务清单。
3. 建立 pnpm TypeScript Monorepo、Electron 壳、CLI、SQLite、类型化 IPC 和测试基线。
4. 实现环境隔离的 Git Engine、独立 index、hidden refs、状态/Diff 与结构化错误。
5. 实现活动保存点、时间线、Agent 前后保存和无变化事件。
6. 实现影响预览、保险点、恢复区、撤销、暂时收起、PID 租约和崩溃调和。
7. 实现 `gh` 登录/Private 验证、专用 remote、敏感扫描与安全导出备份。
8. 实现首次使用、项目、时间线、Diff、恢复、恢复失败、备份、Agent、设置等真实 IPC UI。
9. 使用临时仓库覆盖 Git、恢复、并发、崩溃、敏感文件、Agent、GitHub、UI 和 Electron E2E。
10. 重新安装锁定依赖、构建 desktop/CLI、运行产物 smoke、真实桌面 E2E、演示和最终需求审计。

真实 GitHub 浏览器授权与 Claude Code 实机插件验证属于外部条件；它们不阻塞本地 P0，但必须在交付中明确说明。
