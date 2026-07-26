# VibeGit

<p align="center"><img src="assets/branding/vibegit-project-logo.png" alt="VibeGit" width="360" /></p>

<p align="center"><strong>すべての AI による変更を記録し、いつでも戻れるように。</strong><br />Codex、Claude Code、そしてすべての Vibe Coder のためのローカル版バージョン保険箱と GitHub プライベートバックアップ。</p>

<p align="center"><a href="#はじめに">はじめに</a> · <a href="#できること">主な機能</a> · <a href="#github-プライベート保管庫に同期">GitHub プライベートバックアップ</a> · <a href="#安全性はスローガンではありません">安全設計</a> · <a href="#リリース状況">リリース状況</a></p>

**言語 / Languages：** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI はコードを書くだけでなく、操作も実行します。ファイルを消去したり、作業中の成果を上書きしたり、プロジェクトを誤ったバージョンへ戻したりして、動いていたプロジェクトを数時間前の状態に戻してしまうことがあります。本当に怖いのはコードの一行を間違えることではなく、一度の操作の後にプロジェクト全体が突然「消えた」ように見えることです。

<p align="center"><img src="assets/branding/vibegit-project-logo.png" alt="VibeGit" width="360" /></p>

<p align="center"><strong>すべての AI による変更を記録し、いつでも戻れるように。</strong><br />Codex、Claude Code、そしてすべての Vibe Coder のためのローカル版バージョン保険箱と GitHub プライベートバックアップ。</p>

<p align="center">
  <a href="https://github.com/lllleolin-max/VibeGit/releases/latest"><img src="https://img.shields.io/github/v/release/lllleolin-max/VibeGit?label=latest" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D4" alt="Windows x64" />
  <a href="https://github.com/lllleolin-max/VibeGit/stargazers"><img src="https://img.shields.io/github/stars/lllleolin-max/VibeGit?style=flat&label=stars" alt="GitHub Stars" /></a>
</p>

<p align="center"><a href="#はじめに">はじめに</a> · <a href="#できること">主な機能</a> · <a href="#github-プライベート保管庫に同期">GitHub プライベートバックアップ</a> · <a href="#安全性はスローガンではありません">安全設計</a> · <a href="#リリース状況">リリース状況</a></p>

**言語 / Languages：** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI はコードを書くだけでなく、操作も実行します。ファイルを消去したり、作業中の成果を上書きしたり、プロジェクトを誤ったバージョンへ戻したりして、動いていたプロジェクトを数時間前の状態に戻してしまうことがあります。本当に怖いのはコードの一行を間違えることではなく、一度の操作の後にプロジェクト全体が突然「消えた」ように見えることです。

VibeGit はプロジェクトのローカル版バージョン保険箱です。重要な段階を保存しておけば、AI がプロジェクトを誤って消去、上書き、または巻き戻しても、何が起きたかを確認し、承認したバージョンへ安全に戻れます。

VibeGit は Git を分かりやすい操作に置き換えます。プロジェクトの追加、バージョンの保存、変更の確認、一時退避、古いバージョンへの復帰、GitHub へのバックアップを、commit・branch・reset を学ばずに使えます。

> **Every AI change, saved and reversible.**
>
> VibeGit が復元できるのは保存済みのバージョンです。先にバージョン保護を有効にして保存ポイントを作成してください。未保存の変更は復元を保証できません。

## よくある深夜の出来事

夜10時、ようやくプロジェクトが動きました。AI に「整理して安定版に戻して」と頼んだところ、誤操作で現在のファイルを消去したり、ずっと古いバージョンへ戻したりしてしまいます。

目の前のプロジェクトは突然見知らぬものになります。完成したばかりの画面が消え、直した問題が再発し、どこから復元すればよいかも分かりません。

VibeGit が保存するのは曖昧な記憶ではなく、あなたが確認したプロジェクトのバージョンです。保険箱のように重要な保存ポイントをローカルに残し、変更と影響を確認してから、望むバージョンへ安全に戻せます。

## できること

