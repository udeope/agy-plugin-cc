// Git inspection and review-context assembly.
// Collects status, diffs, and untracked files into a single inline payload,
// truncating to stay below common shell argument limits.

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const MAX_CONTEXT_BYTES = 96 * 1024;
const MAX_UNTRACKED_FILE_BYTES = 24 * 1024;

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

function git(args) {
  const result = gitResult(args);
  if (result.ok) {
    return result.stdout;
  }
  return `[git ${args.join(' ')} failed: ${(result.stderr || result.error || `exit ${result.status}`).trim()}]\n`;
}

function truncateBytes(text, limit) {
  if (limit <= 0) return '';
  const buffer = Buffer.from(text);
  return buffer.subarray(0, limit).toString('utf8');
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

export {
  MAX_CONTEXT_BYTES,
  MAX_UNTRACKED_FILE_BYTES,
  buildReviewContext,
  git,
  gitResult,
  readUntrackedTextFile,
  truncateBytes,
};
