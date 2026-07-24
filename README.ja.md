# VibeGit

<p align="center"><img src="assets/branding/vibegit-project-logo.png" alt="VibeGit" width="360" /></p>

<p align="center"><strong>すべての AI による変更を記録し、いつでも戻れるように。</strong><br />Codex、Claude Code、そしてすべての Vibe Coder のためのローカル版バージョン保険箱。</p>

<p align="center"><a href="#はじめに">はじめに</a> · <a href="#できること">主な機能</a> · <a href="#安全性はスローガンではありません">安全設計</a> · <a href="#リリース状況">リリース状況</a></p>

**言語 / Languages：** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI は数分で数十個のファイルを変更できます。不安なのは変更できるかではなく、**何が変わり、気に入らなければ安全に戻れるか**です。

VibeGit は Git を分かりやすい操作に置き換えます。プロジェクトの追加、バージョンの保存、変更の確認、一時退避、古いバージョンへの復帰、GitHub へのバックアップを、commit・branch・reset を学ばずに使えます。

## できること

| 気になること | VibeGit の方法 |
| --- | --- |
| AI の変更を確認したい | タイムラインに保存ポイントを記録し、ファイル一覧、増減統計、行単位 Diff を表示します。 |
| 問題のある版から戻りたい | 復元前に保険ポイントを自動作成し、影響をプレビューしてから実行します。完了後も取り消せます。 |
| 未完成の作業を脇に置きたい | 現在の変更を安全に一時退避し、必要なときに正確に戻します。 |
| Git を知らなくても使える？ | はい。「プロジェクト」「保存ポイント」「このバージョンに戻る」など日常的な表現を使います。 |
| GitHub にバックアップしたい | はい。既存の `origin` を変更せず、Private リポジトリへバックアップできます。 |
| Agent の変更も記録される？ | 統一 Agent Events CLI がタスク前後に保護ポイントを作成し、Hook テンプレートも提供します。 |

## Vibe Coding のために

- **理解できる：** 読みやすい保存ポイント、タスク説明、Diff を使い、覚えにくいコミットハッシュに頼りません。
- **戻れる：** 影響を確認してから復元し、自動で保険を残し、取り消しも可能です。
- **邪魔しない：** ローカルの保存と復元は、ネットワーク、GitHub、Agent のインストールに依存しません。
- **守れる：** プロジェクトごとに保護し、リモートバックアップ前に機密情報を検査します。ローカルファイルは削除しません。

## はじめに

### ソースから起動する

Node.js 24+、pnpm 9+、Git 2.23+ を用意し、リポジトリのルートで実行します。

```powershell
pnpm install
pnpm dev
```

初回起動時にプロジェクトフォルダーを選び、「バージョン保護を有効にする」を選択します。必要な場合だけ Git を初期化し、初期保存ポイントを作成します。既存 Git プロジェクトの通常ブランチを作成・切替することはありません。Windows では [`启动 VibeGit.bat`](启动%20VibeGit.bat) をダブルクリックしても起動できます。

### Codex または Claude Code でワンクリックデプロイ

リポジトリフォルダーで、次の指示を Codex または Claude Code にコピー＆ペーストしてください。

```text
現在のワークスペースに VibeGit をワンクリックでデプロイしてください。Node.js 24+、pnpm 9+、Git 2.23+ を確認し、利用可能なら pnpm install を実行してから pnpm dev を起動してください。不足している依存関係があれば説明して先にインストールし、完了後に起動結果と次の操作を報告してください。
```

### Windows インストーラーをビルドする

```powershell
pnpm install
pnpm dist:win
```

