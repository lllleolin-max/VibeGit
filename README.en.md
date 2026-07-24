# VibeGit

<p align="center">
  <img src="assets/branding/vibegit-project-logo.png" alt="VibeGit" width="360" />
</p>

<p align="center">
  <strong>Every AI change, saved and reversible.</strong><br />
  A local version safety net for Codex, Claude Code, and every Vibe Coder.
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#what-it-does">Core capabilities</a> ·
  <a href="#safety-by-default">Safety</a> ·
  <a href="#release-status">Release status</a>
</p>

**Languages:** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI can turn an idea into code—and change dozens of files in minutes. The hard question is not whether it can make changes, but: **what changed, and can I safely go back?**

VibeGit puts Git behind plain-language actions: add a project, save a version, inspect changes, shelf work, return to an earlier version, and back up to GitHub. You do not need to learn commits, branches, or reset before letting AI move your project forward.

## What it does

| What you need | What VibeGit does |
| --- | --- |
| Verify an AI change | Records checkpoints in a timeline with file lists, change statistics, and line-by-line diffs. |
| Return from a bad version | Creates a safety checkpoint first, previews the impact, and lets you undo the restore. |
| Put unfinished work aside | Safely shelves current changes and restores them precisely when needed. |
| Work without Git knowledge | Uses everyday terms such as Project, Checkpoint, and Return to this version. |
| Back up to GitHub | Creates a private backup without changing your existing `origin`. |
| Track Codex / Claude Code work | The unified Agent Events CLI can create protection points before and after tasks; hook templates are included. |

## Built for Vibe Coding

VibeGit is not another Git GUI. It is for staying informed and in control when AI handles implementation work.

- **Understandable:** readable checkpoints, task descriptions, and diffs instead of memorising commit hashes.
- **Reversible:** preview the impact, keep a safety copy automatically, and retain an undo path.
- **Unobtrusive:** local saving and restoring do not depend on a network connection, GitHub, or an installed Agent.
- **Defensive:** each project is protected independently; remote backups scan sensitive information and never delete your local files.

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

### Run from source

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

## Private GitHub backup

After installing [GitHub CLI](https://cli.github.com/), open **GitHub Backup** in a project and choose **Connect GitHub and create an SSH key**. VibeGit completes browser authorisation, creates a dedicated Ed25519 key in its application-data folder, and registers only the public key with GitHub.

Backups use a dedicated `vibegit` remote and never overwrite your existing `origin`. See [GitHub setup](docs/GITHUB_SETUP.md) for details.

## Release status

**v0.1.1 · runnable source with Windows installer**

The verified core workflow includes local version protection, checkpoints and timeline, diffs, previewed restore and undo, shelving, private GitHub backup, the Electron desktop UI, and the unified Agent Events CLI.

Automatic installers for Codex and Claude Code are a follow-up. The repository includes hook templates and documents their verification boundaries and external dependencies. See the [final validation record](docs/FINAL_VALIDATION.md) for executed tests and current limitations.

## Support and feedback

If VibeGit helps you, please [give us a Star on GitHub](https://github.com/lllleolin-max/VibeGit). We also welcome your suggestions, experience reports, and feature requests through [Issues](https://github.com/lllleolin-max/VibeGit/issues).

## Development and contribution

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
