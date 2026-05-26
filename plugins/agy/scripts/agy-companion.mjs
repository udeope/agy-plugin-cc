#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const MAX_CONTEXT_BYTES = 96 * 1024;
const MAX_UNTRACKED_FILE_BYTES = 24 * 1024;
const SETTINGS_PATH = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
const WRITE_WORDS = /\b(fix|apply|change|modify|edit|write|implement|update|patch|repair|refactor|create|delete|remove|rename)\b/i;

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

function parseInvocationArgs(rawArgs) {
  if (rawArgs.length === 1) {
    return shellSplit(rawArgs[0]);
  }
  return rawArgs;
}

function shellSplit(input) {
  const out = [];
  let token = '';
  let quote = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      token += char;
      escaping = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (token.length > 0) {
        out.push(token);
        token = '';
      }
      continue;
    }
    token += char;
  }

  if (escaping) {
    token += '\\';
  }
  if (quote) {
    throw new Error(`unterminated ${quote} quote in arguments`);
  }
  if (token.length > 0) {
    out.push(token);
  }
  return out;
}

function parseFlags(args) {
  const flags = {
    json: false,
    authCheck: false,
    background: false,
    wait: false,
    write: false,
    continueConversation: false,
    conversation: null,
    base: null,
    dangerouslySkipPermissions: false,
    positional: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      flags.positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--json') flags.json = true;
    else if (arg === '--auth-check') flags.authCheck = true;
    else if (arg === '--background') flags.background = true;
    else if (arg === '--wait') flags.wait = true;
    else if (arg === '--write') flags.write = true;
    else if (arg === '--continue') flags.continueConversation = true;
    else if (arg === '--dangerously-skip-permissions') flags.dangerouslySkipPermissions = true;
    else if (arg === '--base') flags.base = requireValue(args, ++i, '--base');
    else if (arg.startsWith('--base=')) flags.base = arg.slice('--base='.length);
    else if (arg === '--conversation') flags.conversation = requireValue(args, ++i, '--conversation');
    else if (arg.startsWith('--conversation=')) flags.conversation = arg.slice('--conversation='.length);
    else flags.positional.push(arg);
  }

  return flags;
}

function requireValue(args, index, flag) {
  if (index >= args.length || args[index].startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index];
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

function runAuthCheck() {
  const result = spawnSync('agy', ['--print', 'Reply with only OK', '--sandbox', '--print-timeout', '20s'], {
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

async function runReview(args, adversarial) {
  const flags = parseFlags(args);
  const context = buildReviewContext(flags.base);
  const extra = flags.positional.join(' ').trim();
  const prompt = buildReviewPrompt({ adversarial, context, extra });
  const agyArgs = ['--print', prompt, '--sandbox'];

  if (flags.background) {
    return startJob(adversarial ? 'adversarial-review' : 'review', agyArgs);
  }

  return runForeground(agyArgs);
}

function buildReviewPrompt({ adversarial, context, extra }) {
  const mode = adversarial ? 'adversarial review' : 'code review';
  return [
    `You are performing a ${mode} of the git context below.`,
    'Focus on correctness, regressions, security, missing tests, and concrete file-level risks.',
    'Do not suggest unrelated refactors.',
    extra ? `Additional user instructions: ${extra}` : null,
    '',
    context,
  ].filter(Boolean).join('\n');
}

function buildReviewContext(base) {
  const chunks = [];
  let totalBytes = 0;
  let truncated = false;

  const add = (title, body, limit = Infinity) => {
    const text = body || '(empty)\n';
    let section = `\n## ${title}\n\n${text.endsWith('\n') ? text : `${text}\n`}`;
    const bytes = Buffer.byteLength(section);
    if (bytes > limit) {
      section = truncateBytes(section, limit) + '\n[truncated: section exceeded limit]\n';
      truncated = true;
    }
    const remaining = MAX_CONTEXT_BYTES - totalBytes;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (Buffer.byteLength(section) > remaining) {
      section = truncateBytes(section, remaining) + '\n[truncated: total context exceeded inline payload limit]\n';
      truncated = true;
    }
    totalBytes += Buffer.byteLength(section);
    chunks.push(section);
  };

  add('git status --short --untracked-files=all', git(['status', '--short', '--untracked-files=all']));
  if (base) {
    const mergeBaseResult = gitResult(['merge-base', 'HEAD', base]);
    const mergeBase = mergeBaseResult.ok ? mergeBaseResult.stdout.trim() : '';
    add(`git log ${base}..HEAD`, git(['log', '--oneline', '--decorate', `${base}..HEAD`]));
    if (mergeBase) {
      add(`git diff ${mergeBase}...HEAD`, git(['diff', '--find-renames', `${mergeBase}...HEAD`]));
    } else {
      add(`git merge-base HEAD ${base}`, mergeBaseResult.stderr || mergeBaseResult.error || '(no merge-base found)');
      add(`git diff ${base}...HEAD`, git(['diff', '--find-renames', `${base}...HEAD`]));
    }
  }
  add('staged diff', git(['diff', '--cached', '--find-renames']));
  add('unstaged diff', git(['diff', '--find-renames']));

  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const file of untracked) {
    if (totalBytes >= MAX_CONTEXT_BYTES) {
      truncated = true;
      break;
    }
    const body = readUntrackedTextFile(file);
    if (body !== null) {
      add(`untracked file: ${file}`, body, MAX_UNTRACKED_FILE_BYTES + 512);
    }
  }

  if (truncated) {
    chunks.unshift('[note: review context was truncated to fit inline payload limits]\n');
  }
  return chunks.join('');
}

function git(args) {
  const result = gitResult(args);
  if (result.ok) {
    return result.stdout;
  }
  return `[git ${args.join(' ')} failed: ${(result.stderr || result.error || `exit ${result.status}`).trim()}]\n`;
}

function gitResult(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10000,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || null,
  };
}

function readUntrackedTextFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    const fd = fs.openSync(file, 'r');
    const sample = Buffer.alloc(Math.min(stat.size, MAX_UNTRACKED_FILE_BYTES));
    fs.readSync(fd, sample, 0, sample.length, 0);
    fs.closeSync(fd);
    if (sample.includes(0)) return `[binary file omitted]\n`;
    let text = sample.toString('utf8');
    if (stat.size > MAX_UNTRACKED_FILE_BYTES) {
      text += '\n[truncated: untracked file exceeded 24 KB]\n';
    }
    return text;
  } catch (error) {
    return `[failed to read untracked file: ${error.message}]\n`;
  }
}

