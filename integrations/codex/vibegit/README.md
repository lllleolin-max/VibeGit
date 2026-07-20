# VibeGit Codex Hook Template

此模板把 Codex `UserPromptSubmit` 与 `Stop` 事件转交给已安装到 `PATH` 的 `vibegit` CLI。它只处理已在桌面应用中登记并开启保护的项目，其他目录快速跳过。

这是 P1 集成模板，不会随 MVP 自动安装。安装后必须在 Codex `/hooks` 中审核并信任命令。`Stop` 仅表示一轮响应结束，适配器不会把它伪装为任务成功。

