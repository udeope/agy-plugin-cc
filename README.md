# agy-plugin-cc

[![CI](https://github.com/udeope/agy-plugin-cc/actions/workflows/ci.yml/badge.svg)](https://github.com/udeope/agy-plugin-cc/actions/workflows/ci.yml)

Multi-client companion plugin for `agy`, delegating code review and rescue workflows to the local Antigravity CLI from Claude Code, Codex, and OpenCode.

## Install for Claude Code

Add the marketplace, then install the plugin:

```bash
claude plugin marketplace add udeope/agy-plugin-cc
claude plugin install agy@agy-plugin-cc
```

For local development from a clone:

```bash
claude plugin marketplace add .
claude plugin install agy@agy-plugin-cc
```

## Install for Codex

The Codex plugin metadata lives in `plugins/agy/.codex-plugin/plugin.json`, and the repo-local marketplace lives in `.agents/plugins/marketplace.json`.

From a local clone, add the marketplace root to Codex, then install `agy` from the Codex plugins UI or CLI:

```bash
codex plugin marketplace add .
```

The shared runtime is exposed as the `agy-cli-runtime` skill. Use it by asking Codex to use `$agy-cli-runtime` for setup, review, adversarial review, rescue, status, result, or cancel workflows.

## Install for OpenCode

Install the companion binary globally from GitHub:

```bash
npm install -g github:udeope/agy-plugin-cc
```

Then make the `.opencode` folder from this repo available to OpenCode by copying or symlinking it into your OpenCode config directory.

The OpenCode integration provides:

- commands in `.opencode/commands/`
- a rescue agent in `.opencode/agents/`
- runtime guidance in `.opencode/skills/agy-cli-runtime/SKILL.md`

## Commands

- `/agy:setup [--json] [--auth-check]`
- `/agy:review [--background] [--base <ref>] [extra instructions]`
- `/agy:adversarial-review [--background] [--base <ref>] [extra instructions]`
- `/agy:rescue [--background] [--wait] [--write] [--continue] [--conversation <id>] [--dangerously-skip-permissions] <task>`
- `/agy:status [job-id]`
- `/agy:result <job-id>`
- `/agy:cancel <job-id>`

For Codex and OpenCode, use the same action names through `agy-companion`:

```bash
agy-companion setup --auth-check
agy-companion review --base main
agy-companion adversarial-review --background
agy-companion rescue --write "fix the failing test"
agy-companion status
agy-companion result <job-id>
agy-companion cancel <job-id>
```

## Requirements

- Claude Code with plugin marketplace support.
- Codex with plugin support, for Codex usage.
- OpenCode with command/agent/skill discovery configured, for OpenCode usage.
- A working local `agy` executable in `PATH`.
- Antigravity CLI settings at `~/.gemini/antigravity-cli/settings.json`.

Run:

```bash
agy-companion setup
agy-companion setup --auth-check
```

Without `--auth-check`, auth is reported as `unknown`. With `--auth-check`, the companion runs:

```bash
agy --print "Reply with only OK" --sandbox --print-timeout 20s
```

`ready` is true only when the binary exists, settings are readable, and the auth smoke test passes.

## Safety

Read-only review and rescue tasks run with `agy --sandbox`. Write access is not enabled by default.

`/agy:rescue` enables write mode only when the user explicitly asks for it, either with `--write` or natural language such as "fix", "apply changes", "modify files", or "implement".

Write tasks are blocked unless the current workspace resolves under a trusted workspace listed in `~/.gemini/antigravity-cli/settings.json`. The trusted path check uses real paths and accepts either an exact match or a subdirectory match.

Passing `--write` removes `--sandbox`, but it does not auto-approve Antigravity permissions. If `agy` needs approval, the task may pause, fail, or require interaction. The plugin never adds `--dangerously-skip-permissions` unless the user passes that flag literally.

Review context is collected inline and capped below common shell argument limits. If staged, unstaged, base-branch, or untracked-file context is truncated, the prompt includes an explicit truncation note.

Background jobs are stored under `AGY_COMPANION_DATA` when set, then `CLAUDE_PLUGIN_DATA`, then the OS temp directory.

## Stop-review gate (optional, Claude Code)

A `Stop` hook can run an adversarial review of the previous Claude turn through agy and block the session from ending if it finds issues that should be fixed first. It is **disabled by default** and opt-in:

```bash
export AGY_STOP_REVIEW_GATE=1   # 1 | true | on | yes
```

When enabled, the hook:

- skips entirely when the working tree is clean (no agy call, no cost);
- runs `agy --print ... --sandbox` (read-only) and reads the verdict from the first output line (`ALLOW: ...` or `BLOCK: ...`);
- blocks stopping only on `BLOCK`, feeding the reason back to Claude;
- never recurses (it no-ops when `stop_hook_active` is set) and never blocks if agy is missing.

Disable it again by unsetting `AGY_STOP_REVIEW_GATE`.

## Skills

- `agy-cli-runtime` — runtime contract for delegating to the companion.
- `agy-result-handling` — how to present agy output back to the user.
- `gemini-prompting` — how to write effective `agy --print` prompts (Antigravity runs Gemini 3).

## Development

```bash
npm test
npm run check
npm run validate
```

The plugin lives in `plugins/agy/`: `scripts/agy-companion.mjs` is a thin dispatcher over `scripts/lib/*` (args, agy, git, jobs, paths, prompts), `prompts/` holds the review and stop-gate templates, `hooks/` holds the optional stop-review gate, and `skills/` holds the runtime, result-handling, and prompting guidance.

The root `.claude-plugin/marketplace.json` makes the repository installable as a Claude Code marketplace. The root `.agents/plugins/marketplace.json` makes the same plugin installable as a Codex marketplace entry. The `.opencode/` folder contains the OpenCode adapter files.
