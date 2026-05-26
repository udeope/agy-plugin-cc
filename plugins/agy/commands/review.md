---
description: Ask agy to review the current git changes with staged, unstaged, untracked, and optional base-branch context.
argument-hint: "[--background] [--base <ref>] [extra instructions]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Run this command from the current workspace and return stdout verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" review "$ARGUMENTS"
```

Do not modify files. Do not summarize the output.
