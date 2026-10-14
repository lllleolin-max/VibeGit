# DeepSeek Harness Integration

本适配器使用 DeepSeek 官方 Harness 的 `@deepseek-ai/dsh-mcp-client`，将同一套 VibeGit 本地服务暴露为 Agent 工具。这里的配置是 Cordis overlay，不是 Codex 或 Claude 的 `.mcp.json`。

## 构建与加载

需要本机 Node.js 24+、Git、DeepSeek Harness，以及已在 VibeGit 桌面端登记并开启保护的项目。在 VibeGit 仓库执行：

```powershell
pnpm build:plugins
node scripts/install-agent.mjs deepseek-harness --destination "$env:LOCALAPPDATA\VibeGit\plugins\deepseek-harness-0.2.0"
dsh web --patch "$env:LOCALAPPDATA\VibeGit\plugins\deepseek-harness-0.2.0\vibegit.cordis.yml"
```

安装器生成的 overlay 包含一个 `insert`，注册名为 `vibegit` 的 stdio MCP 客户端，使用实际 Node 可执行文件和服务脚本的绝对路径。安装器不会覆盖现有 Harness 配置。持久启用时可把这一条补丁合并进 `$DSH_HOME/cordis.patch.yml` 或指定 profile 的补丁文件；保留其他条目。

服务默认共享桌面端的数据目录。若使用 `VIBEGIT_DATA_DIR`，应在启动 Harness 前设置相同的值。移动插件目录后重新生成 overlay，不能继续使用旧绝对路径。

## 技能与调用

MCP 本身已能用自然语言调用。需要 `/vibegit-save` 入口时，把安装目录的 `skills/vibegit-save` 文件夹复制到 Harness 已配置的技能目录，例如 `$DSH_HOME/skills`；未设置 `DSH_HOME` 时为 `~/.dsh/skills`。若目标中已有同名技能，先检查内容，避免覆盖自定义版本。该入口要求当前 Harness composition 已启用技能发现和技能工具。

```text
用 VibeGit 给当前项目存档一次，备注：登录功能完成。
/vibegit-save
用 VibeGit 查看当前项目最近 5 次存档。
```

工具在 Harness 中使用 `mcp__vibegit__` 前缀，原始名称为 `vibegit_status`、`vibegit_save`、`vibegit_list_checkpoints`、`vibegit_diff`。技能从实际工作区或用户给出的绝对路径解析 `projectPath`；不把安装目录或 MCP 的启动目录当成项目。

## 验证范围

共享服务由 `pnpm test:plugins` 做协议和存档联测。首次接入 Harness 时，检查四个工具均被发现，保存后取得真实存档 ID，再从历史和桌面端核对。启动、握手探测和工具发现不会自动创建存档。

本适配器不依赖 MCP prompts、elicitation 或 Harness Hook，且不提供恢复、删除或 GitHub 推送。尚未进行登录后的真实 Harness 会话验收时，不把配置生成或协议联测称为宿主端已验收。

官方依据（核对日期：2026-10-15）：[MCP 客户端字段](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)、[overlay 加载](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/mcp-memory.md)、[技能目录](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)。
