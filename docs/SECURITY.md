# Security

## 本地 Git 与文件安全

- Git 和 `gh` 都以参数数组启动，固定工作目录、超时和输出上限，不使用 shell 拼接。
- Git 子进程清除继承的 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、对象库、SSH/AskPass、外部 diff 和环境注入配置；内部临时 index 仅显式传入自己的 `GIT_INDEX_FILE`。
- 默认拒绝 `reset --hard`、所有 `clean`、force/删除 push、全局/系统 Git config 写入和会删除工作区的 `git rm`。
- 只能登记 Git 根目录；选择已有仓库的子目录会被拒绝，防止保存点或恢复跨越用户选择的范围。
- 保存点用独立 index + hidden ref 构造，真实 HEAD、分支和 index 不被改写。
- 恢复使用 Git 原生 `restore` / `checkout-index`，尊重 EOL、属性与过滤器；在预览、暂存目标后均重验分支、index、活动保存点和工作区树。
- 恢复前创建、读取并验证保险点。未跟踪文件绝不直接删除；名称冲突的文件或目录先进入 Git 私有 `vibegit/recovery`。
- 恢复区清单逐项记录类型、模式、哈希和移动状态；撤销前复核哈希。悬空符号链接以 `lstat` 识别，仍可从恢复区取回。
- 创建恢复目录后立即持久化路径；异常、崩溃或 owner 进程消失后，应用会将执行记录调和为失败并提供“打开恢复区”。
- 恢复 token 以 SQLite 条件更新原子认领。保存、恢复、撤销、暂时收起和取回同时受项目队列与数据库租约保护；租约记录 owner PID，避免进程退出后长期假锁。

## Agent 与 IPC

- Hook 只处理已登记并已开启保护的项目；子目录 `cwd` 会归属到最深的已登记项目根。
- Agent 事件按 `(project, agent, session)` 关联 task-start；source event ID 幂等去重，任务文本先脱敏后保存。
- Hook 对未登记、未开启保护或已消失的工作目录安全跳过并输出 `{}`，不阻塞 Agent；手工 `event` 命令仍返回严格错误。
- Renderer 无 Node/文件系统权限。preload 仅公开类型化 API，Main 仅接受主窗口主 frame 的精确本地 URL。

## GitHub 私有备份

- `gh` 调用固定 `GH_HOST=github.com`，状态和用户 API 明确指定 `github.com`；不信任环境中的 Enterprise host 重定向。
- 创建仓库始终传 `--private`，创建/连接/每次 push 前都验证 Private 可见性。
- 使用专用 `vibegit` remote，绝不静默改写用户的 `origin`。
- 备份前扫描敏感路径、UTF-8/UTF-16 文本密钥、凭据、数据库、依赖/构建目录、LFS 指针和超过 10 MB 的文件；发现风险即阻断且不删除本地文件。
- “加入 `.gitignore`”只接受主进程重新扫描得到的根锚定字面规则，不信任 Renderer 提供的规则。
- push 使用已验证的精确 URL，而非可变 remote alias；适用的 `url.*.insteadOf` / `pushInsteadOf` 或有效 URL 不一致会失败关闭。push 带 `--no-verify`，不运行项目的 pre-push hook。
- 远程提交从已扫描树重新 `commit-tree`，父级只允许上一次安全远程快照，故本地保存点的旧父链（包括已移除的敏感文件）不会被带上远程。

## 残余边界

VibeGit 无法强制停止不合作的编辑器或 Agent 在文件系统层同时写入；它在目标暂存后再次校验，并在任何不一致时停止。极窄的操作系统级写入竞争仍应通过关闭自动编辑、等待当前 Agent 停止或重新预览来规避。Windows 符号链接创建受系统权限限制，因此该分支的自动回归在 Windows 跳过、在 POSIX 环境执行。
