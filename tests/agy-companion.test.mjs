import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  buildReviewContext,
  normalizeTrustedWorkspaces,
  parseFlags,
  parseInvocationArgs,
  shellSplit,
} from '../plugins/agy/scripts/agy-companion.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const companion = path.join(repoRoot, 'plugins', 'agy', 'scripts', 'agy-companion.mjs');

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
