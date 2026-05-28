#!/usr/bin/env node
// Optional Stop hook: runs an adversarial review of the previous Claude turn
// through the local agy CLI and blocks the session from ending if it finds
// issues that should be fixed first.
//
// Opt-in: does nothing unless AGY_STOP_REVIEW_GATE is 1/true/on/yes.
// agy --print returns plain text (no JSON protocol), so the verdict is read
// from the first output line: "ALLOW: ..." or "BLOCK: ...".

import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { findBinary, withLogFile } from './lib/agy.mjs';
import { buildReviewContext, gitResult } from './lib/git.mjs';
import { interpolateTemplate, loadPromptTemplate } from './lib/prompts.mjs';

const STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
const DISABLE_HINT = 'Run /agy:review manually, or disable the gate by unsetting AGY_STOP_REVIEW_GATE.';

function gateEnabled() {
  const value = String(process.env.AGY_STOP_REVIEW_GATE || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(message) {
  if (message) process.stderr.write(`${message}\n`);
}

function workspaceIsDirty() {
  const result = gitResult(['status', '--porcelain']);
  if (!result.ok) return false;
  return result.stdout.trim().length > 0;
}

function buildStopReviewPrompt(input) {
  const lastAssistantMessage = String(input.last_assistant_message ?? '').trim();
  const claudeResponseBlock = lastAssistantMessage
    ? ['Previous Claude response:', lastAssistantMessage].join('\n')
    : '';
  return interpolateTemplate(loadPromptTemplate('stop-review-gate'), {
    CLAUDE_RESPONSE_BLOCK: claudeResponseBlock,
    CONTEXT: buildReviewContext(),
  });
}

function parseStopReviewOutput(rawOutput) {
  const text = String(rawOutput ?? '').trim();
  if (!text) {
    return { ok: false, reason: `The stop-time agy review returned no output. ${DISABLE_HINT}` };
  }
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine.startsWith('ALLOW:')) {
    return { ok: true, reason: null };
  }
  if (firstLine.startsWith('BLOCK:')) {
    const reason = firstLine.slice('BLOCK:'.length).trim() || text;
    return {
      ok: false,
      reason: `agy stop-time review found issues that still need fixes before ending the session: ${reason}`,
    };
  }
  return { ok: false, reason: `The stop-time agy review returned an unexpected answer (no ALLOW/BLOCK first line). ${DISABLE_HINT}` };
}

function runStopReview(input) {
  const prompt = buildStopReviewPrompt(input);
  const result = spawnSync('agy', withLogFile(['--print', prompt, '--sandbox', '--print-timeout', '15m']), {
    encoding: 'utf8',
    timeout: STOP_REVIEW_TIMEOUT_MS + 30000,
  });

  if (result.error?.code === 'ETIMEDOUT') {
    return { ok: false, reason: `The stop-time agy review timed out after 15 minutes. ${DISABLE_HINT}` };
  }
  if (result.error) {
    return { ok: false, reason: `Failed to launch agy for the stop-time review: ${result.error.message}. ${DISABLE_HINT}` };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    return { ok: false, reason: detail ? `The stop-time agy review failed: ${detail}` : `The stop-time agy review failed. ${DISABLE_HINT}` };
  }
  return parseStopReviewOutput(result.stdout);
}

function main() {
  const input = readHookInput();

  // Opt-in only, and never recurse into our own continuation.
  if (!gateEnabled() || input.stop_hook_active) {
    return;
  }

  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    process.chdir(cwd);
  } catch {
    return;
  }

  // No agy binary -> warn, but never block the user from stopping.
  if (!findBinary('agy').ok) {
    logNote('agy is not available for the stop-review gate. Run /agy:setup.');
    return;
  }

  // Nothing changed in the working tree -> nothing to review, skip the model call.
  if (!workspaceIsDirty()) {
    return;
  }

  const review = runStopReview(input);
  if (!review.ok) {
    emitDecision({ decision: 'block', reason: review.reason });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
