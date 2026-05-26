---
description: Runtime contract for the agy CLI companion used by the agy Claude Code plugin.
disable-model-invocation: true
---

# agy CLI Runtime

The plugin delegates to `scripts/agy-companion.mjs`, which wraps the local `agy` executable.

Read-only work uses `agy --print ... --sandbox`. Write work removes `--sandbox` only after trusted-workspace validation. The wrapper never passes `--dangerously-skip-permissions` unless the user explicitly provided that flag.

Background jobs are stored under `${CLAUDE_PLUGIN_DATA}/jobs/<workspace-hash>/`.