function truncateBytes(text, limit) {
  if (limit <= 0) return '';
  const buffer = Buffer.from(text);
  return buffer.subarray(0, limit).toString('utf8');
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

  if (flags.background) {
    return startJob('rescue', agyArgs);
  }

  return runForeground(agyArgs);
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

function startJob(kind, agyArgs) {
  const dir = jobDir();
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const outPath = path.join(dir, `${id}.out`);
  const errPath = path.join(dir, `${id}.err`);
  const metaPath = path.join(dir, `${id}.json`);
  const outFd = fs.openSync(outPath, 'a');
  const errFd = fs.openSync(errPath, 'a');
  const child = spawn('agy', agyArgs, {
    detached: true,
    stdio: ['ignore', outFd, errFd],
  });
  child.unref();
  fs.closeSync(outFd);
  fs.closeSync(errFd);

  const meta = {
    id,
    kind,
    pid: child.pid,
    cwd: process.cwd(),
    startedAt: new Date().toISOString(),
    args: redactArgs(agyArgs),
    outPath,
    errPath,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`started ${kind} job ${id}`);
  console.log(`status: node scripts/agy-companion.mjs status ${id}`);
  console.log(`result: node scripts/agy-companion.mjs result ${id}`);
}

function redactArgs(args) {
  return args.map((arg) => arg === '--dangerously-skip-permissions' ? arg : arg);
}

function jobDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'agy-plugin-cc-data');
  const hash = crypto.createHash('sha256').update(fs.realpathSync(process.cwd())).digest('hex').slice(0, 16);
  return path.join(base, 'jobs', hash);
}

function findJob(id) {
  if (!id) throw new Error('job id is required');
  const dir = jobDir();
  const metaPath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(metaPath)) throw new Error(`job not found: ${id}`);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  return { dir, meta, metaPath };
}

function status(args) {
  const flags = parseFlags(args);
  const dir = jobDir();
  if (!fs.existsSync(dir)) {
    console.log('no jobs for this workspace');
    return;
  }
  if (flags.positional[0]) {
    const { meta } = findJob(flags.positional[0]);
    printJobStatus(meta);
    return;
  }
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    printJobStatus(meta);
  }
}

function printJobStatus(meta) {
  console.log(`${meta.id}\t${meta.kind}\tpid=${meta.pid}\t${isRunning(meta.pid) ? 'running' : 'finished'}\t${meta.startedAt}`);
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

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function help() {
  console.log('usage: agy-companion.mjs <setup|review|adversarial-review|rescue|status|result|cancel> [args]');
}

export {
  assertTrustedForWrite,
  buildReviewContext,
  buildReviewPrompt,
  jobDir,
  normalizeTrustedWorkspaces,
  parseFlags,
  parseInvocationArgs,
  shellSplit,
};
