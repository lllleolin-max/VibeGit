# Claude Code Integration

## 本机状态

当前 Windows、PATH、用户配置目录和 WSL 中均未检测到 Claude Code。因此不能声称已完成实机安装、`claude plugin validate --strict` 或 Hook smoke test。

## 事件映射

- `UserPromptSubmit` → `task-start`，读取 `cwd`、`session_id`、`prompt`、可选 `prompt_id`。
- `Stop` → `task-end`，成功状态保持未知。
- `StopFailure` → `task-end` 且 `success=false`。
- 若 Claude 从已登记项目的子目录运行，VibeGit 会定位项目根；其他目录快速安全跳过。

## P0 可运行接口

```powershell
Get-Content event.json | node dist/cli/index.js event --stdin
Get-Content claude-hook.json | node dist/cli/index.js hook claude-code --stdin
```

统一 CLI 负责任务文本脱敏、Agent/session 关联、幂等和保存点逻辑；模板不直接执行 Git。

## P1 模板与安装

模板位于 `integrations/claude-code/vibegit`，使用 exec form：`command: "vibegit"` 与参数数组 `['hook','claude-code','--stdin']`。Windows 上必须提供真实 `.exe`；npm `.cmd` 不应被当作最终 Hook 可执行文件。

在提供可执行文件且安装 Claude Code 后，再执行：

```powershell
claude plugin validate integrations/claude-code/vibegit --strict
claude --plugin-dir integrations/claude-code/vibegit
```

永久安装应通过 marketplace：`claude plugin marketplace add <root>`，再执行 `claude plugin install vibegit@<marketplace> --scope user`。

依据：[Claude Hooks](https://code.claude.com/docs/en/hooks)、[Claude Plugin Reference](https://code.claude.com/docs/en/plugins-reference)。
