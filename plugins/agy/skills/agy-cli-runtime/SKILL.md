---
name: agy-cli-runtime
description: Runtime contract for the agy CLI companion used by the agy Claude Code plugin.
compatibility: codex, opencode, claude-code
disable-model-invocation: false
---

# agy CLI Runtime

Use this skill when the user asks to delegate review, rescue, status, or setup work to the local Antigravity CLI through `agy`.

The plugin delegates to `agy-companion`, which wraps the local `agy` executable. In a source checkout, the same runtime is available at `plugins/agy/scripts/agy-companion.mjs`.

Read-only work uses `agy --print ... --sandbox`. Write work removes `--sandbox` only after trusted-workspace validation. The wrapper never passes `--dangerously-skip-permissions` unless the user explicitly provided that flag.

Background jobs are stored under `${AGY_COMPANION_DATA}/jobs/<workspace-hash>/`, then `${CLAUDE_PLUGIN_DATA}/jobs/<workspace-hash>/`, then the OS temp directory.

## Commands

- Setup: `agy-companion setup [--json] [--auth-check]`
- Review: `agy-companion review [--background] [--base <ref>] [extra instructions]`
- Adversarial review: `agy-companion adversarial-review [--background] [--base <ref>] [extra instructions]`
- Rescue: `agy-companion rescue [--background] [--wait] [--write] [--continue] [--conversation <id>] [--dangerously-skip-permissions] <task>`
- Status: `agy-companion status [job-id]`
- Result: `agy-companion result <job-id>`
- Cancel: `agy-companion cancel <job-id>`

## Operating rules

- Return `agy-companion` stdout/stderr verbatim for setup, status, result, and cancel.
- For reviews, do not inspect files yourself unless the user explicitly asks you to compare the output against local source.
- For rescue, prefer read-only delegation unless the user requests a write, fix, patch, implementation, refactor, create, delete, or similar file-changing task.
- Do not add `--dangerously-skip-permissions` unless the user explicitly requests that exact flag.
