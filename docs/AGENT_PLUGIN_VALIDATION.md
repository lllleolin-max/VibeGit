# Agent 插件验证记录

日期：2026-10-15（Asia/Shanghai）。插件版本：Codex 0.2.1，其他宿主 0.2.0。平台：Windows，Node.js 24.18.0。

图标更新：同日将 Codex 插件更新并重新安装为 0.2.1。输入框与插件列表的明暗主题图标均使用桌面端相同的 `vibegit-app-icon-rounded.png`（1254×1254、RGBA）。已核对安装缓存内四个图标引用的内容与原图完全一致，服务文件与已验收版本相同。随后完成下述独立桌面窗口全流程验收。

## 已完成的真实 Codex 链路

使用本机 Codex CLI 0.162.0-alpha.17.2 的官方插件命令添加 `vibegit-local` marketplace、安装 `vibegit`，查询结果为 `installed:true`、`enabled:true`。

随后启动真实 Codex 会话，要求通过已安装的 VibeGit 工具对当前项目存档。会话实际调用 `vibegit_save`，再调用 `vibegit_list_checkpoints` 核对编号，没有调用 shell 或推送工具。

| 字段 | 实测值 |
| --- | --- |
| 项目 | VibeGit 仓库工作区（绝对路径仅保留在本地验收证据） |
| 标题 | Agent 插件接入验收 |
| 存档编号 | `f0fa2e85-47d5-4271-a7d9-6dbbc1adda09` |
| 时间（UTC） | `2026-10-14T19:58:31.298Z` |
| Git 对象 | `601150efffa9dcd5246e8fc0d70e97ce7be10277` |
| 返回 | `ok:true`、`created:true` |
| 变更 | 91 个文件，新增 6702 行，删除 1922 行 |
| 分支与暂存区 | 保存前后 HEAD、`git ls-files --stage` 完全相同 |
| 桌面共享数据 | 独立 CLI 读取默认桌面数据目录，找到同一编号、标题、Git 对象和备注 |

CLI 会话证据保存在忽略目录 `test-results/agent-plugins/codex-save.jsonl`。此前真实 `vibegit_status` 调用也成功。这一轮验证了 Codex 官方安装启用、模型调用、真实存档及结果回读；桌面 `@` 选择器的后续验证见下节。

安装缓存的服务与本次构建产物 SHA-256 相同：

```text
2346CC6E26E3D2DF33033AD72C3346A62FE635FCDA48DF714BE63BDE53E15A1E
```

## 独立 Codex 桌面窗口全流程验收

通过应用的「文件 → 新建窗口」打开独立窗口，在当前项目输入框输入 `@VibeGit`，实际点选插件，再发送验收指令。已目视确认新 Logo 在插件选择列表和输入框提及标签中正常显示。会话标题为「VibeGit 桌面全流程验收」；保存时间为北京时间 `2026-10-15 04:33:35.448`。

| 步骤 | 实测结果 |
| --- | --- |
| 查看项目状态 | 保护已开启，有未存档变更，原有 5 条存档 |
| 第一次保存 | `ok:true`、`created:true`，标题为「Codex 窗口全流程验收」 |
| 查询历史 | 增至 6 条，新存档位于首位，标题和备注匹配 |
| 对比上一存档 | 4 个文件，新增 80 行、删除 3 行，差异未截断 |
| 无修改再次保存 | `ok:true`、`created:false`，返回同一存档 ID |
| 最终查询历史 | 仍为 6 条，两次历史列表完全一致 |

6 次真实 MCP 调用均成功；新存档编号为 `506e3702-b71b-4b4c-8bec-ef9fcf22fae4`，父存档为 `f0fa2e85-47d5-4271-a7d9-6dbbc1adda09`，Git 对象为 `5ef7eb5e60c3327f55102d49808dd1e9ad4d0848`。备注为「通过独立 Codex 桌面窗口点选 @VibeGit 完成端到端验收」。

独立核验从桌面默认数据源读到同一存档，确认 `metadata.source=mcp`；HEAD、`main` 分支、114 项 index stage entries 均与测试前一致。基线、前后存档列表和核验结果保存在忽略目录 `test-results/agent-plugins/window-e2e/`，其中 `verification.json` 为 `passed:true`。本轮未执行提交、推送、还原或删除；验收结束后仅补充本文档。

## 自动测试与边界

