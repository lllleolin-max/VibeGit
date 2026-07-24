# VibeGit

<p align="center">
  <img src="assets/branding/vibegit-project-logo.png" alt="VibeGit" width="360" />
</p>

<p align="center">
  <strong>让每一次 AI 修改，都有迹可循、随时可回。</strong><br />
  给 Codex、Claude Code 与每一位 Vibe Coder 的本地版本保险箱。
</p>

<p align="center">
  <a href="#开始使用">开始使用</a> ·
  <a href="#它能做什么">核心能力</a> ·
  <a href="#安全不是一句口号">安全设计</a> ·
  <a href="#当前发布状态">发布状态</a>
</p>

**语言 / Languages：** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI 能把想法变成代码，也能在几分钟内改动数十个文件。真正让人不安的，往往不是“它能不能改”，而是：**这次到底改了什么？不满意时，能不能安全地回到之前？**

VibeGit 把 Git 的强大能力藏在更直白的操作背后：添加项目、保存版本、查看改动、暂时收起、回到旧版本、备份到 GitHub。你不需要先学会 commit、branch 或 reset，也能放心让 AI 继续推进项目。

> **Every AI change, saved and reversible.**

## 它能做什么

| 你关心的事 | VibeGit 的做法 |
| --- | --- |
| AI 改完后，我怎样确认结果？ | 用时间线记录每个保存点，查看文件清单、增删统计和逐行 Diff。 |
| 这版不对，能回去吗？ | 回退前先自动创建保险点，展示影响预览；完成后仍可撤销。 |
| 我还没写完，先放一边可以吗？ | 将当前修改安全“暂时收起”，需要时再准确取回。 |
| 不懂 Git 也能用吗？ | 可以。界面使用“项目”“保存点”“回到这个版本”等日常语言。 |
| 能备份到 GitHub 吗？ | 可以。连接后可备份到 Private 仓库，且不改动你已有的 `origin`。 |
| Codex / Claude Code 改的内容会记录吗？ | 统一 Agent 事件 CLI 可在任务前后创建保护点；已提供 Hook 模板。 |

## 为 Vibe Coding 而生

VibeGit 不是又一个 Git 图形客户端。它专注于一个更具体的问题：当你把实现工作交给 AI 时，如何始终保有对项目的理解与掌控。

- **看得懂**：用可读的保存点、任务说明和 Diff，替代一串难记的提交哈希。
- **回得去**：回退不是“赌一把”；先预览影响、自动留保险，并保留撤销能力。
- **不打扰**：本地保存与恢复不依赖网络、GitHub 或 Agent 是否已安装。
- **守得住**：每个项目独立保护；远程备份前扫描敏感信息，不替你删除本地文件。

## 开始使用

### 直接运行源码

准备好 Node.js 24+、pnpm 9+ 和 Git 2.23+ 后，在仓库根目录运行：

```powershell
pnpm install
pnpm dev
```

首次打开时，选择一个项目文件夹并点击“开启版本保护”。VibeGit 会在需要时初始化 Git、创建初始保存点；对于已有 Git 项目，它不会创建或切换普通分支。

也可以在 Windows 上双击 [`启动 VibeGit.bat`](启动%20VibeGit.bat) 启动桌面版。

### 构建 Windows 安装程序

```powershell
pnpm install
pnpm dist:win
```

安装程序会生成在 `release/` 中。发布者可将 `VibeGit-Setup-<version>-x64.exe` 上传至 GitHub Release；安装完成后会创建桌面与开始菜单入口，卸载不会删除用户的 VibeGit 数据。

## 安全不是一句口号

VibeGit 的默认立场是：**先保护，再操作。**

- 保存点写入独立的 `refs/vibegit/checkpoints/*`，不改动你的分支、`HEAD` 或真实暂存区。
- 不执行 `reset --hard`、`clean -fd`、强制推送、全局 Git 配置修改，也不删除 `.git`。
- 恢复前自动创建可验证的保险点；发生冲突的未跟踪或忽略文件会进入 Git 私有恢复区，而不是直接丢弃。
- GitHub 备份前扫描密钥、凭据、数据库、依赖/构建目录、LFS 指针与大文件；发现风险即阻止上传，原始文件留在本地。
- 桌面界面没有 Node.js 或文件系统权限，只能通过受限的主进程 API 执行允许的操作。

完整设计请参阅[安全设计](docs/SECURITY.md)与[架构说明](docs/ARCHITECTURE.md)。

## GitHub Private 备份

安装 [GitHub CLI](https://cli.github.com/) 后，在项目页打开“GitHub 备份”，点击“连接 GitHub 并创建 SSH 密钥”。VibeGit 会通过浏览器完成授权，在应用数据目录中创建专用 Ed25519 密钥，只将公钥注册到 GitHub。

备份使用专用的 `vibegit` remote，不会覆盖或改写现有 `origin`。详细步骤见 [GitHub 设置说明](docs/GITHUB_SETUP.md)。

## 当前发布状态

**v0.1.0 · 可运行源码 MVP**

已经实现并验证的核心闭环：本地版本保护、保存点与时间线、Diff、预览式恢复与撤销、暂时收起、GitHub Private 备份、Electron 桌面界面，以及统一的 Agent 事件 CLI。

Codex 与 Claude Code 的自动安装器仍在下一阶段；仓库已提供 Hook 模板，并清楚记录了验证范围与外部依赖。查看[最终验证记录](docs/FINAL_VALIDATION.md)了解已执行的测试和当前限制。

## 面向开发与贡献

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cli-build
pnpm test:cli-e2e
pnpm test:desktop
```

项目说明与验收边界：

- [产品规格](docs/PRODUCT_SPEC.md)
- [架构说明](docs/ARCHITECTURE.md)
- [安全设计](docs/SECURITY.md)
- [验收标准](docs/ACCEPTANCE_CRITERIA.md)
- [Codex 集成](docs/CODEX_INTEGRATION.md) · [Claude Code 集成](docs/CLAUDE_CODE_INTEGRATION.md)

---

**把大胆的想法交给 AI，把回头路交给 VibeGit。**
