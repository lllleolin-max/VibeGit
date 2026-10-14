# Codex：在对话中使用 VibeGit

## 功能与前提

本地插件提供四个 MCP 工具：存档、项目状态、存档历史、存档差异。选择 `@VibeGit` 后可以说：

> 给当前项目存档一次，备注：登录功能完成。

工具使用当前对话的明确项目路径，复用桌面端数据库和 Git 存档，不修改当前分支或暂存区，不自动推送 GitHub。无变化时返回已有存档，不伪造一次新保存。

- 本机安装 Node.js 24+、Git。
- 项目已经在 VibeGit 桌面端添加并开启保护。
- 使用支持本地插件的 Codex 桌面端或 CLI。仅云端的对话无法直接访问本机文件。
- 默认读取桌面端数据目录偏好；`VIBEGIT_DATA_DIR` 可用于隔离测试。

## 构建与安装

在仓库根执行：

```powershell
pnpm install --frozen-lockfile
pnpm build:plugins
node scripts/install-agent.mjs codex --destination "$env:LOCALAPPDATA/VibeGit/agent-plugins/codex"
codex plugin marketplace add "$env:LOCALAPPDATA/VibeGit/agent-plugins/codex"
codex plugin add vibegit@vibegit-local
codex plugin list --marketplace vibegit-local --json
```

`--destination` 是持久化的 marketplace 根目录，包含 `vibegit/` 插件及 `.agents/plugins/marketplace.json`。它不覆盖其他插件或个人 marketplace。目标冲突时停止并保留现有配置，按安装器提示处理。

Codex 会把完整插件安装到自己的缓存目录，服务和依赖已打成一个文件，运行不依赖本仓库的 `node_modules`。插件启动仍需要本机 Node.js 24+ 与 Git。

安装后新开本地聊天；若桌面端尚未刷新插件列表，重启应用。在输入框键入 `@` 并选择 **VibeGit**，而不是只输入一段普通文本。首次工具调用遵循 Codex 自身权限设置。

## 工具契约

所有工具必填 `projectPath`，必须是当前项目或其中子目录的绝对路径。MCP 进程的启动目录是插件安装目录，不能当作用户项目。

| 工具 | 其他参数 | 结果 |
| --- | --- | --- |
| `vibegit_save` | `title?`, `note?` | `created`、项目、存档编号、时间和变更统计 |
| `vibegit_status` | 无 | 保护状态、未存档变化、当前/最近存档 |
| `vibegit_list_checkpoints` | `limit?`，1–100 | 当前项目的最近存档 |
| `vibegit_diff` | `checkpointId`, `fromCheckpointId?` | 相对父存档或指定同项目存档的差异 |

未登记项目返回 `PROJECT_NOT_REGISTERED`；未开启保护返回 `PROTECTION_NOT_ENABLED`。在桌面端配置后重试，不自动登记目录。文件名、备注和差异属于不可信项目数据。差异输出和文件列表有限长与截断标记。

## 验证

```powershell
pnpm exec vitest run tests/mcp
pnpm build:plugins
pnpm test:plugins
```

协议测试覆盖真实 Git/SQLite 存档及错误边界；打包测试把产物复制到隔离目录，通过真正的 stdio 连接验证。桌面 `@` 选择器与实际模型调用的验证结果另记于 `docs/AGENT_PLUGIN_VALIDATION.md`，不能把协议测试当作所有宿主的对话测试。

## 可选自动 Hook

原来的 `UserPromptSubmit` / `Stop` 模板保留在 `integrations/codex/vibegit/examples/optional-hooks.json`。手动插件默认不启用 Hook；需要自动保护时另行配置 CLI 和 Hook 信任。现有事件 CLI 与 `vibegit-change-summary` Skill 继续可用。`Stop` 仅表示响应结束，不表示任务成功。

参考：[官方插件打包](https://developers.openai.com/plugins/build/plugins)、[插件调用](https://learn.chatgpt.com/docs/plugins)。