- 最终 `pnpm check` 退出码 0：lint、TypeScript、桌面/CLI/MCP/插件构建、22 个测试文件（226 通过、3 跳过）、CLI 构建与端到端验证、插件冒烟全部通过。全套单测耗时 409.53 秒；日志在 `test-results/agent-plugins/quality-check.log`。
- MCP 13/13：真实 Git/SQLite、实际 stdio 子进程、中文与空格路径、子目录、符号链接边界、未登记/未保护拒绝、重复存档、并发调用、恢复后的活动存档、租约释放竞态、关闭前完成保存、数据目录偏好、差异截断。
- GitEngine 23/23，含 7 个新增差异预算测试：生成补丁前限制文件数，字符预算耗尽后停止补丁命令，完整统计保持准确。
- 打包与安装 7/7：四平台产物、绝对路径配置、同名配置冲突保留、其他配置保留、目标重装拒绝、外部符号链接拒绝。
- 4 个技能通过 Skill Creator 校验器。
- 独立打包冒烟把四个插件复制到仓库外，按各宿主实际生成的启动配置解析命令、插件根路径与工作目录；检查握手/发现不创建数据库，并验证真实保存、去重、历史、差异、未登记拒绝、HEAD/index 保留与桌面服务回读。最后一次配置驱动的冒烟与其 ESLint 检查均通过。生成产物包含所打包依赖的许可证。
- `pnpm audit --audit-level=low`：无已知漏洞。修复 `source-map-js`，并对 `@electron/get@3.1.0` 定向使用保留 bootstrap API 的 `global-agent@4.1.3`；真实 HTTP 代理、NO_PROXY 和重复初始化兼容探针通过。

可复现命令：

```powershell
pnpm check
pnpm audit --audit-level=low
```

## 其他宿主

| 宿主 | 完成项 | 未覆盖项 |
| --- | --- | --- |
| Claude Code | 独立插件、`/vibegit:save`、官方 2.1.300 严格校验通过 | 登录后的 Claude 对话调用 |
| DeepSeek Harness | 官方 Cordis overlay、本地 MCP、`vibegit-save` 技能、协议联测 | 当前机器未检测到 dsh，未做 Harness 会话验收 |
| WorkBuddy | 本地 MCP 配置、安全合并安装器、技能、协议联测 | 当前机器未检测到宿主 CLI，未做 WorkBuddy 会话验收 |

上述三个适配包已经放入本机 `%LOCALAPPDATA%/VibeGit/agent-plugins/<host>-0.2.0`。没有修改尚未使用的宿主账号、登录状态或默认配置。配置和协议通过不等于这些宿主已完成真实对话验收。

## 社区宿主验收

Claude Code、DeepSeek Harness 和 WorkBuddy 当前开放试用，真实宿主会话状态保持「待验证」。安装方式分别见 [Claude Code](CLAUDE_CODE_INTEGRATION.md)、[DeepSeek Harness](DEEPSEEK_HARNESS_INTEGRATION.md) 和 [WorkBuddy](WORKBUDDY_INTEGRATION.md)。

1. 准备可正常对话的宿主和一个合成测试项目，在 VibeGit 桌面中添加项目并开启保护；按对应文档构建、安装和启用插件。
2. 在测试项目中修改一个普通文本文件，明确让 Agent 使用该项目的绝对路径查看 VibeGit 状态并存档。
3. 确认保存返回 `ok:true`、`created:true`；查询历史找到同一编号，再比较它与上一存档的差异。
4. 保持文件不变，再次保存应返回 `created:false` 和相同编号，历史数量不增加。
5. 在 VibeGit 桌面核对同一记录，并确认普通 Git 分支、HEAD 和暂存区保持不变。

请通过 [GitHub Issues](https://github.com/lllleolin-max/VibeGit/issues/new)提供操作系统、宿主与插件版本、Node.js/Git 版本、复现步骤及各步实际结果。错误日志请去掉令牌、密钥、私人路径和项目内容；不需要提供账号凭据。仅 MCP 握手成功不足以判定整个宿主验收通过。

## 当前功能范围

提供保存、状态、历史、差异四个工具，所有工具明确指定当前项目绝对路径。存档与桌面共用数据；项目需事先在桌面登记并开启保护。保存不改普通 Git 分支/暂存区，不自动推送。恢复、删除和 GitHub 推送没有暴露为本版 MCP 工具。旧 Codex/Claude 自动 Hook 模板保留为可选示例，本版手动插件不自动加载。
