# Decisions

## D-001：引导式时间线而非 Git 面板

目标用户不理解 Git。主界面以任务、来源、保存状态、文件影响和自然语言动作组织；Git 标识仅留在内部诊断。

## D-002：hidden refs + 独立 index

保存点写入 `refs/vibegit/checkpoints/<id>`。临时 index 从真实 index 的 tree 开始，再对工作区执行 `git add -A`，随后 `write-tree`、`commit-tree`、`update-ref`。这样既不污染用户 index/HEAD，也不会丢掉“先暂存、后加入 ignore”的当前文件内容。未合并真实 index 时宁可安全失败，不猜测状态。

## D-003：Node 内置 SQLite

Electron 43（Node 24）主进程使用 `node:sqlite`，避免原生扩展 ABI 和重建风险。数据库只存元数据。该 API 仍会报告 ExperimentalWarning，因此 database package 隔离了运行时加载并由真实 CLI smoke 覆盖。

## D-004：Electron 构建兼容组合

固定 Electron 43.1、electron-vite 5、Vite 7.3、React plugin 5.2 与 TypeScript 6；pnpm 使用 hoisted node linker，满足 Electron 安装/运行需求。

## D-005：恢复工作树而不改写历史

恢复使用 Git 原生 worktree 操作，不执行 hard reset、不切分支、不改写用户普通提交或远程历史。预览建立保险点，冲突未跟踪文件移入 Git 私有恢复区，完成后可精确撤销。目标在暂存完毕后再次验证工作区，避免陈旧预览覆盖后续编辑。

## D-006：活动保存点是用户版本基线

`pre_restore`、`pre_sync` 和 shelf 的内部保存点用于保险，不应成为“当前版本”。项目显式保存 `active_checkpoint_id`；后续手动/Agent 保存的父级、无变化判断和 Diff 都以它为基线，使恢复或撤销后的时间线保持正确。

## D-007：跨进程恢复租约与崩溃调和

恢复/撤销 token 通过条件更新认领；项目级 SQLite lease 记录 owner UUID、PID 和到期时间。应用启动、领取新操作时都会调和已死亡或过期 owner 的执行记录为失败。恢复区路径在移动文件前写入数据库，因此中断后仍可由 UI 打开。

## D-008：统一 Agent 事件，而非绑定某个产品 Hook

先实现 `vibegit event --stdin`，再由 Codex/Claude Code Hook Adapter 转换事件。Hook 的 `cwd` 可以是已登记项目的子目录；任务结束没有文件变化时记录事件并在 UI 提示，不制造无意义保存点。

## D-009：GitHub 使用专用 remote 和安全导出链

VibeGit 用 `vibegit` remote，不动现有 `origin`。每次备份从扫描通过的树创建独立导出提交，父级只接前一个安全远程备份，再以非强制 refspec 推送 `vibegit-backup`。这避免本地历史里的旧敏感对象到达远程。

## D-010：Private 验证绑定实际传输目标

所有 gh 请求固定 github.com。同步校验 Private 后直接使用该 URL；检测 Git URL 重写配置和有效 URL 差异，拒绝可能改道的传输；push 禁用项目 pre-push hook。安全优先于支持本机的 URL rewrite 便利配置。
