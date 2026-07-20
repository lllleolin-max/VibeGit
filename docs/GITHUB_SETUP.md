# GitHub Private Backup Setup

## 用户操作

1. 安装 [GitHub CLI](https://cli.github.com/)。
2. 在终端运行：

   ```powershell
   gh auth login
   ```

3. 在浏览器完成本人 GitHub 授权。
4. 在 VibeGit 的“GitHub 备份”中选择“创建新的私有仓库”，或输入已有 GitHub Private 仓库地址。
5. 先处理风险扫描：可让应用加入根锚定 `.gitignore` 规则，或自行移除/取消跟踪敏感内容；重新扫描通过后再备份。

## VibeGit 的行为

- 仅使用 `github.com`，创建时显式传递 `gh repo create --private`，连接和每次同步前都检查可见性是 `PRIVATE`。
- 不修改用户原本的 `origin`。VibeGit 使用专用名为 `vibegit` 的 remote。
- 每次同步先建立 `pre_sync` 保护点、扫描该树，再把扫描后的树导出到远程 `vibegit-backup` 分支。
- 不 force push；若远程历史不是 fast-forward，操作失败并保留本地状态。
- 远程提交不引用本地保存点父链，已从当前树移除的旧秘密不会因历史链被上传。
- 如果 Git 配置会将 URL 用 `insteadOf` / `pushInsteadOf` 重写到其他地址，VibeGit 会拒绝同步；请删除适用重写后再试。

## 故障说明

- 未安装 `gh` 或尚未登录时，仅 GitHub 备份不可用；本地保存、回退和 Agent 事件不受影响。
- 如果 `.gitignore` 后仍提示某文件，通常说明它已被真实 Git index 暂存/跟踪。请先取消跟踪该文件并确认不再含敏感内容，再重新扫描。
- 当前开发机未完成真实 GitHub 授权，因此最终验证只使用本地 bare remote 与 gh mock；不会伪造远程仓库或浏览器授权结果。
