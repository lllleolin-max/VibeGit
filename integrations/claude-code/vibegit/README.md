# VibeGit Claude Code Hook Template

For the beginner-friendly “feature changes” view, use the repository skill at `skills/vibegit-change-summary/SKILL.md`. It records a structured summary through `vibegit summary --stdin` before the Stop hook creates its checkpoint, without adding any file to the user project.

此模板使用无 shell 的参数数组调用 `vibegit hook claude-code --stdin`。Windows 下 `vibegit` 必须最终打包成真实 `.exe`；npm 生成的 `.cmd` 不能被 Claude Code exec form 直接启动。

本机当前未安装 Claude Code，因此模板只经过 JSON 与适配器测试，未执行 `claude plugin validate --strict`，不能标记为已实机安装。