インストーラーは `release/` に作成されます。[最新の Windows インストーラーをダウンロード](https://github.com/lllleolin-max/VibeGit/releases/latest)することも、`VibeGit-Setup-<version>-x64.exe` を GitHub Release にアップロードすることもできます。デスクトップとスタートメニューのショートカットが作成され、アンインストールしてもユーザーの VibeGit データは削除されません。

### 重要：インストーラー利用時も VibeGit Skill をデプロイ

> **インストーラーはリポジトリ内の Skill を自動インストールしません。** Windows インストーラーで VibeGit を利用する場合は、`vibegit-change-summary` も追加でデプロイしてください。Codex または Claude Code がタスク完了後に分かりやすい変更要約を記録し、VibeGit が次の保存ポイントで表示できるようになります。

次の指示を Codex または Claude Code に貼り付けてください。インストール済みの Agent にだけ Skill をデプロイし、既存の他の Skills は保持します。

```text
VibeGit Skill をデプロイしてください。VibeGit は Windows インストーラーでインストール済みです。https://github.com/lllleolin-max/VibeGit から skills/vibegit-change-summary/ を取得し、先に SKILL.md を確認してから、コピーしてください（ソースを移動・削除しないでください）。インストール済み Agent のグローバル Skills ディレクトリは、Codex が %USERPROFILE%\.codex\skills\vibegit-change-summary\SKILL.md、Claude Code が %USERPROFILE%\.claude\skills\vibegit-change-summary\SKILL.md です。この端末にインストール済みの Agent だけを設定し、不足するディレクトリは作成してください。他の Skill は上書き・削除しないでください。完了後、各配置先の SKILL.md に YAML frontmatter があることを確認し、デプロイ結果と Agent の再起動が必要かを報告してください。
```

## 安全性はスローガンではありません

VibeGit の原則は **まず保護し、その後に操作すること**です。

- 保存ポイントは独立した `refs/vibegit/checkpoints/*` に書き込まれ、ブランチ、`HEAD`、実際のステージング領域を変更しません。
- `reset --hard`、`clean -fd`、force push、グローバル Git 設定の変更、`.git` の削除は行いません。
- 復元前に検証可能な保険ポイントを作成します。競合する未追跡/無視ファイルは捨てずに Git の非公開復旧領域へ移します。
- GitHub バックアップ前に鍵、認証情報、データベース、依存/ビルドディレクトリ、LFS ポインター、大きなファイルを検査します。リスクがあればローカルファイルを残してアップロードを中止します。
- Desktop Renderer に Node.js やファイルシステム権限はありません。

[セキュリティ設計](docs/SECURITY.md)と[アーキテクチャ](docs/ARCHITECTURE.md)を参照してください。

## GitHub Private バックアップ

[GitHub CLI](https://cli.github.com/) のインストール後、プロジェクトで「GitHub バックアップ」を開き「GitHub に接続して SSH 鍵を作成」を選びます。VibeGit はブラウザで認可を行い、アプリデータに専用 Ed25519 鍵を作成して公開鍵だけを GitHub に登録します。専用 `vibegit` remote を使うため、既存の `origin` は上書きしません。詳細は [GitHub 設定](docs/GITHUB_SETUP.md) を参照してください。

## リリース状況

**v0.1.1 · Windows インストーラー付き実行可能ソース**

ローカル保護、保存ポイントとタイムライン、Diff、プレビュー付き復元と取り消し、一時退避、GitHub Private バックアップ、Electron UI、統一 Agent Events CLI は実装・検証済みです。Codex/Claude Code の自動インストーラーは次段階の作業であり、Hook テンプレートと検証範囲を提供しています。[最終検証記録](docs/FINAL_VALIDATION.md)を確認してください。

## サポートとフィードバック

VibeGit が役に立ったら、ぜひ [GitHub で Star をお願いします](https://github.com/lllleolin-max/VibeGit)。[Issues](https://github.com/lllleolin-max/VibeGit/issues) でご意見、利用体験、機能リクエストもお待ちしています。

## 開発とコントリビューション

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cli-build
pnpm test:cli-e2e
pnpm test:desktop
```

- [製品仕様](docs/PRODUCT_SPEC.md) · [アーキテクチャ](docs/ARCHITECTURE.md) · [セキュリティ設計](docs/SECURITY.md)
- [受け入れ基準](docs/ACCEPTANCE_CRITERIA.md) · [Codex 統合](docs/CODEX_INTEGRATION.md) · [Claude Code 統合](docs/CLAUDE_CODE_INTEGRATION.md)

---

**大胆なアイデアを AI に。帰り道は VibeGit に。**
