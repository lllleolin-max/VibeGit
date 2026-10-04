# Engineering audit — 2026-10-05

**结论：96/100，达到本次内部工程自审的 ≥95 目标。** 最终冻结源码的 19 个测试文件全部通过，199 项通过、3 项 Windows 平台条件跳过；桌面验收 3/3、构建、Lint、CLI 验收及依赖审计通过。分数代表下面公开的控制量表，不等同于覆盖率、外部认证或“没有任何缺陷”。本报告记录源码修复的本地验收结果；本轮未发布新安装包或升级用户桌面应用。提交后的远端检查结果见 [GitHub Actions](https://github.com/lllleolin-max/VibeGit/actions/workflows/quality.yml)。

Scope: the VibeGit repository, starting from commit `4ae33d0`. This is an internal engineering rubric, not an external certification or a guarantee that no defects remain. The target is at least 95/100 after fixing findings and reviewing the final changes. Live user data and real GitHub uploads are outside the test fixture boundary.

## Fixed scoring rubric

Each of the following 20 controls is worth five points. Scoring: 5 = reviewed and supported by relevant passing evidence; 4 = implemented and locally validated but with a stated residual validation gap; 3 = implemented but missing a meaningful regression or required environment validation; 2 = incomplete mitigation; 1 = confirmed defect; 0 = absent. Unresolved P0/P1 findings or failed build, type, lint, or required regression checks prevent acceptance regardless of the sum. Findings are rated by impact, not by the score needed to pass.

| Area (20 each) | Controls (5 each) |
| --- | --- |
| Correctness | Checkpoint/restore semantics; project and UI state transitions; input and boundary contracts; truthful failure and success results |
| Security | Renderer/IPC isolation; filesystem and Git write boundaries; credentials and verified remote transport; dependency vulnerability check |
| Reliability | Bounded work and large-repository behavior; concurrent operation ownership; atomic persistence and recovery; existing-data compatibility |
| Test assurance | Build/types/lint; meaningful core and security regressions; desktop and CLI acceptance; reproducible automated checks |
| Maintainability | Module ownership and manageable coupling; structured diagnostics; consistent versions/configuration; accurate architecture and limitations documentation |

## Initial evidence

- Working tree was clean; no CodeGraph index exists.
- Dependency audit reported 30 advisories: 16 high, 10 moderate, four low. The full machine-readable result is in the locally ignored `test-results/engineering-audit-before.json`.
- Existing validation was historical and must be repeated for this revision.
- Known large-project snapshot timeout and lack of a checked-in CI quality gate require review.

## Findings and fixes

| Finding | Severity | Resolution and regression evidence |
| --- | --- | --- |
| Dependency advisories, including Electron | P1 | Electron 43.5.0 and patched transitive releases; fixed lockfile, zero findings in the final dependency audit. |
| Removing a project/checkpoint could overlap a save or restore, and ref deletion could precede a failed DB commit | P1 | Existing project queue/lease now covers both deletions; ownership checked inside the DB transaction; DB failure leaves refs intact. `checkpoint-management.test.ts`, `database.test.ts`. |
| Git stdin EPIPE could escape as an unhandled stream error | P1 | Bounded structured error instead of process crash. `git-engine.test.ts`. |
| Project marker and SSH metadata writes could follow links | P1 | Standalone regular-file checks and verified handles; atomic project-marker replacement, exclusive public-key creation. `protection-marker.test.ts`, `github-provider.test.ts`. |
| User SSH configuration could redirect the managed backup transport | P1 | `-F none`, `IdentityAgent=none`, dedicated identity and known_hosts. Real local `ssh -G` validation; host-key verification retained. |
| `.npmrc` basic-auth `_password` was not detected | P1 | Added credential detection plus negative controls for safe project settings. `sensitive-scanner.test.ts`. |
| Failed Agent task could be blocked by the summary requirement instead of saved | P1 | `StopFailure` immediately creates the failed protection point. `agent-events.test.ts`. |
| Service reload could close the database underneath an in-flight IPC | P1 | Per-instance request lifetime and delayed retirement. `service-lifecycle.test.ts`. |
| Browser preview accepted internal checkpoint fields without desktop-equivalent validation | P2 | Shared runtime validation, field stripping and Host checks; HTTP tests plus illegal IPC desktop acceptance. |
| Restore/undo state and active checkpoint were not committed together; some file writes lacked the final lease check | P2 | Atomic completion transactions, checks immediately before rename/restore, deterministic lease-loss regressions. `checkpoint.test.ts`. |
| gh/SSH command timeout could leave helpers active | P2 | Bounded process wrapper, process-tree/group termination and bounded exit wait; real parent/child process tests. |
| Rebuilding temporary indexes discarded stat caches and could update the real index cache tree | P2 | Copy an opened index, preserve conservative timestamps, expand split-index only in the copy, expose assume/skip hidden changes. Real-index byte equality, racy-index, clean-filter and conflict tests. |
| A project without a checkpoint was still hashed for an unnecessary comparison | P2 | Use Git status until a checkpoint exists; avoid duplicate initial status calls. `project-status.test.ts`. |
| Undo after switching projects refreshed the wrong project; shelf read/refresh errors misrepresented results | P2 | Refresh the restore's project, explicit retry/error state and successful-operation handling. UI regressions. |
| Environment discovery had unbounded output; dependency installation had unbounded UI waiting | P2 | Drain both discovery streams with a byte/time cap; installation wait is capped at five minutes without killing an active MSI, and duplicate installs remain blocked until exit. Real Node fixture tests. |
| Business errors lost their code and health reported a stale hard-coded version | P2/P3 | Preserve typed DB errors; use package metadata as the health version source. Database/core regression tests. |
| No reproducible checked-in quality workflow | P2 | `pnpm check`, fixed-lockfile Windows/Linux CI, pinned action commits, read-only permissions, dependency audit and Windows desktop acceptance. Remote CI execution remains unverified. |

Initial concurrent validation detected the new restore-lease regression while the test runner still held the pre-fix module. The targeted regression passed after the fix; acceptance requires a fresh full run against the frozen final sources, not a combination of cached runs.

## Verification boundary

- Test data is isolated in temporary directories. The installed user application, its live projects, and real GitHub repositories were not modified by this audit.
- Large tracked repositories can reuse Git stat information; new/untracked content still needs to be read. This does not establish an unlimited capacity claim or prove the old real-project timeout has disappeared.
- The shared process wrapper's “unable to confirm every child has exited” fallback remains explicit; tests prove ordinary active parent/child termination, not every possible OS handle-retention case.
- A completed metadata deletion may leave a private orphan ref if the repository becomes inaccessible. The timeline remains correct and no active checkpoint loses its ref before a successful DB commit.
- Live GitHub login/push, in-place user installation upgrade, and remote Linux CI execution are not claimed by local fixtures.

Dependency repair references: [Electron advisory](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq), [brace-expansion advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [fast-uri advisory](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj), [HTTP cache advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). The package registry's repaired versions and a fresh audit result were also checked; the cache fix uses the published 4.3.0 release.

## Final score and validation

Environment: Windows x64, Node 24.18.0, pnpm 11.19.0, Git 2.55.0.windows.2, Electron 43.5.0. Baseline: `4ae33d0`; audited result: the source changes accompanying this report. Scores and validation gaps below describe the local acceptance boundary before publication. No confirmed unresolved P0/P1 findings remain from this review.

| Area | Control | Score | Evidence / remaining validation gap |
| --- | --- | ---: | --- |
| Correctness | Checkpoint/restore semantics | 5 | Real Git save, diff, restore, undo, shelf, EOL and conflict-preservation regressions. |
| Correctness | Project/UI state transitions | 5 | Deferred-operation core tests, 38 UI tests and desktop acceptance. |
| Correctness | Input/boundary contracts | 5 | Shared validation, real HTTP negative tests and illegal Electron IPC rejection. |
| Correctness | Truthful failure/success results | 5 | Typed DB errors, no duplicate completed operations after refresh failure, installer timeout/in-progress states. |
| Security | Renderer/IPC isolation | 5 | Production renderer-injection and untrusted-call desktop regressions. |
| Security | Filesystem/Git write boundaries | 5 | Index byte preservation, hard-link protection, conflict recovery and destructive-command tests. |
| Security | Credentials/verified remote transport | 4 | Scanner, real local SSH keys, effective SSH configuration and local Git transport tests pass; no live GitHub login/push acceptance. |
| Security | Dependency vulnerability check | 5 | Audit decreased from 30 findings to zero across all severities. |
| Reliability | Bounded work/large-repository behavior | 4 | Process termination, bounded installation waiting and stat-cache reuse tested; large untracked workloads and every OS pipe-retention case are not exhaustively validated. |
| Reliability | Concurrent-operation ownership | 5 | Cross-instance restore/undo claims, deletion serialization and lease-loss-before-write tests. |
| Reliability | Atomic persistence/recovery | 5 | Rollback, ref preservation, atomic restore/active-pointer updates and crash-recovery tests. |
| Reliability | Existing-data compatibility | 4 | Shared/legacy preference and registry tests pass; this revision has not been installed over the live user installation. |
| Test assurance | Build/types/lint | 5 | Full build including TypeScript and ESLint complete successfully. |
| Test assurance | Core/security regressions | 5 | Fresh full frozen-source run: 199 passing tests, zero failures, no unhandled test errors. |
| Test assurance | Desktop/CLI acceptance | 5 | Final-source Electron save→diff→restore→undo, first use/IPC and simulated GitHub UI: 3/3; built CLI smoke and CLI E2E pass. |
| Test assurance | Reproducible automated checks | 4 | Frozen-lockfile install, peer check, `pnpm check`, validated Windows/Linux workflow and pinned action commits; remote CI/Linux results are not claimed. |
| Maintainability | Module ownership/coupling | 5 | Independent review confirms typed component/module contracts; shared boundary validation and dedicated lifecycle/installer/process helpers. File size alone is not scored as a defect. |
| Maintainability | Structured diagnostics | 5 | Preserved domain error codes, bounded/redacted tool diagnostics and explicit uncertain-cleanup messages. |
| Maintainability | Consistent versions/configuration | 5 | Health version comes from package metadata; package manager pinned; lockfile/peer checks pass; lint excludes generated artifacts and prohibits explicit `any`. |
| Maintainability | Accurate documentation | 5 | Architecture, security boundaries, reproduction commands, evidence and residual limits updated. |
| **Total** | **Correctness 20 + Security 19 + Reliability 18 + Tests 19 + Maintainability 20** | **96/100** | **Four points retained for explicitly unverified boundaries.** |

The scoring application was independently reviewed. A large renderer file was not arbitrarily assigned a penalty to force an exact 95: it contains typed components with separate state, and the review did not establish a coupling defect. Splitting it further remains a maintenance option rather than evidence of a failed control.

| Final check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed without dependency changes. |
| `pnpm peers check` | No peer dependency issues. |
| `pnpm lint`, `pnpm build` | Passed; build includes TypeScript and CLI bundling. |
| `pnpm test --reporter=default --reporter=json --outputFile.json=test-results/engineering-tests-final.json` | **19 files passed; 199 passed, 3 skipped; 661.45 seconds.** Skips are Windows symbol-link capability cases. |
| `pnpm test:desktop` on final source build | **3/3 passed, 35.3 seconds.** Isolated Electron profiles and temporary project data; GitHub UI is simulated. |
| `pnpm test:cli-build`, `pnpm test:cli-e2e` | Passed: help/unregistered Hook, task-start/end, nested Hook and required-summary behavior. |
| `pnpm audit --json` | Zero info/low/moderate/high/critical findings. |
| Source freeze and diff check | 69 source/configuration files hashed for the final run; no changes during validation. Diff whitespace check passed. |

Local machine-readable evidence (excluded from Git): `test-results/engineering-tests-final.json`, `test-results/engineering-audit-before.json`, `test-results/engineering-audit-after.json`, `test-results/engineering-source-manifest.json`. Historical failing runs are retained separately; they are not counted as final passing evidence.
