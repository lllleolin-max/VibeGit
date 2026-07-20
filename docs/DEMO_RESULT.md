# Demo Result

运行日期：2026-07-12（Asia/Shanghai）

命令：

```powershell
pnpm demo
```

实际结果：

```json
{
  "projectInitialized": true,
  "gitRepository": true,
  "checkpointTypes": ["pre_restore", "pre_restore", "post_agent", "pre_agent", "initial"],
  "agentCheckpoint": {
    "agent": "codex",
    "taskText": "增加一个可见的功能开关",
    "changedFiles": ["src/app.ts"],
    "insertions": 2,
    "deletions": 1
  },
  "restorePreview": {
    "addCount": 0,
    "overwriteCount": 0,
    "removeCount": 0,
    "conflictCount": 1,
    "insuranceCheckpointCreated": true
  },
  "restoredToVersionOne": true,
  "undoRecoveredVersionTwo": true,
  "temporaryProjectRemovedAfterRun": true
}
```

说明：演示只在系统临时目录创建项目。它完成了初始化、Codex Agent 前后保存、文件统计、含冲突的安全回退、撤销回退和临时目录清理；未接触用户真实项目。
