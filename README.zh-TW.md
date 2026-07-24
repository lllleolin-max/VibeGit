# VibeGit

<p align="center"><img src="assets/branding/vibegit-project-logo.png" alt="VibeGit" width="360" /></p>

<p align="center"><strong>讓每一次 AI 修改，都有跡可循、隨時可回。</strong><br />給 Codex、Claude Code 與每一位 Vibe Coder 的本機版本保險箱。</p>

<p align="center"><a href="#開始使用">開始使用</a> · <a href="#它能做什麼">核心能力</a> · <a href="#安全不是一句口號">安全設計</a> · <a href="#目前發布狀態">發布狀態</a></p>

**語言 / Languages：** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI 能在幾分鐘內變更數十個檔案。真正令人不安的不是它能否修改，而是：**這次改了什麼？不滿意時能否安全回到之前？**

VibeGit 將 Git 的能力隱藏在直覺操作後：新增專案、儲存版本、檢視變更、暫時收起、回到舊版本、備份到 GitHub。你不必先學會 commit、branch 或 reset，也能安心讓 AI 推進專案。

## 它能做什麼

| 你關心的事 | VibeGit 的做法 |
| --- | --- |
| 如何確認 AI 修改結果？ | 時間線記錄每個儲存點，提供檔案清單、增刪統計和逐行 Diff。 |
| 這版不對能回去嗎？ | 回退前自動建立保險點、預覽影響，完成後仍可撤銷。 |
| 未完成的工作能先放一邊嗎？ | 安全暫時收起目前修改，需要時精確取回。 |
| 不懂 Git 也能使用嗎？ | 可以；介面採用「專案」「儲存點」「回到這個版本」等日常語言。 |
| 能備份到 GitHub 嗎？ | 可以；備份至 Private 儲存庫，且不變更既有 `origin`。 |
| 會記錄 Codex / Claude Code 的修改嗎？ | 統一 Agent Events CLI 能在任務前後建立保護點，並附有 Hook 範本。 |

## 為 Vibe Coding 而生

- **看得懂：** 使用可讀的儲存點、任務說明與 Diff，不必記住提交雜湊。
- **回得去：** 先預覽影響、自動留下保險，並保有撤銷能力。
- **不打擾：** 本機儲存和復原不依賴網路、GitHub 或 Agent 是否已安裝。
- **守得住：** 每個專案獨立保護；遠端備份先掃描敏感資訊，不會刪除本機檔案。

## 開始使用

### 使用 Codex 或 Claude Code 一鍵部署

在儲存庫資料夾中，將以下指令複製並貼到 Codex 或 Claude Code：

```text
請在目前工作區一鍵部署 VibeGit：檢查 Node.js 24+、pnpm 9+ 和 Git 2.23+；若已符合，執行 pnpm install，然後執行 pnpm dev。若缺少依賴，請先說明並安裝。完成後告訴我啟動結果和下一步操作。
```

### 建置 Windows 安裝程式

```powershell
pnpm install
pnpm dist:win
```

