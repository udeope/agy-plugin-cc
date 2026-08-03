---
description: Print the result of an agy companion background job.
argument-hint: "<job-id>"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Run this command from the current workspace and return stdout verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" result --stdin <<'AGY_ARGS'
$ARGUMENTS
AGY_ARGS
```

Do not modify files.
