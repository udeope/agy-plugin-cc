---
description: Ask agy for a stricter adversarial review of the current git changes.
argument-hint: "[--background] [--base <ref>] [extra instructions]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Run this command from the current workspace and return stdout verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" adversarial-review --stdin <<'AGY_ARGS'
$ARGUMENTS
AGY_ARGS
```

Do not modify files. Do not summarize the output.
