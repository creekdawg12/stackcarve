// Cloudflare refuses any single file over 25 MiB. This build makes exactly one: a copy of the
// ONNX runtime's wasm, which the app never requests, because the AI library loads that runtime
// from jsDelivr at run time (see backends/onnx.js in @huggingface/transformers).
//
// When building for Cloudflare this leaves that copy out of dist. If any other file is over the
// limit the build stops, so a file the app does need can never go missing quietly. On any other
// host (GitHub Pages, a local build) it does nothing unless called with --force.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const LIMIT = 25 * 1024 * 1024;
const UNUSED = /(^|\/)ort-wasm[^/]*\.wasm$/;
const DIST = 'dist';

const forced = process.argv.includes('--force');
const onCloudflare = Boolean(process.env.CF_PAGES || process.env.WORKERS_CI);
if (!forced && !onCloudflare) process.exit(0);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path); else yield path;
  }
}

const mb = bytes => `${(bytes / 1048576).toFixed(1)} MB`;
const blocked = [];
let left = 0;
for (const file of walk(DIST)) {
  const { size } = statSync(file);
  if (size <= LIMIT) continue;
  const name = relative(DIST, file).split(sep).join('/');
  if (UNUSED.test(name)) {
    rmSync(file);
    left++;
    console.log(`Cloudflare build: left out ${name} (${mb(size)}); the app loads it from jsDelivr.`);
  } else {
    blocked.push(`${name} (${mb(size)})`);
  }
}

if (blocked.length) {
  console.error(`Cloudflare build: over the 25 MiB per-file limit and needed by the app:\n  ${blocked.join('\n  ')}`);
  process.exit(1);
}
if (!left) console.log('Cloudflare build: no file is over the 25 MiB limit.');
