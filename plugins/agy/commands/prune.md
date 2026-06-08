---
description: Remove finished agy companion jobs and old logs past the retention window.
argument-hint: ""
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Run this command from the current workspace and return stdout verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" prune
```

Do not modify files.
