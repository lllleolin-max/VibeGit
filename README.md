# VibeGit

<p align="center">
  <img src="assets/branding/vibegit-project-logo.png" alt="VibeGit" width="360" />
</p>

<p align="center">
  <strong>让每一次 AI 修改，都有迹可循、随时可回。</strong><br />
  给 Codex、Claude Code 与每一位 Vibe Coder 的本地版本保险箱。
</p>

<p align="center">
  <a href="https://github.com/lllleolin-max/VibeGit/releases/latest"><img src="https://img.shields.io/github/v/release/lllleolin-max/VibeGit?label=最新版本" alt="最新版本" /></a>
  <img src="https://img.shields.io/badge/平台-Windows%20x64-0078D4" alt="Windows x64" />
  <a href="https://github.com/lllleolin-max/VibeGit/stargazers"><img src="https://img.shields.io/github/stars/lllleolin-max/VibeGit?style=flat&label=Stars" alt="GitHub Stars" /></a>
</p>

<p align="center">
  <a href="#开始使用">开始使用</a> ·
  <a href="#它能做什么">核心能力</a> ·
  <a href="#一键同步到-github-私有保险库">GitHub 私有备份</a> ·
  <a href="#安全不是一句口号">安全设计</a> ·
  <a href="#当前发布状态">发布状态</a>
</p>

**语言 / Languages：** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI 不只会写代码，也会执行操作：清空文件、覆盖当前成果、回退到错误版本，甚至把一个已经跑通的项目变回几个小时前的状态。真正让人害怕的，不是改错一行代码，而是一次操作之后，整个项目突然“不见了”。

**语言 / Languages：** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI 不只会写代码，也会执行操作：清空文件、覆盖当前成果、回退到错误版本，甚至把一个已经跑通的项目变回几个小时前的状态。真正让人害怕的，不是改错一行代码，而是一次操作之后，整个项目突然“不见了”。

VibeGit 就像项目的本地版本保险箱。把重要阶段保存下来后，即使 AI 误清空、误覆盖或误回退了当前项目，你仍然能看清发生了什么，并安全找回那个确认过的版本。

VibeGit 把 Git 的强大能力藏在更直白的操作背后：添加项目、保存版本、查看改动、暂时收起、回到旧版本、备份到 GitHub。你不需要先学会 commit、branch 或 reset，也能放心让 AI 继续推进项目。

> **Every AI change, saved and reversible.**
>
> VibeGit 能恢复已经保存的版本。请先开启版本保护并创建保存点；尚未保存的改动无法保证恢复。

## 一个常见的夜晚

晚上十点，你终于把项目跑通了。你让 AI “帮我整理一下并回到稳定版本”，它却误操作：清掉了当前文件，或者回退到了一个很早以前的版本。

眼前的项目突然变得陌生：刚完成的页面没了，修好的问题又出现了，甚至连从哪里恢复都不知道。

这时，VibeGit 保存的不是一段模糊的记忆，而是你确认过的项目版本。它像保险箱一样把重要保存点留在本地：查看变化、确认影响，然后把项目安全带回你想要的那个版本。

## 一个常见的夜晚

| 你关心的事 | VibeGit 的做法 |
| --- | --- |
| AI 把项目清空、覆盖或回退错了怎么办？ | 重要版本保存在独立的保存点中；查看发生过的变化后，可安全恢复到确认过的版本。 |
| 电脑坏了、换机或本地项目被清空怎么办？ | 连接一次 GitHub 后，可一键同步到专属 Private 仓库；本地与云端都保留可恢复的版本，且不改动现有 `origin`。 |
| 这版不对，能回去吗？ | 回退前先自动创建保险点，展示影响预览；完成后仍可撤销。 |
| 我还没写完，先放一边可以吗？ | 将当前修改安全“暂时收起”，需要时再准确取回。 |
| 不懂 Git 也能用吗？ | 可以。界面使用“项目”“保存点”“回到这个版本”等日常语言。 |
| Codex / Claude Code 改的内容会记录吗？ | 统一 Agent 事件 CLI 可在任务前后创建保护点；已提供 Hook 模板。 |

本地保存点让你能从 AI 的误清空、误覆盖或误回退中找回项目；GitHub 私有备份，则让这些重要版本不只留在一台电脑里。

连接一次 GitHub 后，在每个值得保留的阶段点击同步，即可把当前版本备份到专属的 Private 仓库。电脑损坏、换机，或者本地项目目录意外被清空时，你依然拥有一份独立的云端保险。

