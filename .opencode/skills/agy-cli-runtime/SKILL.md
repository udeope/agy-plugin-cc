---
name: agy-cli-runtime
description: Delegate setup, review, adversarial review, rescue, and background job workflows to the local agy CLI.
compatibility: opencode
---

# agy CLI Runtime

Use `agy-companion` to communicate with the local Antigravity CLI.

Read-only work must use the sandboxed wrapper paths:

- `agy-companion setup [--json] [--auth-check]`
- `agy-companion review [--background] [--base <ref>] [extra instructions]`
- `agy-companion adversarial-review [--background] [--base <ref>] [extra instructions]`
- `agy-companion status [job-id]`
- `agy-companion result <job-id>`
- `agy-companion cancel <job-id>`
- `agy-companion prune`

Use `agy-companion rescue ...` for rescue tasks. The wrapper only removes `agy --sandbox` when the user explicitly requests write work or uses a write-intent verb. It also checks the Antigravity trusted workspace list before allowing write mode. Pass `--read-only` to force a sandboxed run when a task description contains write-intent words but should not change files.

Finished jobs and old logs past `AGY_COMPANION_RETENTION_DAYS` (default 7) are pruned automatically when a new job starts, or on demand with `agy-companion prune`.

Never add `--dangerously-skip-permissions` unless the user explicitly asks for that exact flag.
