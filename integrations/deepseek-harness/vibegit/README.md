# VibeGit for DeepSeek Harness

通过本地 MCP 工具创建和查看 VibeGit 存档。需要本机 Node.js 24+、Git，以及已在 VibeGit 桌面端登记并开启保护的项目。

在 VibeGit 仓库运行 `pnpm build:plugins` 后，本适配器位于 `dist/plugins/deepseek-harness/vibegit`。生成的 `vibegit.cordis.yml` 使用真实绝对路径启动同目录的 `server/server.mjs`，因此移动后应使用 `scripts/install-agent.mjs` 重新生成配置。

启动方式：`dsh web --patch <vibegit.cordis.yml 的绝对路径>`。MCP 工具名由 Harness 加上 `mcp__vibegit__` 前缀。可直接说“用 VibeGit 给当前项目存档一次”。把 `skills/vibegit-save` 复制到 Harness 已配置的技能根目录后，还可使用 `/vibegit-save`。

四个工具为 `vibegit_status`、`vibegit_save`、`vibegit_list_checkpoints`、`vibegit_diff`，每个都要求绝对 `projectPath`。服务使用与桌面端相同的数据目录；自定义目录可通过 `VIBEGIT_DATA_DIR` 指定。

启动和握手不会自动存档。该适配器不提供 Hook、恢复、删除或 GitHub 推送能力。仅导入技能不会连接 MCP 服务。

完整安装和验收步骤见仓库 `docs/DEEPSEEK_HARNESS_INTEGRATION.md`。官方格式依据：[MCP 客户端](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)、[Cordis overlay](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/mcp-memory.md)。
