---
name: gemini-prompting
description: How to compose effective prompts for the agy (Antigravity) CLI, which runs on Gemini 3, for review, rescue, and diagnosis tasks.
compatibility: codex, opencode, claude-code
disable-model-invocation: false
---

# Prompting agy (Antigravity / Gemini 3)

agy delegates to Antigravity, backed by Gemini 3, and runs each prompt through
`agy --print` in a single non-interactive pass. The model does not keep your
Claude-side context, so the prompt must carry everything it needs.

## Core rules

- Be self-contained. agy does not see the Claude conversation. Inline the diff,
  file contents, or commands it must reason about — the companion already does
  this for reviews via the git context block.
- State the deliverable shape up front: a verdict line, a findings list ordered
  by severity, touched files, open questions. Gemini 3 follows an explicit
  output contract well.
- Scope the task. "Review this diff for correctness and security regressions"
  beats "review this". Tell it what NOT to do (e.g. no unrelated refactors).
- Ground every claim. Ask it to cite the file and line it is reasoning about so
  the output is verifiable and not speculative.
- Prefer one focused pass over a vague broad one. `--print` is single-shot; a
  narrow question yields a sharper answer than an open-ended one.

## Read vs write

- Default to read-only (`--sandbox`). Reserve write mode for explicit fix/apply
  tasks, and only inside a trusted Antigravity workspace.
- For multi-step fixes, prefer `--conversation <id>` / `--continue` to resume an
  existing thread instead of restating the whole task.

## Anti-patterns

See `references/antigravity-prompt-recipes.md` for concrete recipes and the
prompt mistakes that waste a `--print` pass.
