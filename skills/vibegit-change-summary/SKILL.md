---
name: vibegit-change-summary
description: Mandatory workflow for every completed coding change in a project whose local .git/vibegit/protected.json marker enables vibegit-change-summary. After implementation and validation, before the final response, record a short plain-language VibeGit checkpoint summary.
metadata:
  vibegit-skill-version: 2
---

# VibeGit change summary

When a project contains `.git/vibegit/protected.json`, use this skill for every task that changes source code, project files, dependencies, configuration, or documentation. Do it after implementation and validation, immediately before your final response. It writes the explanation into VibeGit's local data directory; do not create or commit a summary file inside the user's project.

VibeGit's Hook detects this private marker and injects the requirement at task start. Do not create a summary for read-only work or a task that made no project-file changes.

## What to record

Write a JSON object to `vibegit summary --stdin` with:

- `projectPath`: the absolute current project path.
- `agent`: `codex` or `claude-code`.
- `sessionId`: include it when the Agent provides one.
- `summary.overview`: one plain sentence describing the user-facing outcome.
- `summary.added`, `summary.improved`, `summary.removed`: short arrays, up to 12 entries each. Describe features, not files, functions, packages, or line counts.

Example:

```json
{
  "projectPath": "D:\\projects\\my-app",
  "agent": "codex",
  "summary": {
    "overview": "Users can now sign in with an email verification code.",
    "added": ["Email verification code sign-in"],
    "improved": ["Clearer sign-in error messages"],
    "removed": []
  }
}
```

Pipe the JSON to:

```text
vibegit summary --stdin
```

## Rules

- Record the summary only after the implementation and validation are complete.
- Never include secrets, tokens, private customer data, or raw user prompts.
- Do not claim a feature is complete if tests or implementation failed; say what actually changed.
- The next VibeGit Agent-stop checkpoint consumes the newest matching summary and displays it in the beginner-friendly feature view.