| 気になること | VibeGit の方法 |
| --- | --- |
| AI がプロジェクトを消去、上書き、または誤って巻き戻した | 重要なバージョンを独立した保存ポイントに残し、何が起きたかを確認してから、確認済みのバージョンへ安全に復元できます。 |
| PC の故障、買い替え、またはローカルプロジェクトの消去 | GitHub を一度接続すれば、専用 Private リポジトリへワンクリックで同期できます。既存の `origin` を変えず、ローカルとクラウドの両方に復元可能なバージョンを残します。 |
| 問題のある版から戻りたい | 復元前に保険ポイントを自動作成し、影響をプレビューしてから実行します。完了後も取り消せます。 |
| 未完成の作業を脇に置きたい | 現在の変更を安全に一時退避し、必要なときに正確に戻します。 |
| Git を知らなくても使える？ | はい。「プロジェクト」「保存ポイント」「このバージョンに戻る」など日常的な表現を使います。 |
| Agent の変更も記録される？ | 統一 Agent Events CLI がタスク前後に保護ポイントを作成し、Hook テンプレートも提供します。 |

ローカルの保存ポイントは、AI による誤消去、誤上書き、誤った巻き戻しからプロジェクトを取り戻す助けになります。GitHub のプライベートバックアップは、重要なバージョンを一台の PC だけに残さないための第二の保険です。

GitHub を一度接続すれば、残したい段階を専用 Private リポジトリへワンクリックで同期できます。PC の故障、買い替え、またはローカルのプロジェクトディレクトリを誤って消去しても、独立したクラウドコピーが残ります。

VibeGit は専用の `vibegit` remote を使います。既存の `origin` を上書き、置換、書き換えることはありません。普段の開発リポジトリはそのままに、重要なバージョンだけへ私用の保護層を追加します。

