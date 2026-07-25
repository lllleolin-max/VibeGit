# VibeGit

<p align="center">
  <img src="assets/branding/vibegit-project-logo.png" alt="VibeGit" width="360" />
</p>

<p align="center">
  <strong>Every AI change, saved and reversible.</strong><br />
  A local version vault and private GitHub backup for Codex, Claude Code, and every Vibe Coder.
</p>

<p align="center">
  <a href="https://github.com/lllleolin-max/VibeGit/releases/latest"><img src="https://img.shields.io/github/v/release/lllleolin-max/VibeGit?label=latest" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D4" alt="Windows x64" />
  <a href="https://github.com/lllleolin-max/VibeGit/stargazers"><img src="https://img.shields.io/github/stars/lllleolin-max/VibeGit?style=flat&label=stars" alt="GitHub Stars" /></a>
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#what-it-does">Core capabilities</a> ·
  <a href="#sync-to-a-private-github-vault">Private GitHub backup</a> ·
  <a href="#safety-by-default">Safety</a> ·
  <a href="#release-status">Release status</a>
</p>

**Languages:** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI does not only write code; it also takes actions. It can clear files, overwrite working results, or roll a project back to the wrong version—turning a working project into what it was hours ago. The frightening part is not one wrong line of code; it is opening the project after one action and finding that it is suddenly gone.

**Languages:** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI does not only write code; it also takes actions. It can clear files, overwrite working results, or roll a project back to the wrong version—turning a working project into what it was hours ago. The frightening part is not one wrong line of code; it is opening the project after one action and finding that it is suddenly gone.

VibeGit is a local version vault for your project. Save the stages that matter, and even if AI clears, overwrites, or mistakenly rolls back your project, you can see what happened and safely return to a version you confirmed.

VibeGit puts Git behind plain-language actions: add a project, save a version, inspect changes, shelf work, return to an earlier version, and back up to GitHub. You do not need to learn commits, branches, or reset before letting AI move your project forward.

> **Every AI change, saved and reversible.**
>
> VibeGit can restore versions that have been saved. Enable version protection and create a checkpoint first; unsaved changes cannot be guaranteed recoverable.

## A familiar late night

At 10 p.m., you finally have the project working. You ask AI to “tidy things up and return to the stable version,” but it makes the wrong move: it clears the current files or rolls the project back to a much older version.

The project suddenly feels unfamiliar. A page you just finished is gone, a fixed issue has returned, and you do not even know where to begin restoring it.

VibeGit does not save a vague memory; it saves the project versions you confirmed. Like a vault, it keeps important checkpoints locally so you can inspect the changes, understand the impact, and safely bring the project back to the version you wanted.

## What it does

| What you need | What VibeGit does |
| --- | --- |
| AI cleared, overwrote, or rolled the project back incorrectly | Keeps important versions in isolated checkpoints; review what happened, then safely restore a version you confirmed. |
| Computer failure, a new machine, or a cleared local project | After one GitHub connection, sync to a dedicated private repository in one click. Recoverable versions remain both locally and in the cloud, without changing your existing `origin`. |
| Return from a bad version | Creates a safety checkpoint first, previews the impact, and lets you undo the restore. |
| Put unfinished work aside | Safely shelves current changes and restores them precisely when needed. |
| Work without Git knowledge | Uses everyday terms such as Project, Checkpoint, and Return to this version. |
| Track Codex / Claude Code work | The unified Agent Events CLI can create protection points before and after tasks; hook templates are included. |

Local checkpoints help you recover from AI clearing, overwriting, or mistakenly rolling back a project. A private GitHub backup keeps those important versions from living on only one computer.

After connecting GitHub once, sync any stage worth keeping to a dedicated private repository in one click. If a computer fails, you move to a new machine, or the local project directory is accidentally cleared, you still have an independent cloud copy.

