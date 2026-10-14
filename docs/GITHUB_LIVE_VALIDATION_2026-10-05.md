# GitHub 真实联测 — 2026-10-05

**结果：真实授权、私有仓库创建/连接、SSH 推送、远端内容与历史核验、失败恢复及桌面按钮操作均通过。** 本次使用源码提交 `95244e965be10fb74b9ba8938ebb28dedb82a4b5` 构建的 Electron 43.5.0，在隔离的应用数据目录和合成项目中执行；未覆盖安装用户现有程序，也未上传用户项目。

测试账户为仓库维护者 `lllleolin-max`。用户在 GitHub 官方设备授权页完成了已有 CLI 会话的权限更新，随后应用真实注册专用 SSH 公钥。没有替换 GitHub、SSH、IPC 或扫描器的执行结果。首次创建与推送经过真实 Electron preload/IPC；后续异常测试调用同一生产服务；最后重新启动桌面应用并实际点击“安全备份到 GitHub”。远端证据通过独立的 GitHub REST 读取验证。

## 实测结果

| 场景 | 实际结果 |
| --- | --- |
| 设备授权及专用密钥 | 用户完成真实授权；应用返回 `sshKeyCreated: true`、`sshKeyReady: true`、授权阶段 `complete`，一次性代码清除。再次授权复用密钥，返回 `sshKeyCreated: false`。 |
| 创建与连接 | 应用创建 Private 仓库；GitHub API 独立确认可见性。重新连接同一仓库的 HTTPS 地址后，规范化为应用专用 SSH 443 地址。 |
| 公开仓库拒绝 | 连接公开 VibeGit 仓库返回 `GITHUB_REPOSITORY_NOT_PRIVATE`；原备份目标和远端提交均不变。 |
| 第一次真实推送 | 仅建立 `refs/heads/vibegit-backup`；远端根提交无父提交，其树与扫描过的本地 `pre_sync` 树一致，提交本身不等于本地保存点。 |
| 文件内容 | 通过 GitHub blob API 读取 README、中文路径文件、二进制样本，并逐一比较 SHA-256；全部一致。后续 `.gitignore` 同样核验。 |
| 后续真实推送 | 新的远端提交仅以前一次安全备份为父提交；本地项目与对应保存点标记为 `synced`。 |
| 敏感内容阻断 | 将含明确无效合成值的 `.env` 保存进本地历史后，推送返回 `SENSITIVE_FILES_BLOCKED`；新增同步前保护点，远端 SHA 不变，项目标记失败且保留上次成功时间。 |
| 忽略与恢复 | 使用应用的忽略入口处理未跟踪 `.env` 后，扫描及推送成功；本地合成文件仍存在。逐提交检查远端全部可达历史，没有 `.env`、其 blob 或本地保存点提交。 |
| 真实远端拒绝与重试 | 临时归档测试仓库后，GitHub 拒绝写入，应用返回 `GIT_COMMAND_FAILED`；远端未变化，失败状态正确。取消归档后重试成功。 |
| 桌面界面闭环 | 点击真实“安全备份到 GitHub”按钮，成功时间推进，界面显示“本次备份已完成，已同步到 GitHub。”；远端新增提交的树和父提交均再次核验。 |
| 密钥撤销 | 删除本次测试公钥后，应用检测到 `sshKeyReady: false`；推送返回 `VIBEGIT_SSH_KEY_UNAVAILABLE`，没有新增保护点或改变远端。其他已登记公钥保持不变。 |
| 本地 Git 边界 | 在上述操作前后，原有 `origin`、HEAD 和真实 index 字节 SHA-256 均保持不变；未推送本地工作分支、标签或 `refs/vibegit/*`。 |

服务/远端验证脚本产出 25 项通过记录，另有真实桌面操作和撤销清理证据。本轮没有发现需要修改功能源码的问题。

## 可核对证据

- 私有测试仓库：[vibegit-live-acceptance-20261005-nbwgph](https://github.com/lllleolin-max/vibegit-live-acceptance-20261005-nbwgph)，GitHub repository ID `1404919671`。
- 首次远端提交：`bce975a331726ec9192635915a57f7e4ae7d548e`。
- 最终桌面推送提交：`8da3647cd4c69343fd206a6870c6b50209934bf8`，共 5 个安全备份提交；树为 `bc20622ac1bab137c9b793d43a1f1003695bb815`。
- 中文文件 SHA-256：`0604ec9ad54f12930663eb7bac446cebccc0a6d663a86e30510d349c71a9d459`。
- 二进制样本 SHA-256：`46d7c9e30f06774ee03af126b95c971f6fe6cc8b70ed27377bd4495b72b9b20a`。
- 同一源码提交的 [GitHub Actions 37241520732](https://github.com/lllleolin-max/VibeGit/actions/runs/37241520732)：Windows/Linux 均成功，Windows 桌面验收 3/3。
- 本地保留、未纳入 Git 的证据：`test-results/github-live/desktop-evidence.json`、`evidence.json`、`exercise.log.jsonl`、`ui-evidence.json`、`cleanup-evidence.json`，以及 `real-backup-ready.png`、`real-backup-success.png`。同目录保留本次执行脚本和隔离会话信息，常规 CI 不运行这些真实网络操作。

## 清理与验收边界

测试专用 SSH 公钥（ID `165379342`）已从 GitHub 撤销。测试仓库已再次归档并保持 Private，内容只有合成测试文件。现有 OAuth 授权不含 `delete_repo`，本次没有额外申请删除仓库权限；仓库作为验收证据留存。

删除两个本地临时测试目录的操作被工具自动审批检查拒绝，返回 `blocked by policy`，未提供具体原因。两个目录因此保留；其中的测试私钥已失去对应 GitHub 公钥授权。原有用户应用数据和项目未参与测试或清理，CLI 登录状态保留。

本次验证的是已有 CLI 账号的真实授权刷新，不扩大声称全新账号首次登录、密钥撤销后的再次浏览器修复、并发写入竞争、所有网络中断形式或应用内云端恢复都已实测。测试对象为小型合成项目；大规模未跟踪文件和实际用户覆盖升级的原有验证缺口仍保留。

按原工程自审量表，真实 GitHub 与远端 Windows/Linux CI 两项缺口现已闭合，补验评分为 **98/100**；原始本地验收的 96 分记录保留在[工程自审报告](ENGINEERING_AUDIT_2026-10-05.md)。
