// Interaction with the local `agy` (Antigravity) CLI: binary discovery,
// settings/trusted-workspace resolution, log-file injection, and process launch.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { logDir } from './paths.mjs';

const SETTINGS_PATH = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
const WRITE_WORDS = /\b(fix|apply|change|modify|edit|write|implement|update|patch|repair|refactor|create|delete|remove|rename)\b/i;

function findBinary(name) {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  if (result.status === 0) {
    return { ok: true, path: result.stdout.trim() };
  }
  return { ok: false, path: null, error: result.stderr.trim() || `${name} not found in PATH` };
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return {
      ok: true,
      raw: parsed,
      trustedWorkspaces: normalizeTrustedWorkspaces(parsed),
    };
  } catch (error) {
    return { ok: false, raw: null, trustedWorkspaces: [], error: error.message };
  }
}

function normalizeTrustedWorkspaces(settings) {
  const candidates = [
    settings?.trustedWorkspaces,
    settings?.trusted_workspaces,
    settings?.security?.trustedWorkspaces,
    settings?.workspaceTrust?.trustedWorkspaces,
  ].find(Array.isArray) || [];

  return candidates
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry.path === 'string') return entry.path;
      return null;
    })
    .filter(Boolean);
}

// Inject a companion-owned --log-file so agy never writes to its default
// shared log path, keeping concurrent jobs isolated.
function withLogFile(args) {
  if (args.includes('--log-file')) return args;
  fs.mkdirSync(logDir(), { recursive: true });
  const file = `agy-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.log`;
  return ['--log-file', path.join(logDir(), file), ...args];
}

function runAuthCheck() {
  const result = spawnSync('agy', withLogFile(['--print', 'Reply with only OK', '--sandbox', '--print-timeout', '20s']), {
    encoding: 'utf8',
    timeout: 30000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    status: result.status,
    ok: result.status === 0 && /\bOK\b/.test(output),
    output,
    error: result.error?.message || (result.status === 0 ? null : `exit ${result.status}`),
  };
}

function assertTrustedForWrite(cwd) {
  const settings = readSettings();
  if (!settings.ok) {
    throw new Error(`write denied: cannot read trusted workspaces from ${SETTINGS_PATH}: ${settings.error}`);
  }

  const realCwd = fs.realpathSync(cwd);
  const trusted = settings.trustedWorkspaces
    .map((workspace) => path.resolve(os.homedir(), workspace.replace(/^~(?=$|\/|\\)/, '.')))
    .map((workspace) => {
      try {
        return fs.realpathSync(workspace);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const ok = trusted.some((trustedPath) => realCwd === trustedPath || realCwd.startsWith(trustedPath + path.sep));
  if (!ok) {
    throw new Error(`write denied: ${realCwd} is not under any trusted Antigravity workspace`);
  }
}

function runForeground(args) {
  const child = spawn('agy', args, { stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`failed to start agy: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.exitCode = 1;
      console.error(`agy terminated by ${signal}`);
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

export {
  SETTINGS_PATH,
  WRITE_WORDS,
  assertTrustedForWrite,
  findBinary,
  normalizeTrustedWorkspaces,
  readSettings,
  runAuthCheck,
  runForeground,
  withLogFile,
};
