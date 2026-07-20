# Acceptance Criteria

每个结论必须同时有源码路径和可重复运行的证据；所有自动化 Git 测试只使用系统临时目录。

| 场景 | 完成定义 | 证据位置 |
| --- | --- | --- |
| A：初始化 | 普通文件夹可添加、初始化 Git、产生初始保存点；已有 Git 子目录会安全拒绝 | `tests/checkpoint/checkpoint.test.ts`、桌面 E2E |
| B：手动保存 | 修改后可创建保存点、看到文件/增删统计和逐行 Diff | `tests/checkpoint/*`、`tests/ui/app.test.tsx`、桌面 E2E |
| C：Agent | task-start/pre-agent、task-end/post-agent、任务文本/Agent/session 关联正确；无变化事件可见 | `tests/agent-events/*`、UI 回归、CLI E2E |
| D：安全回退 | 影响预览、保险点、恢复、撤销、未跟踪/忽略/目录/符号链接保护、失败恢复区、并发与崩溃调和 | `tests/checkpoint/*` |
| E：GitHub Private | `gh` 缺失/未登录状态、显式 Private 创建、连接校验、专用 remote、非强制安全导出 push | `tests/github/*` |
| F：敏感阻断 | `.env`、token、UTF-16 凭据、LFS、数据库、依赖/构建目录、大文件都阻断且不删除本地文件 | `tests/security/*` |
| G：运行质量 | 无类型/ESLint 错误，构建产物 CLI 可运行，Electron 无白屏且完成保存→Diff→恢复→撤销 | `pnpm` 验证命令、`tests/desktop/*` |

最终验收命令：

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:cli-build
pnpm test:cli-e2e
pnpm test:desktop
pnpm demo
```

`docs/FINAL_VALIDATION.md` 在最终运行后记录实际退出码、测试数量、产物和演示结果。没有通过该清单的功能不能标记为已验证。
