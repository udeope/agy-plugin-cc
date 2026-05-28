import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test, { after } from 'node:test';

import {
  buildReviewContext,
  jobDir,
  logDir,
  normalizeTrustedWorkspaces,
  parseFlags,
  parseInvocationArgs,
  shellSplit,
} from '../plugins/agy/scripts/agy-companion.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const companion = path.join(repoRoot, 'plugins', 'agy', 'scripts', 'agy-companion.mjs');
const stopGateHook = path.join(repoRoot, 'plugins', 'agy', 'scripts', 'stop-review-gate-hook.mjs');

after(() => {
  fs.rmSync(path.join(repoRoot, '.tmp'), { recursive: true, force: true });
});

test('parses Claude raw argument string and normal argv mode', () => {
  assert.deepEqual(parseInvocationArgs(['--background --base main "extra note"']), [
    '--background',
    '--base',
    'main',
    'extra note',
  ]);
  assert.deepEqual(parseInvocationArgs(['--background', '--base', 'main']), [
    '--background',
    '--base',
    'main',
  ]);
  assert.deepEqual(shellSplit('--conversation "abc 123" fix'), ['--conversation', 'abc 123', 'fix']);
});

test('extracts flags without forwarding Claude-only flags as task text', () => {
  const flags = parseFlags([
    '--background',
    '--wait',
    '--write',
    '--continue',
    '--conversation',
    'thread-1',
    '--dangerously-skip-permissions',
    'fix',
    'typo',
  ]);

  assert.equal(flags.background, true);
  assert.equal(flags.wait, true);
  assert.equal(flags.write, true);
  assert.equal(flags.continueConversation, true);
  assert.equal(flags.conversation, 'thread-1');
  assert.equal(flags.dangerouslySkipPermissions, true);
  assert.deepEqual(flags.positional, ['fix', 'typo']);
});

test('normalizes supported trusted workspace settings shapes', () => {
  assert.deepEqual(normalizeTrustedWorkspaces({ trustedWorkspaces: ['/a'] }), ['/a']);
  assert.deepEqual(normalizeTrustedWorkspaces({ security: { trustedWorkspaces: [{ path: '/b' }] } }), ['/b']);
  assert.deepEqual(normalizeTrustedWorkspaces({ trustedWorkspaces: [null, { nope: true }, '/c'] }), ['/c']);
});

test('review context includes status, staged, unstaged, untracked, and truncation markers', () => {
  const dir = makeTempDir();
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'base\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });

  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'staged\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'unstaged\n');
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'hello\n');
  fs.writeFileSync(path.join(dir, 'large.txt'), 'x'.repeat(30 * 1024));

  const oldCwd = process.cwd();
  process.chdir(dir);
  try {
    const context = buildReviewContext();
    assert.match(context, /git status --short --untracked-files=all/);
    assert.match(context, /staged diff/);
    assert.match(context, /unstaged diff/);
    assert.match(context, /untracked file: untracked\.txt/);
    assert.match(context, /truncated: untracked file exceeded 24 KB/);
  } finally {
    process.chdir(oldCwd);
  }
});