VibeGit uses a dedicated `vibegit` remote. It never overwrites, replaces, or rewrites your existing `origin`; your everyday development repository stays exactly as it is while VibeGit adds a layer of private protection for important versions.

After installing [GitHub CLI](https://cli.github.com/), open **GitHub Backup** in a project and choose **Connect GitHub and create an SSH key**. VibeGit completes browser authorisation, creates a dedicated Ed25519 key in its application-data folder, and registers only the public key with GitHub. See [GitHub setup](docs/GITHUB_SETUP.md) for details.

## Sync to a private GitHub vault

Local checkpoints help you recover from AI clearing, overwriting, or mistakenly rolling back a project. A private GitHub backup keeps those important versions from living on only one computer.

After connecting GitHub once, sync any stage worth keeping to a dedicated private repository in one click. If a computer fails, you move to a new machine, or the local project directory is accidentally cleared, you still have an independent cloud copy.

VibeGit uses a dedicated `vibegit` remote. It never overwrites, replaces, or rewrites your existing `origin`; your everyday development repository stays exactly as it is while VibeGit adds a layer of private protection for important versions.

After installing [GitHub CLI](https://cli.github.com/), open **GitHub Backup** in a project and choose **Connect GitHub and create an SSH key**. VibeGit completes browser authorisation, creates a dedicated Ed25519 key in its application-data folder, and registers only the public key with GitHub. See [GitHub setup](docs/GITHUB_SETUP.md) for details.

## Get started

### One-click deployment with Codex or Claude Code

Copy and paste this instruction into Codex or Claude Code from the repository folder:

```text
Deploy VibeGit in the current workspace: check that Node.js 24+, pnpm 9+, and Git 2.23+ are available; if they are, run pnpm install and then pnpm dev. If a dependency is missing, explain it and install it first. Report the launch result and next steps when finished.
```

### Build the Windows installer

```powershell
pnpm install
pnpm dist:win
```

The installer is created in `release/`. You can [download the latest Windows installer](https://github.com/lllleolin-max/VibeGit/releases/latest) or upload `VibeGit-Setup-<version>-x64.exe` to a GitHub Release. Installation creates desktop and Start Menu shortcuts; uninstalling does not remove the user's VibeGit data.

### Important: installer users must also deploy the VibeGit Skill

> **The installer does not automatically install repository Skills.** If you use VibeGit through the Windows installer, also deploy `vibegit-change-summary`. It lets Codex or Claude Code record a plain-language change summary after a task so VibeGit can show it in the next checkpoint.

Copy the following instruction into Codex or Claude Code. It deploys the Skill only for Agents installed on the machine and preserves all of your existing Skills:

```text
Deploy the VibeGit Skill for me. VibeGit was installed through the Windows installer. Retrieve skills/vibegit-change-summary/ from https://github.com/lllleolin-max/VibeGit, inspect its SKILL.md, then copy it (do not move or delete the source) to the global Skills directory of each installed Agent: Codex uses %USERPROFILE%\.codex\skills\vibegit-change-summary\SKILL.md and Claude Code uses %USERPROFILE%\.claude\skills\vibegit-change-summary\SKILL.md. Configure only Agents installed on this machine; create missing directories; do not overwrite or delete any other Skill. When finished, verify that every destination SKILL.md has YAML frontmatter and report what was deployed and whether an Agent restart is needed.
```

### 1. Deploy automatically with Codex or Claude Code

Copy and paste this instruction into Codex or Claude Code from the repository folder:

```text
Deploy VibeGit in the current workspace: check that Node.js 24+, pnpm 9+, and Git 2.23+ are available; if they are, run pnpm install and then pnpm dev. If a dependency is missing, explain it and install it first. Report the launch result and next steps when finished.
```

> This launches VibeGit from source and is intended for users who have already downloaded or cloned the repository.

### 2. Download the Windows installer and deploy the VibeGit Skill

[**Download the latest Windows x64 installer**](https://github.com/lllleolin-max/VibeGit/releases/latest)

The installer does not require Node.js or pnpm. Launch VibeGit from the Start Menu after installation; uninstalling does not remove your VibeGit data.

> **The installer does not automatically install repository Skills.** If you use VibeGit through the Windows installer, also deploy `vibegit-change-summary`. It lets Codex or Claude Code record a plain-language change summary after a task so VibeGit can show it in the next checkpoint.

<details>
<summary><strong>Copy into Codex or Claude Code: deploy the VibeGit Skill automatically</strong></summary>

This deploys the Skill only for Agents installed on the machine and preserves all existing Skills:

```text
Deploy the VibeGit Skill for me. VibeGit was installed through the Windows installer. Retrieve skills/vibegit-change-summary/ from https://github.com/lllleolin-max/VibeGit, inspect its SKILL.md, then copy it (do not move or delete the source) to the global Skills directory of each installed Agent: Codex uses %USERPROFILE%\.codex\skills\vibegit-change-summary\SKILL.md and Claude Code uses %USERPROFILE%\.claude\skills\vibegit-change-summary\SKILL.md. Configure only Agents installed on this machine; create missing directories; do not overwrite or delete any other Skill. When finished, verify that every destination SKILL.md has YAML frontmatter and report what was deployed and whether an Agent restart is needed.
```

</details>

### 3. Run from source

Install Node.js 24+, pnpm 9+, and Git 2.23+, then run from the repository root:

```powershell
pnpm install
pnpm dev
```

On first launch, choose a project folder and select **Enable version protection**. VibeGit initialises Git only when necessary and creates an initial checkpoint. For an existing Git project, it does not create or switch ordinary branches.

On Windows, you can also double-click [`启动 VibeGit.bat`](启动%20VibeGit.bat).

## Safety by default

VibeGit's default principle is: **protect first, then act.**

- Checkpoints are stored in isolated `refs/vibegit/checkpoints/*` and never change your branch, `HEAD`, or real staging area.
- It does not run `reset --hard`, `clean -fd`, force pushes, global Git configuration changes, or delete `.git`.
- Before restore, it creates a verifiable safety checkpoint. Conflicting untracked or ignored files enter a private Git recovery area instead of being discarded.
- Before GitHub backup, it scans keys, credentials, databases, dependency/build directories, LFS pointers, and large files. A risk blocks upload while keeping source files local.
- The desktop renderer has no Node.js or filesystem access; it can only call allow-listed main-process APIs.

Read the [security design](docs/SECURITY.md) and [architecture](docs/ARCHITECTURE.md) for details.

## Release status

**Current stable release: [v0.1.2](https://github.com/lllleolin-max/VibeGit/releases/latest) · Windows x64 installer and runnable source**

The verified core workflow includes local version protection, checkpoints and timeline, diffs, previewed restore and undo, shelving, private GitHub backup, the Electron desktop UI, and the unified Agent Events CLI.

Codex and Claude Code can deploy the source through the copyable instruction above; native Agent installers remain a follow-up. The repository includes hook templates and documents their verification boundaries and external dependencies. See the [final validation record](docs/FINAL_VALIDATION.md) for executed tests and current limitations.

## Support and feedback

If VibeGit helps you, please [give us a Star on GitHub](https://github.com/lllleolin-max/VibeGit). We also welcome your suggestions, experience reports, and feature requests through [Issues](https://github.com/lllleolin-max/VibeGit/issues).

## Development and contribution

Build the Windows installer:

```powershell
pnpm install
pnpm dist:win
```

The installer is generated in `release/` as `VibeGit-Setup-<version>-x64.exe`.

Run the project checks:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cli-build
pnpm test:cli-e2e
pnpm test:desktop
```

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security design](docs/SECURITY.md)
- [Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md)
- [Codex integration](docs/CODEX_INTEGRATION.md) · [Claude Code integration](docs/CLAUDE_CODE_INTEGRATION.md)

---

**Give bold ideas to AI. Leave the way back to VibeGit.**