[GitHub CLI](https://cli.github.com/) のインストール後、プロジェクトで「GitHub バックアップ」を開き「GitHub に接続して SSH 鍵を作成」を選びます。VibeGit はブラウザで認可を行い、アプリデータに専用 Ed25519 鍵を作成して公開鍵だけを GitHub に登録します。詳細は [GitHub 設定](docs/GITHUB_SETUP.md) を参照してください。

## GitHub プライベート保管庫に同期

ローカルの保存ポイントは、AI による誤消去、誤上書き、誤った巻き戻しからプロジェクトを取り戻す助けになります。GitHub のプライベートバックアップは、重要なバージョンを一台の PC だけに残さないための第二の保険です。

GitHub を一度接続すれば、残したい段階を専用 Private リポジトリへワンクリックで同期できます。PC の故障、買い替え、またはローカルのプロジェクトディレクトリを誤って消去しても、独立したクラウドコピーが残ります。

VibeGit は専用の `vibegit` remote を使います。既存の `origin` を上書き、置換、書き換えることはありません。普段の開発リポジトリはそのままに、重要なバージョンだけへ私用の保護層を追加します。

[GitHub CLI](https://cli.github.com/) のインストール後、プロジェクトで「GitHub バックアップ」を開き「GitHub に接続して SSH 鍵を作成」を選びます。VibeGit はブラウザで認可を行い、アプリデータに専用 Ed25519 鍵を作成して公開鍵だけを GitHub に登録します。詳細は [GitHub 設定](docs/GITHUB_SETUP.md) を参照してください。

## はじめに

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

### 1. Codex または Claude Code で自動デプロイ

リポジトリフォルダーで、次の指示を Codex または Claude Code にコピー＆ペーストしてください。

```text
現在のワークスペースに VibeGit をワンクリックでデプロイしてください。Node.js 24+、pnpm 9+、Git 2.23+ を確認し、利用可能なら pnpm install を実行してから pnpm dev を起動してください。不足している依存関係があれば説明して先にインストールし、完了後に起動結果と次の操作を報告してください。
```

> この指示はソースから VibeGit を起動します。リポジトリをダウンロードまたはクローン済みの方向けです。

### 2. Windows インストーラーをダウンロードし、VibeGit Skill をデプロイ

[**最新の Windows x64 インストーラーをダウンロード**](https://github.com/lllleolin-max/VibeGit/releases/latest)

インストーラーに Node.js と pnpm は不要です。インストール後はスタートメニューから起動でき、アンインストールしても VibeGit データは削除されません。

> **インストーラーはリポジトリ内の Skill を自動インストールしません。** Windows インストーラーで VibeGit を利用する場合は、`vibegit-change-summary` も追加でデプロイしてください。Codex または Claude Code がタスク完了後に分かりやすい変更要約を記録し、VibeGit が次の保存ポイントで表示できるようになります。

<details>
<summary><strong>Codex または Claude Code にコピー：VibeGit Skill を自動デプロイ</strong></summary>

インストール済みの Agent にだけ Skill をデプロイし、既存の他の Skills は保持します。

```text
VibeGit Skill をデプロイしてください。VibeGit は Windows インストーラーでインストール済みです。https://github.com/lllleolin-max/VibeGit から skills/vibegit-change-summary/ を取得し、先に SKILL.md を確認してから、コピーしてください（ソースを移動・削除しないでください）。インストール済み Agent のグローバル Skills ディレクトリは、Codex が %USERPROFILE%\.codex\skills\vibegit-change-summary\SKILL.md、Claude Code が %USERPROFILE%\.claude\skills\vibegit-change-summary\SKILL.md です。この端末にインストール済みの Agent だけを設定し、不足するディレクトリは作成してください。他の Skill は上書き・削除しないでください。完了後、各配置先の SKILL.md に YAML frontmatter があることを確認し、デプロイ結果と Agent の再起動が必要かを報告してください。
```

</details>

### 3. ソースから起動する

Node.js 24+、pnpm 9+、Git 2.23+ を用意し、リポジトリのルートで実行します。

```powershell
pnpm install
pnpm dev
```

初回起動時にプロジェクトフォルダーを選び、「バージョン保護を有効にする」を選択します。必要な場合だけ Git を初期化し、初期保存ポイントを作成します。既存 Git プロジェクトの通常ブランチを作成・切替することはありません。Windows では [`启动 VibeGit.bat`](启动%20VibeGit.bat) をダブルクリックしても起動できます。

## 安全性はスローガンではありません

VibeGit の原則は **まず保護し、その後に操作すること**です。

- 保存ポイントは独立した `refs/vibegit/checkpoints/*` に書き込まれ、ブランチ、`HEAD`、実際のステージング領域を変更しません。
- `reset --hard`、`clean -fd`、force push、グローバル Git 設定の変更、`.git` の削除は行いません。
- 復元前に検証可能な保険ポイントを作成します。競合する未追跡/無視ファイルは捨てずに Git の非公開復旧領域へ移します。
- GitHub バックアップ前に鍵、認証情報、データベース、依存/ビルドディレクトリ、LFS ポインター、大きなファイルを検査します。リスクがあればローカルファイルを残してアップロードを中止します。
- Desktop Renderer に Node.js やファイルシステム権限はありません。

[セキュリティ設計](docs/SECURITY.md)と[アーキテクチャ](docs/ARCHITECTURE.md)を参照してください。

## リリース状況

**現在の安定版：[v1.0](https://github.com/lllleolin-max/VibeGit/releases/latest) · Windows x64 インストーラーと実行可能ソース**

ローカル保護、保存ポイントとタイムライン、Diff、プレビュー付き復元と取り消し、一時退避、GitHub Private バックアップ、Electron UI、統一 Agent Events CLI は実装・検証済みです。Codex/Claude Code は上記の指示でソースをデプロイできます。ネイティブ Agent 自動インストーラーは次段階の作業です。Hook テンプレートと検証範囲も提供しています。[最終検証記録](docs/FINAL_VALIDATION.md)を確認してください。

## サポートとフィードバック

VibeGit が役に立ったら、ぜひ [GitHub で Star をお願いします](https://github.com/lllleolin-max/VibeGit)。[Issues](https://github.com/lllleolin-max/VibeGit/issues) でご意見、利用体験、機能リクエストもお待ちしています。

## 開発とコントリビューション

Windows インストーラーをビルド：

```powershell
pnpm install
pnpm dist:win
```

`release/` に `VibeGit-Setup-<version>-x64.exe` が生成されます。

プロジェクトチェック：

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
