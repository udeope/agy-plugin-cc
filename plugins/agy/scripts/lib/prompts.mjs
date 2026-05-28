// Prompt template loading and interpolation.
// Templates live in plugins/agy/prompts/*.md and use {{PLACEHOLDER}} tokens.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts');

function loadPromptTemplate(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8');
}

function interpolateTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));
}

function buildReviewPrompt({ adversarial, context, extra }) {
  const template = loadPromptTemplate(adversarial ? 'adversarial-review' : 'review');
  return interpolateTemplate(template, {
    EXTRA: extra ? `Additional user instructions: ${extra}\n\n` : '',
    CONTEXT: context,
  });
}

export { PROMPTS_DIR, buildReviewPrompt, interpolateTemplate, loadPromptTemplate };
