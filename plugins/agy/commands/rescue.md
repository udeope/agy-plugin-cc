---
description: Delegate a rescue task to the agy rescue subagent.
argument-hint: "[--background] [--wait] [--write] [--continue] [--conversation <id>] [--dangerously-skip-permissions] <task>"
disable-model-invocation: true
allowed-tools: Task
---

Invoke the Agent tool exactly once with:

- `subagent_type`: `agy:agy-rescue`
- `description`: `agy rescue`
- `prompt`: `$ARGUMENTS`

Return the subagent output verbatim. Do not inspect files, do not run Bash directly, and do not summarize.