安裝程式會生成於 `release/`。你也可以直接[下載最新 Windows 安裝程式](https://github.com/lllleolin-max/VibeGit/releases/latest)，或將 `VibeGit-Setup-<version>-x64.exe` 上傳至 GitHub Release；安裝後會建立桌面與開始功能表捷徑，解除安裝不會刪除 VibeGit 資料。

### 重要：使用安裝程式時仍需部署 VibeGit Skill

> **安裝程式不會自動安裝儲存庫中的 Skill。** 若你透過 Windows 安裝程式使用 VibeGit，請額外部署 `vibegit-change-summary`；它讓 Codex 或 Claude Code 在任務完成後記錄易讀的變更摘要，供 VibeGit 下一個儲存點顯示。

將以下指令複製給 Codex 或 Claude Code。它只會為已安裝的 Agent 部署 Skill，並保留既有其他 Skills：

```text
請為我部署 VibeGit Skill。VibeGit 已透過 Windows 安裝程式安裝。請從 https://github.com/lllleolin-max/VibeGit 取得儲存庫中的 skills/vibegit-change-summary/，先檢查其中的 SKILL.md，再複製（不要移動或刪除原始檔）到已安裝 Agent 的全域 Skills 目錄：Codex 使用 %USERPROFILE%\.codex\skills\vibegit-change-summary\SKILL.md，Claude Code 使用 %USERPROFILE%\.claude\skills\vibegit-change-summary\SKILL.md。只設定本機已安裝的 Agent；如目錄不存在請建立，不要覆寫或刪除其他任何 Skill。完成後驗證每個目標目錄的 SKILL.md 都包含 YAML frontmatter，並告訴我部署結果及是否需要重新啟動 Agent。
```

### 直接執行原始碼

安裝 Node.js 24+、pnpm 9+ 與 Git 2.23+ 後，在儲存庫根目錄執行：

```powershell
pnpm install
pnpm dev
```

第一次開啟時選擇專案資料夾，按下「開啟版本保護」。VibeGit 只在需要時初始化 Git 並建立初始儲存點；對既有 Git 專案不會建立或切換一般分支。Windows 也可直接雙擊 [`启动 VibeGit.bat`](启动%20VibeGit.bat)。

## 安全不是一句口號

VibeGit 的原則是：**先保護，再操作。**

- 儲存點寫入獨立的 `refs/vibegit/checkpoints/*`，不變更分支、`HEAD` 或真實暫存區。
- 不執行 `reset --hard`、`clean -fd`、強制推送、全域 Git 設定修改或刪除 `.git`。
- 復原前自動建立可驗證保險點；衝突的未追蹤或忽略檔案會進入 Git 私有復原區，而不是被捨棄。
- GitHub 備份前掃描金鑰、憑證、資料庫、依賴/建置目錄、LFS 指標與大型檔案；有風險即阻擋上傳且保留本機檔案。
- 桌面 Renderer 沒有 Node.js 或檔案系統權限。

詳見[安全設計](docs/SECURITY.md)與[架構說明](docs/ARCHITECTURE.md)。

## GitHub Private 備份

安裝 [GitHub CLI](https://cli.github.com/) 後，在專案頁開啟「GitHub 備份」並點選「連線 GitHub 並建立 SSH 金鑰」。VibeGit 會以瀏覽器授權，在應用程式資料目錄建立專用 Ed25519 金鑰，只將公鑰註冊到 GitHub。備份使用專用 `vibegit` remote，不會覆寫既有 `origin`；詳見 [GitHub 設定說明](docs/GITHUB_SETUP.md)。

## 目前發布狀態

**v0.1.1 · 含 Windows 安裝程式的可執行原始碼**

已實作並驗證本機版本保護、儲存點與時間線、Diff、預覽式復原與撤銷、暫時收起、GitHub Private 備份、Electron 桌面介面與統一 Agent Events CLI。Codex 與 Claude Code 自動安裝器屬於後續工作；已附 Hook 範本與驗證邊界。請參閱[最終驗證記錄](docs/FINAL_VALIDATION.md)。

## 支持與回饋

如果 VibeGit 對你有幫助，歡迎在 [GitHub 給我們一個 Star](https://github.com/lllleolin-max/VibeGit)。也非常期待你透過 [Issues](https://github.com/lllleolin-max/VibeGit/issues) 提出寶貴建議、使用體驗或功能需求。

## 開發與貢獻

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cli-build
pnpm test:cli-e2e
pnpm test:desktop
```

- [產品規格](docs/PRODUCT_SPEC.md) · [架構說明](docs/ARCHITECTURE.md) · [安全設計](docs/SECURITY.md)
- [驗收標準](docs/ACCEPTANCE_CRITERIA.md) · [Codex 整合](docs/CODEX_INTEGRATION.md) · [Claude Code 整合](docs/CLAUDE_CODE_INTEGRATION.md)

---

**把大膽的想法交給 AI，把回頭路交給 VibeGit。**
