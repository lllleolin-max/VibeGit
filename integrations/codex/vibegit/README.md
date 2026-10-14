# VibeGit for Codex

在本机 Codex 对话中选择 `@VibeGit`，然后说“给当前项目存档一次”。插件调用本地 MCP 服务，使用 VibeGit 桌面端同一份项目登记和存档数据。

要求 Node.js 24+、Git，以及已经在 VibeGit 桌面端添加并开启保护的项目。桌面窗口不必保持打开；在聊天中传递的项目路径应当是本机真实工作区路径。

源码目录不包含编译后的服务。先在仓库根运行 `pnpm build:plugins`，再按仓库 `docs/CODEX_INTEGRATION.md` 安装生成的完整插件。不要直接安装此源码模板。

提供 `vibegit_save`、`vibegit_status`、`vibegit_list_checkpoints`、`vibegit_diff`。保存保留当前分支和暂存区，不自动推送 GitHub。没有新变化时返回已有存档及 `created:false`。

此前的自动 Hook 模板保留在 `examples/optional-hooks.json`，本插件默认不加载。若另行配置自动保护，仍需 CLI 可执行入口和 Codex Hook 信任；它和手动存档是独立功能。