VibeGit 使用专用的 `vibegit` remote，不会覆盖、替换或改写你已有的 `origin`。你的日常开发仓库保持原样，VibeGit 只负责为重要版本增加一层私有备份。

安装 [GitHub CLI](https://cli.github.com/) 后，在项目页打开“GitHub 备份”，点击“连接 GitHub 并创建 SSH 密钥”。VibeGit 会通过浏览器完成授权，并在应用数据目录中创建专用 Ed25519 密钥，只将公钥注册到 GitHub。

详细步骤见 [GitHub 设置说明](docs/GITHUB_SETUP.md)。

## 一键同步到 GitHub 私有保险库

本地保存点让你能从 AI 的误清空、误覆盖或误回退中找回项目；GitHub 私有备份，则让这些重要版本不只留在一台电脑里。

连接一次 GitHub 后，在每个值得保留的阶段点击同步，即可把当前版本备份到专属的 Private 仓库。电脑损坏、换机，或者本地项目目录意外被清空时，你依然拥有一份独立的云端保险。

VibeGit 使用专用的 `vibegit` remote，不会覆盖、替换或改写你已有的 `origin`。你的日常开发仓库保持原样，VibeGit 只负责为重要版本增加一层私有备份。

安装 [GitHub CLI](https://cli.github.com/) 后，在项目页打开“GitHub 备份”，点击“连接 GitHub 并创建 SSH 密钥”。VibeGit 会通过浏览器完成授权，并在应用数据目录中创建专用 Ed25519 密钥，只将公钥注册到 GitHub。

详细步骤见 [GitHub 设置说明](docs/GITHUB_SETUP.md)。

## 开始使用

### 使用 Codex 或 Claude Code 一键部署

在仓库文件夹中，将下面这条指令复制并粘贴给 Codex 或 Claude Code：

```text
请在当前工作区一键部署 VibeGit：检查 Node.js 24+、pnpm 9+ 和 Git 2.23+，如已满足则执行 pnpm install，然后运行 pnpm dev；如果缺少依赖，请先说明并安装。完成后告诉我启动结果和下一步操作。
```

### 构建 Windows 安装程序

```powershell
pnpm install
pnpm dist:win
```

安装程序会生成在 `release/` 中。用户也可以直接[下载最新 Windows 安装包](https://github.com/lllleolin-max/VibeGit/releases/latest)，发布者可将 `VibeGit-Setup-<version>-x64.exe` 上传至 GitHub Release；安装完成后会创建桌面与开始菜单入口，卸载不会删除用户的 VibeGit 数据。

### 重要：安装包用户还需要部署 VibeGit Skill

> **安装包不会自动安装仓库中的 Skill。** 如果你通过 Windows 安装包使用 VibeGit，请额外部署 `vibegit-change-summary`；它会让 Codex 或 Claude Code 在任务完成后记录易读的改动摘要，供 VibeGit 的下一次保存点显示。

将下面指令复制给 Codex 或 Claude Code。它会只为已安装的 Agent 部署 Skill，并保留你已有的其他 Skills：

```text
请为我部署 VibeGit Skill。VibeGit 已通过 Windows 安装包安装。请从 https://github.com/lllleolin-max/VibeGit 获取仓库中的 skills/vibegit-change-summary/，先检查其中的 SKILL.md，再复制（不要移动或删除源文件）到已安装 Agent 的全局 Skills 目录：Codex 使用 %USERPROFILE%\.codex\skills\vibegit-change-summary\SKILL.md，Claude Code 使用 %USERPROFILE%\.claude\skills\vibegit-change-summary\SKILL.md。仅配置本机已安装的 Agent；如目录不存在请创建，不要覆盖或删除任何其他 Skill。完成后验证两个目标目录中的 SKILL.md 均包含 YAML frontmatter，并告诉我部署结果及是否需要重启 Agent。
```

### 1. 使用 Codex 或 Claude Code 自动部署

在仓库文件夹中，将下面这条指令复制并粘贴给 Codex 或 Claude Code：

```text
请在当前工作区一键部署 VibeGit：检查 Node.js 24+、pnpm 9+ 和 Git 2.23+，如已满足则执行 pnpm install，然后运行 pnpm dev；如果缺少依赖，请先说明并安装。完成后告诉我启动结果和下一步操作。
```

> 这条指令会从源码启动 VibeGit，适合已经下载或克隆仓库的用户。

### 2. 下载 Windows 安装包，并部署 VibeGit Skill

[**下载最新 Windows x64 安装包**](https://github.com/lllleolin-max/VibeGit/releases/latest)

安装包无需 Node.js 或 pnpm，安装后可从开始菜单启动；卸载不会删除用户的 VibeGit 数据。

> **安装包不会自动安装仓库中的 Skill。** 如果你通过 Windows 安装包使用 VibeGit，请额外部署 `vibegit-change-summary`；它会让 Codex 或 Claude Code 在任务完成后记录易读的改动摘要，供 VibeGit 的下一次保存点显示。

<details>
<summary><strong>复制给 Codex 或 Claude Code：自动部署 VibeGit Skill</strong></summary>

它只会为本机已安装的 Agent 部署 Skill，并保留已有的其他 Skills：

```text
请为我部署 VibeGit Skill。VibeGit 已通过 Windows 安装包安装。请从 https://github.com/lllleolin-max/VibeGit 获取仓库中的 skills/vibegit-change-summary/，先检查其中的 SKILL.md，再复制（不要移动或删除源文件）到已安装 Agent 的全局 Skills 目录：Codex 使用 %USERPROFILE%\.codex\skills\vibegit-change-summary\SKILL.md，Claude Code 使用 %USERPROFILE%\.claude\skills\vibegit-change-summary\SKILL.md。仅配置本机已安装的 Agent；如目录不存在请创建，不要覆盖或删除任何其他 Skill。完成后验证两个目标目录中的 SKILL.md 均包含 YAML frontmatter，并告诉我部署结果及是否需要重启 Agent。
```

</details>

### 3. 直接运行源码

准备好 Node.js 24+、pnpm 9+ 和 Git 2.23+ 后，在仓库根目录运行：

```powershell
pnpm install
pnpm dev
```

首次打开时，选择一个项目文件夹并点击“开启版本保护”。VibeGit 会在需要时初始化 Git、创建初始保存点；对于已有 Git 项目，它不会创建或切换普通分支。

也可以在 Windows 上双击 [`启动 VibeGit.bat`](启动%20VibeGit.bat) 启动桌面版。

## 安全不是一句口号

VibeGit 的默认立场是：**先保护，再操作。**

- 保存点写入独立的 `refs/vibegit/checkpoints/*`，不改动你的分支、`HEAD` 或真实暂存区。
- 不执行 `reset --hard`、`clean -fd`、强制推送、全局 Git 配置修改，也不删除 `.git`。
- 恢复前自动创建可验证的保险点；发生冲突的未跟踪或忽略文件会进入 Git 私有恢复区，而不是直接丢弃。
- GitHub 备份前扫描密钥、凭据、数据库、依赖/构建目录、LFS 指针与大文件；发现风险即阻止上传，原始文件留在本地。
- 桌面界面没有 Node.js 或文件系统权限，只能通过受限的主进程 API 执行允许的操作。

完整设计请参阅[安全设计](docs/SECURITY.md)与[架构说明](docs/ARCHITECTURE.md)。

## 当前发布状态

**当前稳定版本：[v1.0](https://github.com/lllleolin-max/VibeGit/releases/latest) · Windows x64 安装包与可运行源码**

已经实现并验证的核心闭环：本地版本保护、保存点与时间线、Diff、预览式恢复与撤销、暂时收起、GitHub Private 备份、Electron 桌面界面，以及统一的 Agent 事件 CLI。

Codex 与 Claude Code 目前可通过复制指令完成源码部署；原生自动安装器仍在下一阶段。仓库已提供 Hook 模板，并清楚记录了验证范围与外部依赖。查看[最终验证记录](docs/FINAL_VALIDATION.md)了解已执行的测试和当前限制。

## 支持与反馈

如果 VibeGit 对你有帮助，欢迎在 [GitHub 上给我们一个 Star](https://github.com/lllleolin-max/VibeGit)。也非常期待你通过 [Issues](https://github.com/lllleolin-max/VibeGit/issues) 提出宝贵建议、使用体验或功能需求。

## 面向开发与贡献

构建 Windows 安装程序：

```powershell
pnpm install
pnpm dist:win
```

安装程序生成在 `release/` 中，文件名为 `VibeGit-Setup-<version>-x64.exe`。

提交前检查：

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
