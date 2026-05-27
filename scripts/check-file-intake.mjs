import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const agentRoot = path.join(repoRoot, 'server', 'agents');

const FILE_INPUT_PATTERNS = [
  /\bfileData\b/,
  /Buffer\.from\([^)]*['"]base64['"]/,
  /\breq\.files?\b/,
];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const files = await walk(agentRoot);
const offenders = [];

for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  const acceptsFileBytes = FILE_INPUT_PATTERNS.some((pattern) => pattern.test(text));
  const usesFileIntake = /FileIntakeService/.test(text);
  if (acceptsFileBytes && !usesFileIntake) {
    offenders.push(path.relative(repoRoot, file));
  }
}

if (offenders.length > 0) {
  console.error('Agents that accept file bytes must use server/services/FileIntakeService.js:');
  for (const offender of offenders) console.error(`- ${offender}`);
  process.exit(1);
}

console.log(`File intake check passed (${files.length} agent files scanned).`);
