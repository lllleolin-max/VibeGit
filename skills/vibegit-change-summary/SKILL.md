---
name: vibegit-change-summary
description: After completing a coding task in a VibeGit-protected project, record a short plain-language summary so non-programmer users can understand the saved checkpoint.
---

# VibeGit change summary

Use this skill after you have completed a meaningful coding task and before your final response. It writes the explanation into VibeGit's local data directory; do not create or commit a summary file inside the user's project.

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
