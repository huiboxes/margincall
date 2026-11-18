import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = '.kiro/specs';
const entries = await readdir(root, { withFileTypes: true });
const specs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const open = [];
for (const spec of specs) {
  const path = join(root, spec, 'tasks.md');
  const text = await readFile(path, 'utf8');
  const remaining = text.split(/\r?\n/).filter((line) => /^\s*- \[ \]/.test(line));
  if (remaining.length) open.push(`${spec}: ${remaining.length}`);
}
console.log(`Spec task check: ${specs.length} specs, ${open.length ? open.join(', ') : 'no open tasks'}.`);
