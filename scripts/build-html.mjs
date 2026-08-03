// Build the distributable single-file tracker: dist/HPT-Tracker.html
// Inlines css/styles.css and js/app.js into index.html and embeds the current
// encrypted data envelope, so the file works opened from anywhere (file://,
// SharePoint download, email attachment) with no server and no network.
// Run AFTER scripts/publish.mjs so the embedded snapshot is current.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let html = read('index.html');
const css = read('css/styles.css');
const js = read('js/app.js');
const envelope = read('data/data.enc.json').trim();

// Inline the stylesheet.
html = html.replace(/<link rel="stylesheet" href="css\/styles\.css[^"]*">/,
  () => `<style>\n${css}\n</style>`);

// Embed the encrypted snapshot + build stamp, then inline the app.
const bootstrap = `<script>window.__HPT_EMBEDDED = ${envelope};\nwindow.__HPT_BUILD = ${JSON.stringify(new Date().toISOString())};</script>`;
html = html.replace(/<script src="js\/app\.js[^"]*"><\/script>/,
  () => `${bootstrap}\n<script>\n${js}\n</script>`);

if (html.includes('js/app.js') || html.includes('css/styles.css')) {
  console.error('Inlining failed — index.html references did not match.');
  process.exit(1);
}

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'HPT-Tracker.html');
writeFileSync(out, html);
console.log(`Built ${out} (${Math.round(html.length / 1024)} KB, snapshot ${JSON.parse(envelope).lastUpdated})`);
