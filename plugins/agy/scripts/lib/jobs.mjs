// Background job lifecycle: spawn detached agy runs, track metadata, inspect state.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { jobDir, logDir } from './paths.mjs';

const DEFAULT_RETENTION_DAYS = 7;

// Job metadata is persisted to disk, so the prompt that follows --print/-p
// (which can contain task descriptions or pasted code) is replaced with a
// length-only placeholder. Flags and the conversation id are kept for debugging.
function redactArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    out.push(arg);
    if ((arg === '--print' || arg === '-p') && i + 1 < args.length) {
      out.push(`<redacted prompt (${args[i + 1].length} chars)>`);
      i += 1;
    }
  }
  return out;
}

function readMeta(metaPath) {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already gone or not removable; ignore
  }
}

function retentionDays() {
  const value = Number(process.env.AGY_COMPANION_RETENTION_DAYS);
  return Number.isFinite(value) ? value : DEFAULT_RETENTION_DAYS;
}

function startJob(kind, agyArgs) {
  // Opportunistic cleanup so finished jobs and stale logs don't accumulate
  // unbounded; never let pruning failures block starting a new job.
  try {
    pruneOldArtifacts();
  } catch {
    // best-effort only
  }

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
  console.log(`status: agy-companion status ${id}`);
  console.log(`result: agy-companion result ${id}`);
}

function listJobs() {
  const dir = jobDir();
  if (!fs.existsSync(dir)) return [];
  // Tolerate a single corrupt/partial metadata file (e.g. an interrupted
  // write) instead of letting it break listing for every other job.
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((file) => readMeta(path.join(dir, file)))
    .filter(Boolean);
}

function findJob(id) {
  if (!id) throw new Error('job id is required');
  const dir = jobDir();
  const metaPath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(metaPath)) throw new Error(`job not found: ${id}`);
  const meta = readMeta(metaPath);
  if (!meta) throw new Error(`job metadata is corrupt: ${id}`);
  return { dir, meta, metaPath };
}

// Remove finished jobs (and their out/err files) older than the retention
// window, plus any unparseable metadata. Returns the count removed.
function pruneJobs() {
  const days = retentionDays();
  const dir = jobDir();
  if (days <= 0 || !fs.existsSync(dir)) return { removed: 0 };
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const metaPath = path.join(dir, file);
    const meta = readMeta(metaPath);
    if (!meta) {
      safeUnlink(metaPath);
      removed += 1;
      continue;
    }
    const startedAt = Date.parse(meta.startedAt || '') || 0;
    if (startedAt && startedAt < cutoff && !isRunning(meta.pid)) {
      safeUnlink(meta.outPath);
      safeUnlink(meta.errPath);
      safeUnlink(metaPath);
      removed += 1;
    }
  }
  return { removed };
}

// Remove agy log files older than the retention window. Logs are shared across
// workspaces, so this is keyed on file mtime rather than job metadata.
function pruneLogs() {
  const days = retentionDays();
  const dir = logDir();
  if (days <= 0 || !fs.existsSync(dir)) return { removed: 0 };
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.log')) continue;
    const logPath = path.join(dir, file);
    let mtime = 0;
    try {
      mtime = fs.statSync(logPath).mtimeMs;
    } catch {
      continue;
    }
    if (mtime < cutoff) {
      safeUnlink(logPath);
      removed += 1;
    }
  }
  return { removed };
}

function pruneOldArtifacts() {
  return { jobs: pruneJobs(), logs: pruneLogs() };
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function printJobStatus(meta) {
  console.log(`${meta.id}\t${meta.kind}\tpid=${meta.pid}\t${isRunning(meta.pid) ? 'running' : 'finished'}\t${meta.startedAt}`);
}

export {
  findJob,
  isRunning,
  listJobs,
  printJobStatus,
  pruneJobs,
  pruneLogs,
  pruneOldArtifacts,
  redactArgs,
  startJob,
};
