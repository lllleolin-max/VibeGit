# Final Validation

## 2026-09-16：1.0.1 GitHub 私有备份修复与当前用户升级

本轮补齐已有仓库地址到应用专用 SSH 传输的规范化、设备授权码与进度、密钥撤销后的修复入口，以及推送失败状态。项目列表先快返，再检查选中项目；后台检查在事务中保留新的连接/推送结果，并避免复活已移除项目。功能与限制详见 [GITHUB_PUSH_1.0.1.md](GITHUB_PUSH_1.0.1.md)。

| 命令/验收 | 实际结果 |
| --- | --- |
| `pnpm build`、`pnpm lint` | 均通过。 |
| `pnpm test` | 15 个文件通过：155 passed、2 skipped；两个跳过项为 Windows 符号链接分支。 |
| 真实打包桌面 E2E | 3/3 通过，31.3 秒；GitHub UI 使用模拟 IPC，不属于真实 GitHub 网络验证。 |
| CLI 构建烟测与 E2E | 均通过。 |
| 当前用户覆盖升级 | 2026-09-16 19:12:41 +08:00 完成，安装器退出码 0；保留原安装目录。 |
| 安装包内容核对 | 已安装 `resources/app.asar` 与最终打包内容 SHA-256 完全一致：`800B45E4F385CBCB06F46091C9B0CB81502A42C0BEAA0BD9206E1BAAE4E51DC5`。 |
| 用户数据完整性 | SQLite integrity 为 `ok`；与升级前逻辑全表完全一致，保留 3 个项目、9 个保存点。 |
| 升级备份 | 已在本机独立备份应用数据及旧程序，62 个文件校验一致；备份不包含在公开发布中。 |

