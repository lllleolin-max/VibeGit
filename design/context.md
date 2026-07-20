# VibeGit Design Context

goal: 让不懂 Git 的 Vibe Coder 在每轮 AI 修改前后都拥有可理解、可验证、可恢复、可备份的项目保存点。
user: 使用 Codex / Claude Code 的非程序员桌面用户；对 Git 术语陌生，对代码丢失高度敏感。
JTBD: 添加项目后开启版本保护，放心让 Agent 修改，能够看懂改动，并在几次点击内安全回到旧版本。
constraints: Windows 与 macOS；Electron + React + TypeScript；系统 Git；本地 SQLite；Renderer 无文件系统权限；危险操作必须可恢复；不依赖云端存储源码。
success: P0 六个验收场景可在真实临时仓库完成；所有恢复都有可读保险点；无 force push / hard reset / clean；核心 UI 不要求理解 Git 术语。
scope v1: [项目添加与初始化, hidden-ref 保存点, 自然语言时间线, diff, 安全恢复与撤销, Agent 事件 CLI, GitHub 私有备份, 敏感文件阻断]
non-goals: [团队协作, PR/Issue/CI 管理, GitLab/Gitee/Bitbucket, 云端编辑器, 移动端, 自动解决复杂冲突]
assumptions: [用户机器已安装 Git, GitHub 远程功能允许依赖 gh, 首版主要管理单人本地项目]
risks: [恢复过程遇到路径/权限/符号链接边界, Agent Hook 格式随版本变化, GitHub 授权必须由用户完成]

