# VibeGit 产品审查与优化记录

审查日期：2026-09-15（Asia/Shanghai）。范围为当前工作区源码、依赖锁文件、浏览器兼容模式、CLI、Electron 与 Windows 打包产物。开始审查时工作区干净；未提交或推送代码，未操作真实 GitHub 仓库。

## 结论

产品的核心价值和主要界面层级清楚，最需要加强的是“保存、预览、恢复、备份状态可信”这一承诺。本轮保留现有视觉方向，直接修复可复现的数据恢复、安全边界和交互问题，并更新有已知漏洞的构建/测试依赖。

四条并行审查线覆盖核心恢复、GitHub/Agent 集成、桌面交互和交付工具；关键安全修改另经独立复核。修复前的原有测试为 80 通过、1 跳过，说明这些边界原先并未被测试覆盖。

## 已落实的修复

P1 表示可能改变用户文件、泄漏凭据、破坏保护闭环或误导安全判断；P2 表示功能准确性、可用性与交付问题。依赖告警等级沿用审计源，不等同于已证明产品运行时可被利用。

| 优先级 | 问题与触发方式 | 现在的行为 | 主要位置 |
| --- | --- | --- | --- |
| P1 | 草稿文件替换基准目录后“暂时收起”，清理步骤会再次移走刚恢复的稳定目录。 | 保护基准文件及其父目录；用路径集合避免逐文件反复遍历基准树。 | `packages/checkpoint-engine` |
| P1 | 撤销恢复时，忽略文件的唯一恢复副本已损坏或缺失；原逻辑先覆盖工作区才报错。 | 在修改工作区前验证所有此类恢复副本，失败时保持当前文件及可重试状态。 | `packages/checkpoint-engine` |
| P1 | SSH 数据目录包含 `$()`、反引号或单引号，传给 Git shell 的双引号不能阻止展开。 | 使用正确的 shell 参数引用，并验证带空格及特殊字符的路径。 | `packages/github-provider` |
| P1 | `.gitignore` 是项目外文件的硬链接或符号链接，“加入忽略列表”会修改链接目标。 | 拒绝链接和非普通文件，通过同一已验证文件句柄读取与追加。 | `packages/github-provider` |
| P1 | 上传扫描漏掉 JSON 引号键、`github_pat_` 及加密 PEM 私钥。 | 扩充识别规则，风险仍在上传前阻断，测试使用合成凭据。 | `packages/github-provider`、`tests/security` |
| P1 | 摘要、错误中的引用密码、Bearer/Basic、加密或被截断的私钥可能未被脱敏。 | 处理带空格/转义/未闭合的凭据文本，先处理认证头，摘要入盘及读取均验证与脱敏。 | `packages/shared`、`packages/agent-events` |
| P1 | 创建保存点失败前，Agent 的功能摘要已被删除，重试无法关联说明。 | 事件持久化成功后再消费摘要，并清理同一会话的旧提交。 | `packages/agent-events` |
| P1 | 桌面更换本地记录位置后，CLI/Hook 仍使用默认数据库。 | 桌面和 CLI 共享配置入口，兼容旧目录名称，保留环境变量优先级；原子保存偏好，不搬移历史数据。 | `packages/core`、`apps/desktop/src/main` |
| P1 | 快速切换项目、保存点或关闭详情时，旧异步请求可能回写到新界面。 | 按请求和所属项目隔离结果，加载/失败/重试状态明确，关闭后丢弃旧 Diff。 | `apps/desktop/src/renderer/App.tsx` |
| P1 | GitHub 检查失败被显示成“未发现风险”，错误回调变化还会触发重复请求。 | 失败时明确显示“安全检查未完成”，隐藏可继续备份的正常状态，只在主动重试后重新检查。 | `BackupModal`、`ShelfModal` |
| P1 | 尚未开启保护且没有未保存标记的项目显示绿色“已保存”。 | 项目卡片和侧栏明确显示“尚未开启版本保护”。 | `ProjectCard`、`Sidebar` |
| P2 | 重命名恢复预览漏报旧 tracked 路径删除；`[id].txt` 被当成 Git 通配路径，Diff 混入其它文件。 | 预览展开重命名两端；Diff 使用字面路径并包含旧、新文件名。 | `packages/checkpoint-engine`、`packages/git-engine` |
| P2 | 弹窗缺少焦点约束，操作执行中仍可关闭；菜单键盘导航不完整。 | 增加焦点进入/恢复、Tab 循环、Escape 和方向键；执行期间禁用关闭及冲突操作。 | `ModalFrame`、`useDialogFocus`、`CheckpointActions` |
| P2 | 没有功能摘要时，查看实际变化需要退出详情去设置切换；Diff 失败也可能像“没有变化”。 | 详情直接切换功能/代码视图，失败提供重试；新提示补充英文。 | `CheckpointDrawer` |
| P2 | 浏览器 API 用 `in` 校验方法名，接受原型属性；不支持的桌面操作返回假成功。 | 使用自有属性白名单并校验请求对象；目录和窗口操作明确报不支持，连接失败提供恢复步骤。 | `scripts/browser-server.ts`、`browser-api.ts` |
| P2 | gh/SSH 子进程输出没有内存上限。 | 标准输出与错误输出合计超过 4 MiB 时中止并返回结构化错误。 | `packages/github-provider` |
| P2 | `.cmd` 启动器绑定开发者电脑路径，另一入口也缺少明确环境检查。 | 两个入口共用 PATH，检查 Node.js 24+、Git、pnpm 和已安装依赖；中文及空格路径经过启动冒烟验证。 | `启动 VibeGit.bat`、`启动 VibeGit.cmd` |
| P2 | 七种语言 README 的介绍、备份、部署内容重复，中文能力导航锚点无对应标题。 | 删除重复段落，保留完整编号上手步骤、Skill 说明及开发者构建入口，修正中文能力标题。 | 七份 `README*.md` |
| P2 | 依赖审计有 41 条告警：27 high、13 moderate、1 low。 | Vitest 更新至 4.1.11，锁定受影响间接依赖的修复版本；最终审计为 0 条告警。 | `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` |

