// 源码约束检查（棘轮）：新文件 < 300 行；已知超长文件只允许变短，不允许变长。
// 拆分某个文件后，把它从 BASELINE 删掉（或调低数字），之后它就受 300 行硬限制。
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const MAX_LINES = 300;
const root = process.cwd();
const targets = ['index.html', 'css', 'js'];
const sourceExts = new Set(['.html', '.css', '.js', '.mjs']);

const BASELINE = {
  'js/core/audio.js': 328,
  'js/core/buffs.js': 516,
  'js/core/engine.js': 1446,
  'js/ui/app.js': 2004,
  'js/ui/chart.js': 545,
  'css/base.css': 1319,
  'css/themes/crt.css': 861,
  'css/themes/neon.css': 315,
  'css/themes/pop.css': 406,
  'css/themes/receipt.css': 687,
  'css/themes/sumi.css': 908,
  'css/themes/tarot.css': 583,
  'css/themes/vapor.css': 395,
  'css/themes/vault.css': 416,
};

async function collect(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const nested = await Promise.all(entries.map((e) => collect(join(path, e.name))));
    return nested.flat();
  } catch {
    return sourceExts.has(extname(path)) ? [path] : [];
  }
}

const issues = [];
const files = (await Promise.all(targets.map((t) => collect(join(root, t))))).flat();
for (const file of files) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { continue; }
  const name = relative(root, file).split(sep).join('/');
  const lines = text.split(/\r?\n/).length;
  const limit = BASELINE[name] ?? MAX_LINES - 1;
  if (lines > limit) {
    issues.push(`${name}: ${lines} lines (limit ${limit}${BASELINE[name] ? ', baseline' : ''})`);
  }
  // SVG/XML 命名空间 URI（w3.org）只是标识符，不会发起请求
  if (/https?:\/\//i.test(text.replaceAll('http://www.w3.org/', ''))) issues.push(`${name}: external URL detected`);
  if (/\b(react|vue|angular|phaser)\b/i.test(text)) issues.push(`${name}: framework reference detected`);
}

const debt = Object.keys(BASELINE).length;
if (issues.length) {
  console.error(`Source check failed:\n- ${issues.join('\n- ')}`);
  process.exit(1);
}
console.log(`Source check passed (${files.length} files, ${debt} oversize files in baseline).`);
