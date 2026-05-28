// Background job lifecycle: spawn detached agy runs, track metadata, inspect state.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { jobDir } from './paths.mjs';

function redactArgs(args) {
  return args.map((arg) => arg === '--dangerously-skip-permissions' ? arg : arg);
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
  console.log(`status: agy-companion status ${id}`);
  console.log(`result: agy-companion result ${id}`);
}

function listJobs() {
  const dir = jobDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
}

function findJob(id) {
  if (!id) throw new Error('job id is required');
  const dir = jobDir();
  const metaPath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(metaPath)) throw new Error(`job not found: ${id}`);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  return { dir, meta, metaPath };
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

export { findJob, isRunning, listJobs, printJobStatus, redactArgs, startJob };
