# VibeGit for WorkBuddy

通过本地 MCP 工具创建和查看 VibeGit 存档。需要本机 Node.js 24+、Git，以及已在 VibeGit 桌面端登记并开启保护的项目。

在 VibeGit 仓库运行 `pnpm build:plugins` 后，本适配器位于 `dist/plugins/workbuddy/vibegit`。生成的 `mcp.json` 使用真实绝对路径启动同目录的 `server/server.mjs`；移动后应使用 `scripts/install-agent.mjs` 重新生成配置。

在 WorkBuddy 的“插件 → MCP 服务器 → 配置 MCP”中合并生成配置的 `mcpServers.vibegit` 条目，保留已有服务。可将 `skills/vibegit-save` 作为本地技能包导入，再说“用 VibeGit 给当前项目存档一次”。仅导入技能不会连接 MCP 服务。

四个工具为 `vibegit_status`、`vibegit_save`、`vibegit_list_checkpoints`、`vibegit_diff`，每个都要求绝对 `projectPath`。服务使用与桌面端相同的数据目录；自定义目录可通过 `VIBEGIT_DATA_DIR` 指定。

本适配器面向能够访问项目文件的本机执行环境，云端会话不会因此获得本机文件。启动插件不会自动存档；不提供 Hook、恢复、删除或 GitHub 推送能力。

完整安装和验收步骤见仓库 `docs/WORKBUDDY_INTEGRATION.md`。官方格式依据：[MCP](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)、[技能导入](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)。
