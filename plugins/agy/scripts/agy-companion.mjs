#!/usr/bin/env node
// Thin CLI dispatcher for the agy (Antigravity) companion.
// Concern-specific logic lives in ./lib/*; this file wires actions to it.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parseFlags, parseInvocationArgs, shellSplit } from './lib/args.mjs';
import {
  INSTALL_HINT,
  SETTINGS_PATH,
  WRITE_WORDS,
  assertTrustedForWrite,
  ensureBinaryOrThrow,
  findBinary,
  normalizeTrustedWorkspaces,
  readAuthState,
  readSettings,
  runAuthCheck,
  runForeground,
  withLogFile,
} from './lib/agy.mjs';
import { buildReviewContext } from './lib/git.mjs';
import {
  findJob,
  isRunning,
  listJobs,
  printJobStatus,
  pruneJobs,
  pruneLogs,
  startJob,
} from './lib/jobs.mjs';
import { jobDir, logDir } from './lib/paths.mjs';
import { buildReviewPrompt } from './lib/prompts.mjs';

// Resolve symlinks before comparing: when invoked through an npm global bin
// symlink, argv[1] is the link path while import.meta.url is the real one.
const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(`agy-companion: ${error.message}`);
    process.exitCode = 1;
  });
}

async function main() {
  const action = process.argv[2] || 'help';
  const args = parseInvocationArgs(process.argv.slice(3));

  switch (action) {
    case 'setup':
      return setup(args);
    case 'review':
      return runReview(args, false);
    case 'adversarial-review':
      return runReview(args, true);
    case 'rescue':
    case 'task':
      return runRescue(args);
    case 'status':
      return status(args);
    case 'result':
      return result(args);
    case 'cancel':
      return cancel(args);
    case 'prune':
      return prune(args);
    case 'help':
    default:
      return help();
  }
}

function setup(args) {
  const flags = parseFlags(args);
  const binary = findBinary('agy');
  const settings = readSettings();
  const token = readAuthState();

  // Default readiness trusts the persisted OAuth token (fast, offline), so a
  // logged-in user sees ready:true on the first `/agy:setup` with no flags.
  // --auth-check additionally spends a live model call to verify the stored
  // credentials actually work end-to-end.
  const auth = flags.authCheck ? runAuthCheck() : null;
  const authOk = flags.authCheck ? auth.ok : token.present;
  const authStatus = flags.authCheck
    ? (auth.ok ? 'ok' : 'failed')
    : (token.present ? 'present' : 'missing');

  const ready = Boolean(binary.ok && settings.ok && authOk);
  const payload = {
    ready,
    binary,
    settings: {
      ok: settings.ok,
      path: SETTINGS_PATH,
      trustedWorkspaces: settings.trustedWorkspaces,
      error: settings.error,
    },
    auth: {
      status: authStatus,
      ok: authOk,
      verified: flags.authCheck,
      tokenPresent: token.present,
      tokenPath: token.path,
      output: auth?.output ?? null,
      error: flags.authCheck ? auth.error : token.error,
    },
  };

  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`agy binary: ${binary.ok ? binary.path : `missing (${binary.error})`}`);
  console.log(`settings: ${settings.ok ? SETTINGS_PATH : `missing/unreadable (${settings.error})`}`);
  console.log(`trusted workspaces: ${settings.trustedWorkspaces.length}`);
  console.log(`auth: ${payload.auth.status}${payload.auth.error ? ` (${payload.auth.error})` : ''}`);
  console.log(`ready: ${ready}`);
  if (!binary.ok) {
    console.log(INSTALL_HINT);
  }
}

async function runReview(args, adversarial) {
  const flags = parseFlags(args);
  ensureBinaryOrThrow();
  const context = buildReviewContext(flags.base);
  const extra = flags.positional.join(' ').trim();
  const prompt = buildReviewPrompt({ adversarial, context, extra });
  const agyArgs = withLogFile(['--print', prompt, '--sandbox']);

  if (flags.background) {
    return startJob(adversarial ? 'adversarial-review' : 'review', agyArgs);
  }

  return runForeground(agyArgs);
}

