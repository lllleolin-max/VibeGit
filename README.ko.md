# VibeGit

<p align="center"><img src="assets/branding/vibegit-project-logo.png" alt="VibeGit" width="360" /></p>

<p align="center"><strong>모든 AI 변경 사항을 기록하고, 언제든 되돌아가세요.</strong><br />Codex, Claude Code 및 모든 Vibe Coder를 위한 로컬 버전 안전망입니다.</p>

<p align="center"><a href="#시작하기">시작하기</a> · <a href="#무엇을-할-수-있나요">핵심 기능</a> · <a href="#안전은-구호가-아닙니다">안전 설계</a> · <a href="#릴리스-상태">릴리스 상태</a></p>

**언어 / Languages:** [简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

---

AI는 몇 분 안에 수십 개 파일을 변경할 수 있습니다. 중요한 것은 변경할 수 있는지가 아니라, **무엇이 바뀌었고 마음에 들지 않을 때 안전하게 돌아갈 수 있는지**입니다.

VibeGit은 Git을 프로젝트 추가, 버전 저장, 변경 확인, 임시 보관, 이전 버전 복귀, GitHub 백업이라는 쉬운 작업으로 바꿉니다. commit, branch, reset을 먼저 배우지 않아도 AI와 함께 프로젝트를 진행할 수 있습니다.

## 무엇을 할 수 있나요

| 필요한 것 | VibeGit의 방법 |
| --- | --- |
| AI 변경 확인 | 타임라인에 저장 지점을 기록하고 파일 목록, 변경 통계, 줄 단위 Diff를 보여줍니다. |
| 잘못된 버전에서 복귀 | 먼저 안전 저장 지점을 만들고 영향을 미리 본 뒤 복원하며, 이후에도 취소할 수 있습니다. |
| 미완성 작업 보관 | 현재 변경을 안전하게 임시 보관하고 필요할 때 정확히 되돌립니다. |
| Git 지식 없이 사용 | 프로젝트, 저장 지점, 이 버전으로 돌아가기 같은 일상 언어를 사용합니다. |
| GitHub 백업 | 기존 `origin`을 변경하지 않고 Private 저장소에 백업합니다. |
| Agent 변경 기록 | 통합 Agent Events CLI가 작업 전후 보호 지점을 만들며 Hook 템플릿도 제공합니다. |

## Vibe Coding을 위해

- **이해할 수 있음:** 읽기 쉬운 저장 지점, 작업 설명, Diff를 사용합니다.
- **되돌릴 수 있음:** 영향을 미리 보고 자동 안전 사본과 취소 경로를 유지합니다.
- **방해하지 않음:** 로컬 저장과 복원은 네트워크, GitHub, Agent 설치에 의존하지 않습니다.
- **지켜 줌:** 프로젝트별로 보호하고 원격 백업 전에 민감 정보를 검사하며 로컬 파일을 삭제하지 않습니다.

## 시작하기

### Codex 또는 Claude Code로 원클릭 배포

저장소 폴더에서 다음 지시문을 Codex 또는 Claude Code에 복사하여 붙여넣으세요.

```text
현재 작업 공간에 VibeGit을 원클릭으로 배포하세요. Node.js 24+, pnpm 9+, Git 2.23+가 있는지 확인하고, 사용 가능하면 pnpm install을 실행한 다음 pnpm dev를 시작하세요. 누락된 의존성이 있으면 먼저 설명하고 설치한 뒤, 완료되면 실행 결과와 다음 단계를 알려 주세요.
```

### Windows 설치 프로그램 빌드

```powershell
pnpm install
pnpm dist:win
```

설치 프로그램은 `release/`에 생성됩니다. [최신 Windows 설치 프로그램을 다운로드](https://github.com/lllleolin-max/VibeGit/releases/latest)하거나 `VibeGit-Setup-<version>-x64.exe`를 GitHub Release에 올려 배포할 수 있습니다. 설치 시 바탕 화면과 시작 메뉴 바로 가기가 생성되며 제거해도 사용자 VibeGit 데이터는 삭제되지 않습니다.

### 중요: 설치 프로그램 사용자는 VibeGit Skill도 배포해야 합니다

> **설치 프로그램은 저장소의 Skill을 자동으로 설치하지 않습니다.** Windows 설치 프로그램으로 VibeGit을 사용한다면 `vibegit-change-summary`도 추가로 배포하세요. Codex 또는 Claude Code가 작업 후 이해하기 쉬운 변경 요약을 기록하여 VibeGit이 다음 저장 지점에 표시할 수 있습니다.

아래 지시문을 Codex 또는 Claude Code에 붙여넣으세요. 이 지시문은 컴퓨터에 설치된 Agent에만 Skill을 배포하며 기존의 다른 Skills는 유지합니다.

```text
VibeGit Skill을 배포하세요. VibeGit은 Windows 설치 프로그램으로 설치되어 있습니다. https://github.com/lllleolin-max/VibeGit 에서 skills/vibegit-change-summary/를 가져와 먼저 SKILL.md를 확인한 뒤 복사하세요(소스를 이동하거나 삭제하지 마세요). 설치된 Agent의 전역 Skills 디렉터리는 Codex가 %USERPROFILE%\.codex\skills\vibegit-change-summary\SKILL.md, Claude Code가 %USERPROFILE%\.claude\skills\vibegit-change-summary\SKILL.md입니다. 이 컴퓨터에 설치된 Agent만 설정하고, 없는 디렉터리는 생성하세요. 다른 Skill은 덮어쓰거나 삭제하지 마세요. 완료 후 모든 대상 SKILL.md에 YAML frontmatter가 있는지 검증하고, 배포 결과와 Agent 재시작 필요 여부를 알려 주세요.
```

### 소스에서 실행

Node.js 24+, pnpm 9+, Git 2.23+를 준비한 뒤 저장소 루트에서 실행합니다.

```powershell
pnpm install
pnpm dev
```

처음 열 때 프로젝트 폴더를 고르고 **버전 보호 활성화**를 선택하세요. 필요한 경우에만 Git을 초기화하고 초기 저장 지점을 만들며, 기존 Git 프로젝트의 일반 브랜치를 만들거나 전환하지 않습니다. Windows에서는 [`启动 VibeGit.bat`](启动%20VibeGit.bat)를 두 번 클릭해도 됩니다.

## 안전은 구호가 아닙니다

VibeGit의 원칙은 **먼저 보호하고, 그다음 작업하는 것**입니다.

- 저장 지점은 독립된 `refs/vibegit/checkpoints/*`에 기록되어 브랜치, `HEAD`, 실제 staging 영역을 바꾸지 않습니다.
- `reset --hard`, `clean -fd`, force push, 전역 Git 설정 변경, `.git` 삭제를 실행하지 않습니다.
- 복원 전에 검증 가능한 안전 지점을 만들며 충돌하는 추적되지 않은/무시된 파일은 버리지 않고 Git의 비공개 복구 영역으로 옮깁니다.
- GitHub 백업 전에 키, 자격 증명, 데이터베이스, 의존성/빌드 디렉터리, LFS 포인터, 큰 파일을 검사합니다. 위험이 있으면 로컬 파일을 남긴 채 업로드를 막습니다.
- 데스크톱 Renderer에는 Node.js 및 파일 시스템 권한이 없습니다.

[보안 설계](docs/SECURITY.md)와 [아키텍처](docs/ARCHITECTURE.md)를 참고하세요.

## GitHub Private 백업

[GitHub CLI](https://cli.github.com/) 설치 후 프로젝트의 **GitHub 백업**에서 **GitHub 연결 및 SSH 키 만들기**를 선택합니다. VibeGit은 브라우저에서 권한을 부여받고 앱 데이터에 전용 Ed25519 키를 만들며 공개 키만 GitHub에 등록합니다. 전용 `vibegit` remote를 사용하므로 기존 `origin`은 덮어쓰지 않습니다. 자세한 내용은 [GitHub 설정](docs/GITHUB_SETUP.md)을 참고하세요.

## 릴리스 상태

**v0.1.1 · Windows 설치 프로그램을 포함한 실행 가능한 소스**

로컬 버전 보호, 저장 지점과 타임라인, Diff, 미리 보기 복원과 취소, 임시 보관, GitHub Private 백업, Electron UI, 통합 Agent Events CLI는 구현 및 검증되었습니다. Codex/Claude Code 자동 설치 프로그램은 다음 단계이며 Hook 템플릿과 검증 범위를 제공합니다. [최종 검증 기록](docs/FINAL_VALIDATION.md)을 확인하세요.

## 지원 및 피드백

VibeGit이 도움이 되었다면 [GitHub에서 Star를 눌러 주세요](https://github.com/lllleolin-max/VibeGit). [Issues](https://github.com/lllleolin-max/VibeGit/issues)를 통해 소중한 제안, 사용 경험, 기능 요청도 기다립니다.

## 개발 및 기여

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cli-build
pnpm test:cli-e2e
pnpm test:desktop
```

- [제품 사양](docs/PRODUCT_SPEC.md) · [아키텍처](docs/ARCHITECTURE.md) · [보안 설계](docs/SECURITY.md)
- [인수 기준](docs/ACCEPTANCE_CRITERIA.md) · [Codex 통합](docs/CODEX_INTEGRATION.md) · [Claude Code 통합](docs/CLAUDE_CODE_INTEGRATION.md)

---

**대담한 아이디어는 AI에게, 돌아갈 길은 VibeGit에게.**
