# Changelog

## Unreleased

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