## 验证与产物

- 最终全套回归：13 个文件、123 项通过、2 项 Windows 平台相关跳过，耗时 309.27 秒；打包后的真实桌面验收 2/2 通过。
- `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm peers check`、`pnpm build` 均通过。
- `pnpm test:cli-build` 和 `pnpm test:cli-e2e` 通过：构建后的 CLI 可处理未登记 Hook、子目录归属、任务前后保存点及摘要保护。
- Electron 的保存→Diff→恢复→撤销、恶意 Renderer URL 拒绝、首次添加项目并开启保护流程均通过。测试增加独立 Electron profile 断言，避免复用用户的界面偏好和单实例锁；同一套测试支持核验打包后的可执行文件。
- Windows NSIS 安装包已在 `release-audit/VibeGit-Setup-1.0.0-x64.exe` 生成，构建使用 `--publish never`，并附 SHA-256 校验文件。实际签名状态为 `NotSigned`；未执行安装、卸载或外部发布。
- 实际复核了首次启动、项目时间线、Diff 和恢复完成截图。图像位于 `test-results/vibegit-*.png`；自动化 traces 单独放在 `test-results/desktop-traces`，避免清理其它验证产物。
- 最终全套测试结果及打包应用验收见 [最终验证记录](FINAL_VALIDATION.md)。

环境故障处理：重新安装依赖后 Electron 懒下载失败。使用本机已有的 43.1.0 官方发行缓存，与已安装 npm 包 `checksums.json` 的 SHA-256 完全比对后恢复；没有跳过校验或改用未知二进制。

## 依赖修复依据

锁文件审计来自本次 `pnpm audit --json`。Vitest 的修复版本与适用范围已对照 [维护者公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)；esbuild 覆盖依据为 [Windows 开发服务器文件读取公告](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr)。

多数告警属于构建、测试或打包依赖，本轮没有证据证明它们都能通过已发布桌面产品触发。受影响的 esbuild 0.27.x 被定向覆盖为 0.28.1，并用 CLI/Electron 构建验证；其它安全覆盖限定在现有版本分支。Squirrel 的 `electron-winstaller` 构建脚本明确禁用，本产品使用 NSIS。

## 后续优先级与验收边界

| 顺序 | 事项 | 建议验收标准 |
| --- | --- | --- |
| 1 | 真实 GitHub 授权与跨设备恢复演练 | 在用户指定测试账号/私有仓库完成授权、备份、重新获取和内容比对。本轮未进行任何真实 GitHub 授权或上传。 |
| 2 | 外部 Agent 修改后的状态自动刷新 | 当前主要依赖手动刷新/重新选择项目。后续增加窗口恢复焦点刷新或受控订阅，并以大项目 CPU/IO 和状态延迟实测决定策略。 |
| 3 | 国际化与可访问性 | 当前翻译仍依赖 DOM 文本替换；进一步统一组件文案源，补齐非英文语言动态文案、200% 缩放、高对比度和屏幕阅读器人工验收。已有键盘回归不等于完整 WCAG 验证。 |
| 4 | 大项目性能基准 | 针对大工作树、长时间线、大 Diff 测量 p95 延迟及内存后，再决定缓存、并发读取或虚拟列表；本轮未把未测量的性能建议当作已实现收益。 |

外部编辑器在恢复操作中持续写入的操作系统级竞争仍属于既有边界；Windows 未实际执行需要 POSIX 符号链接权限的分支。安装包仍使用项目原版本号 1.0.0，属于本地审查构建，正式发布应经过版本号、签名和目标机器安装验收。
