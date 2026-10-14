# WorkBuddy Integration

本适配器面向腾讯 WorkBuddy，使用其本地 MCP 配置和技能导入能力。与 Codex 使用同一套 VibeGit 服务，不要求 WorkBuddy 使用 `@` 入口。

## 构建与配置

需要本机 Node.js 24+、Git、WorkBuddy，以及已在 VibeGit 桌面端登记并开启保护的项目。在 VibeGit 仓库执行：

```powershell
pnpm build:plugins
node scripts/install-agent.mjs workbuddy --destination "$env:LOCALAPPDATA\VibeGit\plugins\workbuddy-0.2.0"
```

安装器生成 `mcp.json`，其中 `mcpServers.vibegit` 使用实际 Node 和服务脚本的绝对路径。打开 WorkBuddy“插件 → MCP 服务器 → 配置 MCP”，将该条目合并进现有配置并启用，保留其他服务。WorkBuddy 官方支持用户级 `~/.workbuddy/mcp.json` 和项目级 `<项目目录>/.workbuddy/mcp.json`。

也可以让安装器把条目合并进你指定的配置文件。以下命令是上面的替代安装方式，目标目录仍须不存在：

```powershell
node scripts/install-agent.mjs workbuddy --destination "$env:LOCALAPPDATA\VibeGit\plugins\workbuddy-0.2.0" --config "$HOME\.workbuddy\mcp.json"
```

合并会保留其他服务；同名 `vibegit` 冲突会报错，不静默替换。服务默认共享桌面端的数据目录。若使用自定义数据目录，在该服务器的 `env` 中配置与桌面端相同的 `VIBEGIT_DATA_DIR`。移动插件目录后重新生成配置。

## 技能与调用

在 WorkBuddy 的“技能 → 添加技能 → 上传技能”中导入安装目录内的 `skills/vibegit-save` 技能包。按客户端文件选择器接受的包格式导入；此适配器提供标准的 `SKILL.md` 文件夹。MCP 和 Skill 分别启用，仅导入技能不会启动 MCP。

```text
用 VibeGit 给当前项目存档一次，备注：登录功能完成。
用 VibeGit 列出当前项目最近 5 次存档。
用 VibeGit 比较最近两次存档。
```

工具为 `vibegit_status`、`vibegit_save`、`vibegit_list_checkpoints` 和 `vibegit_diff`，均要求绝对 `projectPath`。技能使用真实本地工作区；云端会话必须另有本地执行能力才能访问桌面项目。安装插件不会把本地文件自动上传到云端。

## 验证范围

共享服务由 `pnpm test:plugins` 做协议和存档联测。WorkBuddy 中还应检查 MCP 连接成功、实际调用存档工具，并用返回的存档 ID 在历史和桌面端核对。配置生成不能代替 WorkBuddy 的真实会话验收。

启动时不会自动存档；本版不启用 Hook，不提供恢复、删除或 GitHub 推送功能。

官方依据（核对日期：2026-10-15）：[MCP 配置](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)、[技能导入](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)、[插件类型](https://www.codebuddy.cn/docs/workbuddy/Plugins)。
