/**
 * Inlines the built bundle into a single self-contained page.
 *
 * The output has to open from a file:// URL by double-clicking it, with no server and no
 * install. A module script cannot do that - browsers refuse module imports over file://
 * - so the bundle is built as an IIFE and written into the HTML itself. The result is one
 * file that carries the analyser, parse5 and the interface together.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(here, 'build', 'demo.js'), 'utf8');
const html = readFileSync(join(here, 'index.html'), 'utf8');

const marker = '<script src="./demo.js"></script>';
if (!html.includes(marker)) throw new Error('index.html no longer carries the script marker');

// `</script>` inside the bundle would close the tag early.
const safe = js.replace(/<\/script/gi, '<\\/script');
// A replacer FUNCTION, not a string: `String.replace` expands `$&`, `$'` and `` $` `` in a
// replacement string, and a minified bundle is full of them. Passing a string here produced
// a file larger than the bundle it inlined, and a syntax error in the browser.
const out = html.replace(marker, () => `<script>\n${safe}\n</script>`);
const target = join(here, 'formfair-demo.html');
writeFileSync(target, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`wrote ${target} (${kb} KB, self-contained)`);
if (/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/.test(js)) {
  console.warn('WARNING: the bundle references a network API; check before distributing');
} else {
  console.log('no network API referenced in the bundle');
}