async function runRescue(args) {
  const flags = parseFlags(args);
  ensureBinaryOrThrow();
  const task = flags.positional.join(' ').trim();
  if (!task && !flags.continueConversation && !flags.conversation) {
    throw new Error('rescue requires a task, --continue, or --conversation <id>');
  }

  // --read-only forces a sandboxed run and wins over both --write and the
  // WRITE_WORDS heuristic, which can false-positive on phrases like
  // "write a summary" or "update the docstring".
  const wantsWrite = !flags.readOnly && (flags.write || WRITE_WORDS.test(task));
  if (wantsWrite) {
    assertTrustedForWrite(process.cwd());
  }

  const prompt = task || 'Continue the previous Antigravity conversation for this workspace.';
  const agyArgs = ['--print', prompt];
  if (!wantsWrite) agyArgs.push('--sandbox');
  if (flags.continueConversation) agyArgs.push('--continue');
  if (flags.conversation) agyArgs.push('--conversation', flags.conversation);
  if (flags.dangerouslySkipPermissions) agyArgs.push('--dangerously-skip-permissions');
  const finalAgyArgs = withLogFile(agyArgs);

  if (flags.background) {
    return startJob('rescue', finalAgyArgs);
  }

  return runForeground(finalAgyArgs);
}

function status(args) {
  const flags = parseFlags(args);
  if (flags.positional[0]) {
    const { meta } = findJob(flags.positional[0]);
    printJobStatus(meta);
    return;
  }
  const jobs = listJobs();
  if (!jobs.length) {
    console.log('no jobs for this workspace');
    return;
  }
  for (const meta of jobs) {
    printJobStatus(meta);
  }
}

function result(args) {
  const flags = parseFlags(args);
  const { meta } = findJob(flags.positional[0]);
  process.stdout.write(fs.existsSync(meta.outPath) ? fs.readFileSync(meta.outPath, 'utf8') : '');
  const err = fs.existsSync(meta.errPath) ? fs.readFileSync(meta.errPath, 'utf8') : '';
  if (err.trim()) {
    process.stderr.write(err);
  }
}

function cancel(args) {
  const flags = parseFlags(args);
  const { meta } = findJob(flags.positional[0]);
  if (!isRunning(meta.pid)) {
    console.log(`${meta.id} is not running`);
    return;
  }
  process.kill(meta.pid, 'SIGTERM');
  console.log(`cancelled ${meta.id}`);
}

function prune(args) {
  parseFlags(args);
  const jobs = pruneJobs();
  const logs = pruneLogs();
  console.log(`pruned ${jobs.removed} finished job(s) and ${logs.removed} log file(s)`);
}

function help() {
  console.log(`usage: agy-companion.mjs <action> [args]

actions:
  setup [--json] [--auth-check]            check agy binary, settings, and (optionally) auth
  review [--background] [--base <ref>]     read-only review of the working tree
  adversarial-review [--background] ...    stricter, skeptical review
  rescue [--background] [--write|--read-only] [--continue] [--conversation <id>] <task>
                                           delegate a task to agy (sandboxed unless --write)
  status [job-id]                          list background jobs, or one job's state
  result <job-id>                          print a finished job's output
  cancel <job-id>                          stop a running background job
  prune                                    remove finished jobs and logs past the retention window

env:
  AGY_SETTINGS_PATH                 override the antigravity-cli settings.json path
  AGY_COMPANION_DATA                override where jobs and logs are stored
  AGY_COMPANION_RETENTION_DAYS      days to keep finished jobs/logs (default 7; <=0 disables pruning)`);
}

export {
  assertTrustedForWrite,
  buildReviewContext,
  jobDir,
  logDir,
  normalizeTrustedWorkspaces,
  parseFlags,
  parseInvocationArgs,
  pruneJobs,
  pruneLogs,
  shellSplit,
};
export { redactArgs } from './lib/jobs.mjs';
export { buildReviewPrompt } from './lib/prompts.mjs';
