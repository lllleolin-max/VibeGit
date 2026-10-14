# VibeGit for Claude Code

通过 `/vibegit:save 登录功能完成` 创建本地存档，也可用自然语言查看存档和差异。需要本机 Node.js 24+、Git，以及已在 VibeGit 桌面端登记并开启保护的项目。

这是插件源目录。先在 VibeGit 仓库运行 `pnpm build:plugins`，使用生成的 `dist/plugins/claude-code/vibegit`；该目录包含独立的 `server/server.mjs`，无需在插件目录安装 npm 依赖。

在目标项目中启动 Claude Code，给 `--plugin-dir` 传生成插件的绝对路径。`.mcp.json` 使用 `${CLAUDE_PLUGIN_ROOT}` 寻找服务，项目路径由当前会话提供，不能把插件目录当成项目。

工具：`vibegit_status`、`vibegit_save`、`vibegit_list_checkpoints`、`vibegit_diff`。每次调用都需要绝对 `projectPath`。服务使用与桌面端相同的数据目录；自定义目录可通过 `VIBEGIT_DATA_DIR` 指定。

存档不会推送 GitHub、恢复文件或创建普通 Git 提交。启动插件不会自动存档。原自动 Hook 模板保留在 `examples/optional-hooks.json`，未自动启用；它额外要求可执行的 `vibegit hook claude-code --stdin`，不随 MCP 包启用。

完整安装和验收步骤见仓库 `docs/CLAUDE_CODE_INTEGRATION.md`。官方格式依据：[插件清单](https://code.claude.com/docs/en/plugins-reference)、[技能](https://code.claude.com/docs/en/skills)。
