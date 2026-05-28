#!/usr/bin/env node
// Thin CLI dispatcher for the agy (Antigravity) companion.
// Concern-specific logic lives in ./lib/*; this file wires actions to it.

import fs from 'node:fs';

import { parseFlags, parseInvocationArgs, shellSplit } from './lib/args.mjs';
import {
  SETTINGS_PATH,
  WRITE_WORDS,
  assertTrustedForWrite,
  findBinary,
  normalizeTrustedWorkspaces,
  readSettings,
  runAuthCheck,
  runForeground,
  withLogFile,
} from './lib/agy.mjs';
import { buildReviewContext } from './lib/git.mjs';
import { findJob, isRunning, listJobs, printJobStatus, startJob } from './lib/jobs.mjs';
import { jobDir, logDir } from './lib/paths.mjs';
import { buildReviewPrompt } from './lib/prompts.mjs';

if (import.meta.url === `file://${process.argv[1]}`) {
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
    case 'help':
    default:
      return help();
  }
}

function setup(args) {
  const flags = parseFlags(args);
  const binary = findBinary('agy');
  const settings = readSettings();
  let auth = { status: 'unknown', ok: false, output: null };

  if (flags.authCheck) {
    auth = runAuthCheck();
  }

  const ready = Boolean(binary.ok && settings.ok && flags.authCheck && auth.ok);
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
      status: flags.authCheck ? (auth.ok ? 'ok' : 'failed') : 'unknown',
      ok: flags.authCheck ? auth.ok : false,
      output: auth.output,
      error: auth.error,
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
}

async function runReview(args, adversarial) {
  const flags = parseFlags(args);
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
  const task = flags.positional.join(' ').trim();
  if (!task && !flags.continueConversation && !flags.conversation) {
    throw new Error('rescue requires a task, --continue, or --conversation <id>');
  }

  const wantsWrite = flags.write || WRITE_WORDS.test(task);
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

function help() {
  console.log('usage: agy-companion.mjs <setup|review|adversarial-review|rescue|status|result|cancel> [args]');
}

export {
  assertTrustedForWrite,
  buildReviewContext,
  jobDir,
  logDir,
  normalizeTrustedWorkspaces,
  parseFlags,
  parseInvocationArgs,
  shellSplit,
};
export { buildReviewPrompt } from './lib/prompts.mjs';
