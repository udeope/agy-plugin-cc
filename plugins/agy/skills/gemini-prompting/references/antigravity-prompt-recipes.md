# Antigravity (Gemini 3) prompt recipes

Concrete prompt shapes for `agy --print`. Each is a single non-interactive pass,
so the prompt carries all needed context.

## Recipe: code review

```
You are performing a code review of the git context below.
Focus on correctness, regressions, security, missing tests, and concrete
file-level risks. Do not suggest unrelated refactors.
Ground every finding in a file and line from the context.
Output: a one-line verdict, then findings ordered by severity, then open questions.

<git context here>
```

## Recipe: adversarial review (stop gate)

```
Assume the change is guilty until proven safe. Hunt for correctness bugs,
race conditions, data loss, and missing edge cases.
First line must be exactly "ALLOW: <reason>" or "BLOCK: <reason>".

<git context here>
```

A strict first-line contract (ALLOW/BLOCK) makes the text output mechanically
parseable even though agy has no JSON mode.

## Recipe: diagnosis (read-only rescue)

```
Diagnose why <symptom>. Inspect <files/commands>. Do not change files.
Output: observed facts, most likely root cause, and the single next check.
```

## Anti-patterns (waste a --print pass)

- Assuming shared context: agy cannot see the Claude conversation. Restating
  "as we discussed" produces a confused answer.
- No output contract: "review this" returns prose that is hard to act on. Always
  name the sections you want back.
- Asking for a fix in `--sandbox`: sandbox is read-only. A write task needs write
  mode and a trusted workspace, or agy will report it could not apply changes.
- Over-broad scope in one pass: "audit the whole repo" dilutes a single `--print`
  call. Split into focused passes or use `--conversation` to iterate.
- Re-sending the entire task to continue work: use `--continue` /
  `--conversation <id>` to resume instead of paying for full context again.
