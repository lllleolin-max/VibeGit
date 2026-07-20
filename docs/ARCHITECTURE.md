# Architecture

```text
React Renderer
  └─ typed preload allow-list
       └─ Electron Main / IPC validation
            └─ VibeGitService (shared application layer)
                 ├─ CheckpointEngine ─ GitEngine ─ system git
                 ├─ AgentEventService ─ unified CLI / Hook adapters
                 ├─ GitHubProvider ─ gh CLI / sensitive scanner
                 └─ VibeGitDatabase ─ local SQLite
```

## 包与职责

- `apps/desktop`：Electron Main、受限 preload 和 React UI；Renderer 不拥有 Node、文件系统或 Git 权限。
- `apps/cli`：统一 `event` / `hook` 入口；Codex、Claude Code 适配器只向它传 JSON stdin。
- `packages/core`：桌面与 CLI 共用的项目、恢复、Agent、GitHub 应用服务。
- `packages/git-engine`：唯一 Git 命令边界；参数数组、超时、输出上限、结构化错误、环境隔离与命令安全策略。
- `packages/checkpoint-engine`：hidden-ref 保存点、Diff、恢复影响预览、保险点、恢复区、撤销、暂时收起与项目级操作租约。
- `packages/database`：本机 SQLite 元数据、原子恢复状态转换、活动保存点、Agent 幂等和跨进程操作租约。
- `packages/agent-events`：task-start/task-end 的路径归属、任务文本脱敏、保存点关联与去重。
- `packages/github-provider`：`gh` 状态/Private 验证、专用 remote、敏感扫描和安全导出推送。
- `packages/shared`：领域模型、IPC 契约、公共错误与脱敏工具。

## 数据与安全边界

- 源码保留在用户项目、Git 对象库和用户明确选择的 GitHub 私有仓库中；SQLite 仅保存元数据。
- 保存点写入 `refs/vibegit/checkpoints/<id>`，以临时 index 构造树，不切分支、不改 HEAD、不改用户真实 index。
- 真实 index 树是临时 index 的起点，之后用工作区更新，故已暂存但后来被忽略的文件不会被悄悄遗漏。
- `projects.active_checkpoint_id` 表示用户当前版本；内部 `pre_restore`、`pre_sync` 和 shelf 保存不改变它。
- 危险写入同时受单服务队列、SQLite 租约、owner PID/过期调和和每步 ownership 校验保护。
- 恢复记录、恢复清单和恢复区路径在移动任何文件前持久化；启动时会调和死亡或过期 owner 的执行记录。

## Electron 边界

Main 进程使用单实例锁、`contextIsolation`、sandbox、关闭 `nodeIntegration`、CSP、精确本地入口 URL、主窗口/主 frame/WebContents 三重 IPC 校验。生产构建忽略注入的 `ELECTRON_RENDERER_URL`。