最终安装包：`release-github/VibeGit-Setup-1.0.1-x64.exe`，106,170,597 字节；SHA-256 为 `e953e24599aff340649080a438252b2b03e7468dbd0a4b6cd56821f7477bf79d`。未签名，发布前已完成上述验收；发布状态见 [GitHub Releases](https://github.com/lllleolin-max/VibeGit/releases)。

本轮未执行 VibeGit 应用内的真实 GitHub 授权、远程创建或联网推送，也未验收应用内云端恢复。已打开实际安装的 1.0.1，核对项目列表与已有时间线、桌面快捷方式和用户数据目录偏好；启动后数据库逻辑全表仍与升级前一致。一个大型项目的工作区检查仍失败：独立诊断复现临时索引快照 `git add -A -- .` 超过 60 秒，普通 Git 状态读取正常，已有保存点可见；这项大项目快照耗时限制尚未解决。下方保留历史构建的验收与当时限制，不代表 1.0.1 尚未安装。

## 2026-09-15：全产品审查构建

环境：Windows x64、Node.js 24.18.0、pnpm 11.19.0、Electron 43.1.0、Vitest 4.1.11。完整问题与修复见 [产品审查记录](PRODUCT_AUDIT_2026-09-15.md)。

| 命令/验收 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过；安全修复已进入锁文件。 |
| `pnpm lint`、`pnpm typecheck` | 均通过。 |
| `pnpm peers check` | 通过；无 peer dependency 问题。 |
| `pnpm audit --json` | 0 info / low / moderate / high / critical；本轮修复前为 41 条告警。 |
| `pnpm build` | 通过；构建了最终 Electron main/preload/renderer 和 CLI。 |
| `pnpm test` | 13 个文件全部通过：123 passed、2 skipped，309.27 秒。两个跳过项为 Windows 下的符号链接分支；基线为 80 passed、1 skipped。 |
| `pnpm test:cli-build` | 通过；帮助命令与未登记 Hook 冒烟。 |
| `pnpm test:cli-e2e` | 通过；子目录 Hook、任务前后保存点和缺摘要保护。 |
| 源码构建 Electron E2E | 保存→Diff→恢复→撤销通过；首次使用/恶意 Renderer URL 测试在精确匹配新文案后通过。 |
| 打包后的 `VibeGit.exe` 运行 `pnpm test:desktop` | 2/2 通过，22.9 秒；同样覆盖首次使用和保存/恢复闭环，确认 profile 与真实用户隔离。 |
| `pnpm exec electron-builder --win nsis --publish never --config.directories.output=release-audit` | 通过；生成 106,166,283 字节 Windows x64 安装包。 |
| `git diff --check` | 通过。 |

产物：`release-audit/VibeGit-Setup-1.0.0-x64.exe`。SHA-256：`19f3a6721a5e33e23aa0767d5e82665bbf2de339aa4f3c15a686c9754c5ae6e5`，旁边提供 `.sha256` 文件。实际 Authenticode 状态为 `NotSigned`，没有安装、卸载、签名发布或上传 GitHub。

测试截图位于 `test-results/vibegit-*.png`；最终单元/集成回归日志位于 `test-results/full-regression.log`；依赖审计 JSON 位于 `test-results/dependency-audit.json`。Playwright trace 目录独立为 `test-results/desktop-traces`。

首次桌面测试因 Electron 懒下载网络失败未能启动，随后使用同版本官方缓存并按 npm 包内 SHA-256 校验恢复运行时，再完成验收。未采用未知来源二进制或关闭校验。

尚未验证：真实 GitHub 浏览器授权/私有仓库推送/异机恢复、安装器安装卸载、POSIX 符号链接分支和完整辅助技术人工测试。

## 2026-07-23 更新

本次发布前复核已完成以下命令：

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint` | 通过；0 warning / 0 error。 |
| `pnpm build` | 通过；Electron 主进程、preload、renderer 和 CLI 均完成构建，并已打包 VibeGit 品牌素材。 |
| `pnpm exec vitest run tests/ui/app.test.tsx` | 通过：7/7；覆盖文件夹选择兼容提示与一键 GitHub/SSH 授权入口。 |
| `pnpm exec vitest run tests/github/github-provider.test.ts tests/git-engine/git-engine.test.ts` | 通过：19/19；覆盖专用 SSH 传输和 GitHub Provider 安全边界。 |

完整回归套件与桌面 E2E 应在发布机器上作为发布门禁继续执行；它们涉及真实 Electron 启动和较长的 Git 安全场景。

运行日期：2026-07-12（Asia/Shanghai）。所有命令在工作区根目录执行。

| 命令 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过；依赖已锁定且无需变更。 |
| `pnpm peers check` | 通过；无 peer dependency 问题。 |
| `pnpm lint` | 通过；0 warning / 0 error。 |
| `pnpm typecheck` | 通过。 |
| `pnpm test` | 通过：8 个 test files，58 passed，1 skipped（Windows 符号链接权限分支）。耗时约 443 秒。测试串行化，避免故意修改进程级 Git/GitHub 环境变量的安全用例互相干扰。 |
| `pnpm build` | 通过；重新生成 `out/main`、`out/preload`、`out/renderer` 与 `dist/cli/index.js`。 |
| `pnpm test:cli-build` | 通过；帮助命令与未登记/不存在目录的 Hook 安全跳过均输出 `{}`。 |
| `pnpm test:cli-e2e` | 通过；真实构建 CLI 创建 start/end 保存点，并验证从已登记项目子目录运行的 Hook。 |
| `pnpm test:desktop` | 通过：2/2；构建后的 Electron 完成保存→Diff→恢复→撤销，并拒绝恶意 `ELECTRON_RENDERER_URL`。 |
| `pnpm demo` | 通过；见 [DEMO_RESULT.md](DEMO_RESULT.md)。 |

桌面截图已在 `test-results/` 生成并人工复核：首次启动、项目时间线、Diff 抽屉、恢复/撤销及通过文件夹选择器添加项目。设计结论见 `design/qa.md`。

外部条件：本机 Git 2.55 可用；`gh` 与 `claude` 未安装，因此没有执行真实 GitHub 浏览器授权或 Claude Code plugin CLI smoke。Codex Desktop 已安装，但当前普通 shell 对其 AppX 内置 CLI 的执行被 Windows 拒绝；P0 统一 CLI 与 Hook 模板均已通过本地测试，真实安装器仍为 P1。
