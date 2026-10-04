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
- 临时 index 从真实索引文件的已打开句柄复制，保留 stat 缓存及保守时间戳；所有索引写入只作用于副本。副本展开 split-index 并清除隐藏修改的标志，再用工作区更新，故已暂存但后来被忽略的文件不会被悄悄遗漏。同时间戳修改仍由 Git 的 racy-index 检查识别。
- `projects.active_checkpoint_id` 表示用户当前版本；内部 `pre_restore`、`pre_sync` 和 shelf 保存不改变它。
- 危险写入同时受单服务队列、SQLite 租约、owner PID/过期调和和每步 ownership 校验保护。
- 恢复记录、恢复清单和恢复区路径在移动任何文件前持久化；启动时会调和死亡或过期 owner 的执行记录。
- 删除项目/保存点也使用项目队列和租约；事务内复核租约后删除元数据，再尽力清理对应私有 ref。数据库失败保留全部 ref，仓库不可访问时允许遗留不可见 ref，避免损失仍有效的保存点。
- 恢复或撤销完成状态与活动保存点在同一 SQLite 事务内更新。

## Electron 边界

Main 进程使用单实例锁、`contextIsolation`、sandbox、关闭 `nodeIntegration`、CSP、精确本地入口 URL、主窗口/主 frame/WebContents 三重 IPC 校验。生产构建忽略注入的 `ELECTRON_RENDERER_URL`。

桌面 IPC 与浏览器预览共用 `api-validation.ts` 进行运行时参数校验，只允许公开操作并剥离内部字段。更换服务实例时，已有 IPC 保持对原实例的引用，原数据库在该实例的在途请求结束后关闭，新请求使用新实例。

## 工程检查

`pnpm check` 依次执行 lint、构建（含 TypeScript）、完整单元/集成回归和 CLI 验收；构建后运行 `pnpm test:desktop` 验证 Electron 流程。`.github/workflows/quality.yml` 配置 Windows/Linux 的固定锁文件安装、依赖审计和工程检查，并在 Windows 执行桌面验收。CI 配置不代表远端已经运行成功，具体证据记录在对应日期的工程审查报告中。
