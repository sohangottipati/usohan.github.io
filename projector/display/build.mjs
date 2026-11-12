// Bundles the projector display page into public/projector/display/ so the
// Next.js static export (and GitHub Pages) serve it as plain files.
// Usage: node projector/display/build.mjs [--watch]

import { build, context } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../public/projector/display');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  // Old Android WebView / Chromium on the projector.
  target: ['es2017', 'chrome61'],
  format: 'iife',
  outfile: join(outDir, 'display.js'),
  logLevel: 'info',
};

function writeHtml() {
  const js = readFileSync(join(outDir, 'display.js'));
  const hash = createHash('sha1').update(js).digest('hex').slice(0, 10);
  const html = readFileSync(join(here, 'index.html'), 'utf8').replace('__BUILD__', hash);
  writeFileSync(join(outDir, 'index.html'), html);
  const gz = gzipSync(js).length;
  console.log(`display.js ${(js.length / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzipped`);
  if (gz > 150 * 1024) {
    console.error('Display bundle is over the 150 KB gzipped budget.');
    process.exitCode = 1;
  }
}

mkdirSync(outDir, { recursive: true });
if (watch) {
  const ctx = await context({
    ...options,
    plugins: [{ name: 'html', setup: (b) => b.onEnd((r) => { if (!r.errors.length) writeHtml(); }) }],
  });
  await ctx.watch();
} else {
  await build(options);
  writeHtml();
}
