# VibeGit MVP Tasks

- [x] 环境与空工作区审查（Node、pnpm、Git 可用；外部 CLI 状态已记录）
- [x] Product Design 上下文、UI 方向与视觉验收
- [x] Phase 1：Monorepo、Electron、CLI、SQLite、IPC
- [x] Phase 2：Git Engine 与临时仓库测试
- [x] Phase 3：Checkpoint Engine、时间线与 diff
- [x] Phase 4：安全恢复、恢复区、撤销与崩溃恢复
- [x] Phase 5：核心 UI 与真实临时项目闭环
- [x] Phase 6：Agent Events CLI 与 Codex/Claude 集成模板
- [x] Phase 7：GitHub Provider、私有远程与敏感文件保护
- [x] Phase 8：Codex / Claude Code Adapter 文档与模板
- [x] Phase 9：Lint、类型、单元测试、构建、CLI/Electron E2E、演示验收

- [!] 外部验收：需在安装了 GitHub CLI 的目标机器上完成一次应用内浏览器授权、专用 SSH 密钥创建、Private 仓库创建与备份演练。
- [!] 外部验收：当前环境未安装 Claude Code，尚未进行真实 Claude Hook 安装与调用测试。
- [-] P1：在具备可执行 Codex 应用 CLI 的环境中完成插件实际安装、首次启动与 Hook 注册验证；当前 shell 对应用二进制返回“Access denied”。

标记说明：`[ ]` 未开始，`[-]` 进行中，`[x]` 已完成并验证，`[!]` 受外部条件阻塞。
