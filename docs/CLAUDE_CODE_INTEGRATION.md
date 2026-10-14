# Claude Code Integration

VibeGit 插件通过本地 stdio MCP 提供主动存档、状态、历史和差异查询。插件技能入口为 `/vibegit:save`，也可以自然语言调用。项目必须先在 VibeGit 桌面端登记并开启保护；插件不会隐式登记项目。

## 构建与安装

需要 Node.js 24+、Git 和 Claude Code。先在 VibeGit 仓库执行：

```powershell
pnpm build:plugins
node scripts/install-agent.mjs claude-code --destination "$env:LOCALAPPDATA\VibeGit\plugins\claude-code-0.2.0"
```

安装器将独立服务和技能放入指定的新目录，不修改 Claude 的用户配置。目标存在时会拒绝覆盖；升级时选择新目录并切换入口。随后在你要存档的项目目录运行：

```powershell
claude plugin validate "$env:LOCALAPPDATA\VibeGit\plugins\claude-code-0.2.0" --strict
claude --plugin-dir "$env:LOCALAPPDATA\VibeGit\plugins\claude-code-0.2.0"
```

`--plugin-dir` 是官方本地加载方式。发布到 marketplace 是单独的分发流程，本次安装不把插件上传到公开市场。插件根目录的 `.mcp.json` 指向 `${CLAUDE_PLUGIN_ROOT}/server/server.mjs`；必须使用 Node.js 24+，不使用 Electron 内置 Node 启动该服务。

## 使用与验收

```text
/vibegit:save 登录功能完成
用 VibeGit 列出当前项目最近 5 次存档。
比较刚才的存档和上一份存档。
```

技能先识别真实工作区并查询状态，再调用 `vibegit_save`。检查实际工具结果中的项目、存档 ID 和时间，并在桌面端重新打开该项目查看同一记录。没有内容变化时应明确显示复用或跳过，而不是宣称新增存档。

MCP 工具均要求绝对 `projectPath`。插件安装目录和 MCP 进程的 `cwd` 不是当前项目；多工作区有歧义时由用户指定。默认使用桌面端的数据目录；若使用独立数据目录，启动 Claude 前为其设置相同的 `VIBEGIT_DATA_DIR`。本次工具范围不包含恢复、删除和 GitHub 推送。

## 自动 Hook 的兼容说明

旧模板移到 `integrations/claude-code/vibegit/examples/optional-hooks.json`，不再位于会被自动加载的 `hooks/hooks.json`。安装主动存档插件不会额外触发每轮自动存档。

原映射仍是 `UserPromptSubmit → task-start`、`Stop → task-end`、`StopFailure → task-end(success=false)`。要自行启用旧模板，先提供真实可执行的 `vibegit hook claude-code --stdin` 并按当前 Claude Hook 文档配置。Windows 的 exec form 不能把 npm `.cmd` 当成 `.exe`。MCP 服务包不包含这套旧 CLI 的安装。

## 验证范围

2026-10-15 使用官方 npm 包中的 Claude Code 2.1.300 执行以下命令，结果为 `Validation passed`，退出码 0：

```powershell
npm exec --yes --package @anthropic-ai/claude-code -- claude plugin validate dist/plugins/claude-code/vibegit --strict
```

验证器仅提示 README 未列出 marketplace 安装命令；这属于不影响结论的建议，本插件当前通过本地目录分发。该次验证未全局安装 Claude，也未进行登录后的真实对话。

共享 MCP 的构建、协议和存档联测由 `pnpm test:plugins` 验证。官方清单验证和真实会话调用是不同的检查，不能把共享 MCP 测试当作已完成 Claude 会话验收。

官方依据（核对日期：2026-10-15）：[插件清单与 MCP 目录约定](https://code.claude.com/docs/en/plugins-reference)、[技能命令命名](https://code.claude.com/docs/en/skills)、[Hook 事件](https://code.claude.com/docs/en/hooks)。
