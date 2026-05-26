# agy-plugin-cc

Claude Code marketplace for `agy`, a plugin that delegates code review and rescue workflows to the local Antigravity CLI.

## Install

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

## Commands

- `/agy:setup [--json] [--auth-check]`
- `/agy:review [--background] [--base <ref>] [extra instructions]`
- `/agy:adversarial-review [--background] [--base <ref>] [extra instructions]`
- `/agy:rescue [--background] [--wait] [--write] [--continue] [--conversation <id>] [--dangerously-skip-permissions] <task>`
- `/agy:status [job-id]`
- `/agy:result <job-id>`
- `/agy:cancel <job-id>`

## Requirements

- Claude Code with plugin marketplace support.
- A working local `agy` executable in `PATH`.
- Antigravity CLI settings at `~/.gemini/antigravity-cli/settings.json`.

Run:

```bash
node plugins/agy/scripts/agy-companion.mjs setup
node plugins/agy/scripts/agy-companion.mjs setup --auth-check
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

## Development

```bash
npm test
npm run check
npm run validate
```

The plugin lives in `plugins/agy/`. The root `.claude-plugin/marketplace.json` makes the repository installable as a Claude Code marketplace.
