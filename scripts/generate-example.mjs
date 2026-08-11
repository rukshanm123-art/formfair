/**
 * Regenerates examples/sample-report.html from the built package, so the committed
 * example cannot drift from what the analyser actually emits — and so generating it
 * exercises dist/ rather than the sources.
 */

import { writeFileSync } from 'node:fs';
import { analyse, toHtml } from '../dist/index.js';

const SAMPLE = `<form>
  <label for="fn">First name</label>
  <input id="fn" name="firstName" pattern="[A-Za-z]{2,40}" minlength="2" maxlength="40">
  <label for="ln">Last name</label>
  <input id="ln" name="lastName" pattern="[\\p{L}\\u0027\\u2019 \\x2D]+">
  <label for="pn">Preferred name</label>
  <input id="pn" name="preferredName" pattern="[\\p{L}\\p{M}\\u0027\\u2019 \\x2D]+">
</form>`;

writeFileSync(new URL('../examples/sample-report.html', import.meta.url), toHtml(analyse(SAMPLE)));
console.log('examples/sample-report.html regenerated');
