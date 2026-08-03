---
description: Check local agy CLI availability and optional authentication smoke test.
argument-hint: "[--json] [--auth-check]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Run this command from the current workspace and return stdout verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup --stdin <<'AGY_ARGS'
$ARGUMENTS
AGY_ARGS
```

Do not modify files.
