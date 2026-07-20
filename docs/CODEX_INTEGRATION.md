# Codex Integration

## 本机核实与边界

- 本机已检测到 Codex Desktop AppX；本轮项目不把它的内部认证、transcript 或用户配置读取进 VibeGit。
- Codex Hook 的 `UserPromptSubmit` 映射为 `task-start`，读取 `cwd`、`session_id`、`turn_id`、`prompt`。
- `Stop` 映射为 `task-end`。它表示一轮响应结束，不被伪装成 `success=true`。
- Hook `cwd` 可以是已登记项目根的子目录；VibeGit 会归属到该项目根。未登记、未开启保护或已经消失的目录安全跳过，避免影响 Agent。

## P0 可运行接口

构建后，任何符合统一事件模型的发送方都可运行：

```powershell
Get-Content event.json | node dist/cli/index.js event --stdin
Get-Content codex-hook.json | node dist/cli/index.js hook codex --stdin
```

`event.json` 示例：

```json
{
  "event": "task-start",
  "agent": "codex",
  "projectPath": "C:/path/to/project",
  "sessionId": "optional-session-id",
  "taskText": "增加邮箱验证码登录",
  "timestamp": "2026-07-11T08:00:00Z"
}
```

## P1 Hook 模板

模板在 `integrations/codex/vibegit`，已通过本地 Codex 插件 validator。它调用位于 PATH 的 `vibegit hook codex --stdin`；当前源码 MVP 仍需要 Node 来运行 `dist/cli/index.js`，尚不是面向普通用户的自包含安装器。

安装前应将最终可执行文件加入 PATH，经 marketplace 安装插件后在 Codex `/hooks` 审核并信任命令。不要把 `--dangerously-bypass-hook-trust` 当作常规安装流程。

安全边界：prompt 只经 stdin 接收并脱敏，事件按 `(agent,event,turn_id)` 去重，不读取 Codex 凭据。

依据：[Codex Hooks](https://developers.openai.com/codex/hooks)、[Codex Plugins](https://developers.openai.com/codex/plugins/build)。
