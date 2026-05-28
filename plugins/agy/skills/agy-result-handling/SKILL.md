---
name: agy-result-handling
description: Internal guidance for presenting agy (Antigravity) companion output back to the user.
compatibility: codex, opencode, claude-code
user-invocable: false
disable-model-invocation: false
---

# agy Result Handling

When the companion returns agy output:

- Preserve the helper's verdict, summary, findings, and next steps structure.
- For review output, present findings first and keep them ordered by severity.
- Use the file paths and line numbers exactly as the helper reports them.
- Preserve evidence boundaries. If agy marked something as an inference, an uncertainty, or a follow-up question, keep that distinction.
- Preserve output sections when the prompt asked for them, such as observed facts, inferences, open questions, touched files, or next steps.
- If there are no findings, say that explicitly and keep the residual-risk note brief.
- If agy made edits (a write-mode rescue), say so explicitly and list the touched files when the helper provides them.
- For `/agy:rescue`, do not turn a failed or incomplete agy run into a Claude-side implementation attempt. Report the failure and stop.
- For `/agy:rescue`, if agy was never successfully invoked, do not generate a substitute answer at all.
- CRITICAL: After presenting review findings, STOP. Do not make any code changes. Do not fix any issues. You MUST explicitly ask the user which issues, if any, they want fixed before touching a single file. Auto-applying fixes from a review is strictly forbidden, even if the fix is obvious.
- If the helper reports malformed output or a failed agy run, include the most actionable stderr lines and stop there instead of guessing.
- If the helper reports that setup or authentication is required, direct the user to `/agy:setup` and do not improvise alternate auth flows.

## agy text-output caveat

agy `--print` returns plain text, not a structured JSON envelope. Do not assume machine-parseable fields. Read the verdict from the text itself and quote it rather than reformatting it into a schema the model did not emit.
