# VibeGit

![VibeGit logo](assets/branding/vibegit-project-logo.png)

VibeGit 是一个面向非程序员 Vibe Coder 的本地桌面版本保险箱。它把 Git 的底层能力包装成“项目、保存点、这次改了什么、暂时收起、回到这个版本、备份到 GitHub”，让 Codex、Claude Code 等 Agent 的每轮修改都可理解、可恢复。

当前仓库交付的是可运行的源码 MVP，不是安装包。P0 本地闭环、统一 Agent 事件 CLI、GitHub Provider 与真实 Electron UI 已实现；Codex/Claude Code 自动安装器属于 P1，当前只提供经过验证或明确标注限制的 Hook 模板。

## 安全模型

- 保存点写入 `refs/vibegit/checkpoints/*`，使用独立临时 index，不改变用户分支、HEAD 或真实暂存区。
- 禁止 `reset --hard`、`clean -fd`、force push、修改全局 Git 配置和删除 `.git`。
- 回退前创建可验证保险点；冲突的未跟踪/忽略文件先进入 Git 私有目录下的 `vibegit/recovery`；用户项目中的 `.vibegit` 会被当作普通项目数据。回退完成后可精确撤销，失败/中断后仍可从项目界面打开恢复区。
- 恢复令牌由 SQLite 原子认领；保存、恢复、撤销和暂时收起同时受进程内队列与跨进程项目租约保护，过期操作会调和为失败状态。
- GitHub 上传前扫描敏感路径、UTF-8/UTF-16 密钥模式、凭据、数据库、依赖/构建目录、LFS 指针和大文件；发现风险就阻断，不删除本地文件。
- 远程只接收扫描后的独立导出提交链，不上传本地保存点的历史父链；Private 可见性在同步前复核，实际 push 使用同一个已校验 URL。
- 选择已有 Git 项目时必须选择仓库根目录，避免跨目录保存或恢复；Agent 从其子目录运行时仍会自动归属到该项目。
- Renderer 无 Node/文件系统权限，只能通过受限 preload 调用主进程允许列表。

## 环境

- Node.js 24+
- pnpm 9+（项目锁定 `pnpm@11.7.0`）
- Git 2.23+
- GitHub CLI `gh`：仅私有备份需要；不安装也不影响本地保存点

## 安装与运行

```powershell
pnpm install
pnpm dev
```

构建并启动生产构建：

```powershell
pnpm build
pnpm exec electron .
```

也可以直接双击 `启动 VibeGit.bat`，它会启动 Electron 桌面版。首次使用时点击“选择项目文件夹”，即可通过 Windows 原生文件夹选择器定位项目，无需手输完整路径。VibeGit 会初始化 Git（若需要）并创建初始保存点，不会创建或切换普通分支。若选择的是已有 Git 项目的子目录，应用会提示重新选择项目根目录，以避免越过你选择的范围。

## Windows 安装包与桌面快捷方式

发布者在仓库根目录运行：

```powershell
pnpm install
pnpm dist:win
```

安装程序会生成在 `release/` 目录。将其中的 `VibeGit-Setup-<版本>-x64.exe` 上传到 GitHub Release 后，用户只需下载并运行该安装程序；安装完成时会自动创建 **VibeGit** 桌面快捷方式和开始菜单入口，二者都会使用 VibeGit 方形应用图标。卸载应用不会删除用户的 VibeGit 数据目录。

## Agent 事件 CLI

构建后可直接运行：

```powershell
Get-Content event.json | node dist/cli/index.js event --stdin
Get-Content hook.json | node dist/cli/index.js hook codex --stdin
Get-Content hook.json | node dist/cli/index.js hook claude-code --stdin
```

事件格式和 Hook 安装边界见 [Codex 集成](docs/CODEX_INTEGRATION.md) 与 [Claude Code 集成](docs/CLAUDE_CODE_INTEGRATION.md)。Hook 模板分别位于 `integrations/codex/vibegit` 和 `integrations/claude-code/vibegit`；模板不会擅自修改用户配置。

## GitHub 私有备份

安装 GitHub CLI 后，在项目页点击“GitHub 备份”中的“连接 GitHub 并创建 SSH 密钥”。VibeGit 会打开 GitHub 浏览器授权、在应用数据目录创建专用 Ed25519 密钥并仅上传公钥；随后即可一键创建 Private 仓库并安全备份。私钥不会写入项目目录、数据库或日志。

VibeGit 使用专用 `vibegit` remote，不改写你现有的 `origin`。新建备份仓库使用 `ssh.github.com:443`，适合常见的受限网络；每次同步先建立 `pre_sync` 保存点并重新扫描敏感文件，只有扫描通过才把该树导出到远程 `vibegit-backup` 分支并执行非强制 push。详见 [GitHub 设置](docs/GITHUB_SETUP.md)。

## 验证命令

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cli-build
pnpm test:cli-e2e
pnpm test:desktop
pnpm demo
```

Git 测试与演示只使用系统临时目录，不碰用户真实项目。`test:desktop` 启动构建后的真实 Electron 应用，验证无白屏、健康检查、保存、diff、回退和撤销。

## 目录

```text
apps/desktop              Electron Main / Preload / React Renderer
apps/cli                  统一 Agent 事件 CLI
packages/git-engine       安全 Git 命令边界
packages/checkpoint-engine 保存点、恢复区、撤销和暂时收起
packages/database         SQLite 元数据与事务
packages/github-provider  gh、敏感扫描和远程备份
packages/agent-events     Agent 事件适配与幂等
packages/core             桌面与 CLI 共用服务
packages/shared           类型、IPC 契约与结构化错误
integrations              Codex / Claude Code Hook 模板
tests                     单元、集成、UI 与 Electron E2E
docs                      产品、架构、安全与验收文档
```

## 当前外部限制

- GitHub 的 Private 参数、未登录/缺失状态、可见性复核、目标 URL 绑定、非强制本地远程 push 和敏感阻断均由自动化测试覆盖；发布前仍建议在安装了 GitHub CLI 的目标机器上完成一次真实授权与备份演练。
- 本机未安装 Claude Code，模板未执行 `claude plugin validate --strict`；JSON、事件映射和适配器已测试。
- Codex 插件模板已通过本地 validator，但自动安装器和面向普通用户的自包含 CLI 可执行文件仍是 P1。
- `node:sqlite` 在当前 Node/Electron 版本仍会输出 ExperimentalWarning；数据库层已隔离该 API，升级运行时时必须重跑全量测试。

更多信息见 [产品规格](docs/PRODUCT_SPEC.md)、[架构](docs/ARCHITECTURE.md)、[安全设计](docs/SECURITY.md) 与 [验收标准](docs/ACCEPTANCE_CRITERIA.md)。
