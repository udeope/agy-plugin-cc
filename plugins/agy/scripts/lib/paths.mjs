// Data directory resolution for jobs and logs.
// Precedence: AGY_COMPANION_DATA > CLAUDE_PLUGIN_DATA > OS temp dir.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function dataBaseDir() {
  return process.env.AGY_COMPANION_DATA || process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'agy-plugin-cc-data');
}

function jobDir() {
  const hash = crypto.createHash('sha256').update(fs.realpathSync(process.cwd())).digest('hex').slice(0, 16);
  return path.join(dataBaseDir(), 'jobs', hash);
}

function logDir() {
  return path.join(dataBaseDir(), 'logs');
}

export { dataBaseDir, jobDir, logDir };
