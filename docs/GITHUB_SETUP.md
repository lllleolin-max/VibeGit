# GitHub Private Backup Setup

## 用户操作

1. 安装 [GitHub CLI](https://cli.github.com/)。
2. 在 VibeGit 项目页打开“GitHub 备份”，点击“连接 GitHub 并创建 SSH 密钥”。
3. 应用会打开 GitHub 浏览器授权页；完成授权后，它会在 VibeGit 应用数据目录创建专用 Ed25519 密钥，并将**公钥**注册到当前 GitHub 账户。
4. 点击“创建并连接”创建新的 Private 仓库，或输入已有 GitHub Private 仓库地址。新建仓库默认通过 `ssh.github.com:443` 备份，不改写你的 `origin`。
5. 先处理风险扫描：可让应用加入根锚定 `.gitignore` 规则，或自行移除/取消跟踪敏感内容；重新扫描通过后再备份。

## VibeGit 的行为

- 仅使用 `github.com`，创建时显式传递 `gh repo create --private`，连接和每次同步前都检查可见性是 `PRIVATE`。
- 专用私钥只保存在 VibeGit 应用数据目录：Unix 权限为仅当前用户；Windows 使用专用 ACL。私钥不经过 Renderer、IPC 返回值、数据库或日志。应用只保存公钥的 SHA-256 标识和账户绑定信息。
- GitHub 授权由 GitHub CLI 的浏览器流程完成；应用请求创建 Private 仓库和注册 SSH 公钥所需的权限。VibeGit 不自动安装 CLI，也不自动化 GitHub 登录网页。
- 不修改用户原本的 `origin`。VibeGit 使用专用名为 `vibegit` 的 remote。
- 每次同步先建立 `pre_sync` 保护点、扫描该树，再把扫描后的树导出到远程 `vibegit-backup` 分支。
- 不 force push；若远程历史不是 fast-forward，操作失败并保留本地状态。
- 远程提交不引用本地保存点父链，已从当前树移除的旧秘密不会因历史链被上传。
- 如果 Git 配置会将 URL 用 `insteadOf` / `pushInsteadOf` 重写到其他地址，VibeGit 会拒绝同步；请删除适用重写后再试。

## 故障说明

- 未安装 `gh` 时，仅 GitHub 备份不可用；本地保存、回退和 Agent 事件不受影响。安装后无需在终端输入登录命令，直接点击应用中的连接按钮即可。
- 如果 `.gitignore` 后仍提示某文件，通常说明它已被真实 Git index 暂存/跟踪。请先取消跟踪该文件并确认不再含敏感内容，再重新扫描。
- 自动化测试使用本地 bare remote 与 `gh` mock 覆盖成功和失败分支；发布前请在安装 GitHub CLI 的目标机器上完成一次应用内浏览器授权与 Private 备份演练。
