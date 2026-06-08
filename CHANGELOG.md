# Changelog

## 0.3.0

### Fixed
- `setup` now reports a meaningful `ready`/`auth` status on the first run with no flags. Previously readiness required `--auth-check`, so `/agy:setup` always returned `ready: false` / `auth: unknown` even when the user was logged in.
- The auth smoke test no longer reports `ok` alongside a spurious `ETIMEDOUT` error: a clean `OK` reply now counts as success even when agy's background `agentapi` keeps stdio open and `spawnSync` hits its timeout.

### Added
- Offline auth detection in `setup`: the presence of the persisted OAuth token (`~/.gemini/antigravity-cli/antigravity-oauth-token`) is reported as `auth: present`/`missing` without spending a model call, so a logged-in user gets `ready: true` immediately. `--auth-check` still runs the live verified smoke test (`auth: ok`/`failed`, `verified: true`).
- `AGY_TOKEN_PATH` to override the OAuth token location for non-default installs and tests. `setup --json` now includes `verified`, `tokenPresent`, and `tokenPath`.

## 0.2.0

### Fixed
- `redactArgs` no longer stores the full `--print` prompt in on-disk job metadata; the prompt is replaced with a length-only placeholder.
- `status`/`result` tolerate a corrupt or partially written job metadata file instead of failing for every job.
- `setup`, `review`, and `rescue` fail fast with an install hint when the `agy` binary is missing, instead of a cryptic spawn error.
- The auth smoke test no longer treats an explicit `NOT OK` reply as success.

### Added
- `agy-companion prune` (and `/agy:prune`) to remove finished jobs and old logs; pruning also runs opportunistically when a new background job starts.
- `--read-only` flag for rescue, forcing a sandboxed run and overriding the write-word heuristic.
- `AGY_SETTINGS_PATH` to override the Antigravity settings location, and `AGY_COMPANION_RETENTION_DAYS` to tune job/log retention.
- Cross-platform binary discovery (`where` on Windows, `which` elsewhere) and an expanded `help` listing actions and environment variables.

## 0.1.0

- Initial public marketplace layout for the `agy` Claude Code plugin.
- Added `/agy:*` commands for setup, review, adversarial review, rescue, status, result, and cancel.
- Added trusted-workspace enforcement for write tasks and explicit `--dangerously-skip-permissions` forwarding only when requested.