test('rescue read-only tasks use sandbox and write tasks do not', () => {
  const workspace = makeTempDir();
  const home = makeHomeWithTrustedWorkspace(workspace);
  const fakeBin = makeFakeAgyBin();

  const readOnly = runCompanion(['rescue', 'diagnose issue'], {
    cwd: workspace,
    env: { HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  assert.equal(readOnly.status, 0);
  assert.match(readOnly.stdout, /\[--sandbox\]/);

  const write = runCompanion(['rescue', '--write', 'fix typo'], {
    cwd: workspace,
    env: { HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  assert.equal(write.status, 0);
  assert.doesNotMatch(write.stdout, /\[--sandbox\]/);
});

test('write tasks reject untrusted workspaces before invoking agy', () => {
  const trusted = makeTempDir();
  const untrusted = makeTempDir();
  const home = makeHomeWithTrustedWorkspace(trusted);
  const fakeBin = makeFakeAgyBin();

  const result = runCompanion(['rescue', '--write', 'fix typo'], {
    cwd: untrusted,
    env: { HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /write denied/);
  assert.equal(result.stdout, '');
});

test('dangerously-skip-permissions is only forwarded when explicitly provided', () => {
  const workspace = makeTempDir();
  const home = makeHomeWithTrustedWorkspace(workspace);
  const fakeBin = makeFakeAgyBin();

  const normal = runCompanion(['rescue', '--write', 'fix typo'], {
    cwd: workspace,
    env: { HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  assert.doesNotMatch(normal.stdout, /dangerously-skip-permissions/);

  const dangerous = runCompanion(['rescue', '--write', '--dangerously-skip-permissions', 'fix typo'], {
    cwd: workspace,
    env: { HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  assert.match(dangerous.stdout, /dangerously-skip-permissions/);
});

test('agy invocations use companion-owned log files', () => {
  const workspace = makeTempDir();
  const home = makeHomeWithTrustedWorkspace(workspace);
  const fakeBin = makeFakeAgyBin();
  const data = makeTempDir();

  const result = runCompanion(['rescue', 'diagnose issue'], {
    cwd: workspace,
    env: { HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, AGY_COMPANION_DATA: data },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[--log-file\]/);
  assert.match(result.stdout, new RegExp(escapeRegExp(path.join(data, 'logs'))));
});

test('background jobs can be listed, read, and cancelled when already finished', () => {
  const workspace = makeTempDir();
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
  const home = makeHomeWithTrustedWorkspace(workspace);
  const fakeBin = makeFakeAgyBin();
  const data = makeTempDir();
  const env = { HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, CLAUDE_PLUGIN_DATA: data };

  const started = runCompanion(['review', '--background'], { cwd: workspace, env });
  assert.equal(started.status, 0);
  const id = started.stdout.match(/started review job ([^\n]+)/)?.[1];
  assert.ok(id);

  const status = runCompanion(['status'], { cwd: workspace, env });
  assert.equal(status.status, 0);
  assert.match(status.stdout, new RegExp(id));

  const result = runCompanion(['result', id], { cwd: workspace, env });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /fake agy args:/);

  const cancel = runCompanion(['cancel', id], { cwd: workspace, env });
  assert.equal(cancel.status, 0);
  assert.match(cancel.stdout, /is not running|cancelled/);
});

test('AGY_COMPANION_DATA takes precedence over CLAUDE_PLUGIN_DATA for job storage', () => {
  const workspace = makeTempDir();
  const agyData = makeTempDir();
  const claudeData = makeTempDir();
  const oldCwd = process.cwd();
  const oldAgyData = process.env.AGY_COMPANION_DATA;
  const oldClaudeData = process.env.CLAUDE_PLUGIN_DATA;

  process.chdir(workspace);
  process.env.AGY_COMPANION_DATA = agyData;
  process.env.CLAUDE_PLUGIN_DATA = claudeData;
  try {
    assert.match(jobDir(), new RegExp(escapeRegExp(path.join(agyData, 'jobs'))));
    assert.match(logDir(), new RegExp(escapeRegExp(path.join(agyData, 'logs'))));
    assert.doesNotMatch(jobDir(), new RegExp(escapeRegExp(path.join(claudeData, 'jobs'))));
  } finally {
    process.chdir(oldCwd);
    restoreEnv('AGY_COMPANION_DATA', oldAgyData);
    restoreEnv('CLAUDE_PLUGIN_DATA', oldClaudeData);
  }
});

test('Codex plugin and marketplace manifests expose the agy plugin', () => {
  const codexManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'plugins', 'agy', '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal(codexManifest.name, 'agy');
  assert.equal(codexManifest.skills, './skills/');
  assert.equal(codexManifest.interface.displayName, 'Antigravity Companion');
  assert.ok(codexManifest.interface.capabilities.includes('Read'));
  assert.ok(codexManifest.interface.capabilities.includes('Write'));

  const marketplace = JSON.parse(fs.readFileSync(path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
  const agy = marketplace.plugins.find((plugin) => plugin.name === 'agy');
  assert.ok(agy);
  assert.equal(agy.source.path, './plugins/agy');
  assert.equal(agy.policy.installation, 'AVAILABLE');
  assert.equal(agy.policy.authentication, 'ON_USE');
});

test('OpenCode command files delegate to agy-companion', () => {
  const commandDir = path.join(repoRoot, '.opencode', 'commands');
  const expected = [
    'agy-setup.md',
    'agy-review.md',
    'agy-adversarial-review.md',
    'agy-rescue.md',
    'agy-status.md',
    'agy-result.md',
    'agy-cancel.md',
  ];

  for (const file of expected) {
    const body = fs.readFileSync(path.join(commandDir, file), 'utf8');
    assert.match(body, /^---\n[\s\S]*description:/);
    assert.match(body, /agy-companion /);
    assert.match(body, /\$ARGUMENTS/);
  }
});

test('skills declare names and descriptions for Codex and OpenCode discovery', () => {
  for (const file of [
    path.join(repoRoot, 'plugins', 'agy', 'skills', 'agy-cli-runtime', 'SKILL.md'),
    path.join(repoRoot, '.opencode', 'skills', 'agy-cli-runtime', 'SKILL.md'),
  ]) {
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, /^---\n[\s\S]*name: agy-cli-runtime/);
    assert.match(body, /^---\n[\s\S]*description:/);
  }
});

test('stop-review-gate hook is a no-op unless the gate is enabled', () => {
  const ws = makeGitWorkspace({ dirty: true });
  const result = runHook({ cwd: ws }, {});
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '');
});

test('stop-review-gate hook blocks when agy returns BLOCK on a dirty tree', () => {
  const ws = makeGitWorkspace({ dirty: true });
  const fakeBin = makeVerdictAgyBin('BLOCK: missing tests for f.txt');
  const data = makeTempDir();
  const result = runHook({ cwd: ws, last_assistant_message: 'I edited f.txt' }, {
    AGY_STOP_REVIEW_GATE: '1',
    PATH: `${fakeBin}:${process.env.PATH}`,
    AGY_COMPANION_DATA: data,
  });
  assert.equal(result.status, 0);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /missing tests for f\.txt/);
});

test('stop-review-gate hook allows when agy returns ALLOW', () => {
  const ws = makeGitWorkspace({ dirty: true });
  const fakeBin = makeVerdictAgyBin('ALLOW: looks fine');
  const data = makeTempDir();
  const result = runHook({ cwd: ws }, {
    AGY_STOP_REVIEW_GATE: '1',
    PATH: `${fakeBin}:${process.env.PATH}`,
    AGY_COMPANION_DATA: data,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '');
});

test('stop-review-gate hook skips clean trees without invoking agy', () => {
  const ws = makeGitWorkspace({ dirty: false });
  const fakeBin = makeVerdictAgyBin('BLOCK: should never run on a clean tree');
  const result = runHook({ cwd: ws }, {
    AGY_STOP_REVIEW_GATE: '1',
    PATH: `${fakeBin}:${process.env.PATH}`,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '');
});

test('stop-review-gate hook does not recurse when stop_hook_active is set', () => {
  const ws = makeGitWorkspace({ dirty: true });
  const fakeBin = makeVerdictAgyBin('BLOCK: x');
  const result = runHook({ cwd: ws, stop_hook_active: true }, {
    AGY_STOP_REVIEW_GATE: '1',
    PATH: `${fakeBin}:${process.env.PATH}`,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '');
});

function runHook(input, env = {}) {
  return spawnSync(process.execPath, [stopGateHook], {
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function makeGitWorkspace({ dirty = false } = {}) {
  const dir = makeTempDir();
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'f.txt'), 'base\n');
  execFileSync('git', ['add', 'f.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  if (dirty) {
    fs.writeFileSync(path.join(dir, 'f.txt'), 'changed\n');
  }
  return dir;
}

function makeVerdictAgyBin(verdict) {
  const dir = makeTempDir();
  fs.writeFileSync(
    path.join(dir, 'agy'),
    `#!/usr/bin/env sh\necho "${verdict}"\n`,
    { mode: 0o755 },
  );
  return dir;
}

function runCompanion(args, { cwd, env = {} }) {
  return spawnSync(process.execPath, [companion, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function makeTempDir() {
  const base = path.join(repoRoot, '.tmp');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'test-'));
}

function makeHomeWithTrustedWorkspace(workspace) {
  const home = makeTempDir();
  const settingsDir = path.join(home, '.gemini', 'antigravity-cli');
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(settingsDir, 'settings.json'),
    JSON.stringify({ trustedWorkspaces: [workspace] }, null, 2),
  );
  return home;
}

function makeFakeAgyBin() {
  const dir = makeTempDir();
  const file = path.join(dir, 'agy');
  fs.writeFileSync(
    file,
    '#!/usr/bin/env sh\nprintf "fake agy args:"\nfor arg in "$@"; do printf " [%s]" "$arg"; done\nprintf "\\n"\n',
    { mode: 0o755 },
  );
  return dir;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
