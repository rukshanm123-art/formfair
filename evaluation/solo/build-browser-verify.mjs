/**
 * Generates a page that puts every seeded mutation's browser expectation to a real browser.
 *
 * SOLO-PROTOCOL.md describes the mutation study as browser-confirmed. That claim is only
 * true if a browser confirms it. `browserCheck` in study.mjs was a Node reimplementation of
 * constraint validation - V8's regex engine, not a browser's - and reimplementing these
 * semantics by hand has been wrong six separate times in this project, including on the
 * case that matters most here: a pattern that does not compile is IGNORED by constraint
 * validation, so the field accepts everything, while a reimplementation naturally reports
 * that the check failed.
 *
 * Open this file in a browser; it prints JSON; `solo/browser-verdicts.json` records it.
 * study.mjs then reads those verdicts and refuses to run when a case has none, so the
 * evidence path cannot silently fall back to a reimplementation.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTATION_CASES } from './cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const SPECS = MUTATION_CASES.map((c) => ({
  id: c.id,
  rule: c.rule,
  family: c.family,
  pattern: c.browser.pattern ?? null,
  minlength: c.browser.minlength ?? null,
  maxlength: c.browser.maxlength ?? null,
  accepts: c.browser.accepts ?? [],
  rejects: c.browser.rejects ?? [],
}));

const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>FormFair mutation browser verification</title>
<style>
  :root { color-scheme: light dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  body { margin: 0; padding: 24px; max-width: 900px; }
  h1 { font-size: 1.1rem; margin: 0 0 4px; }
  p { margin: 0 0 16px; font-size: .85rem; opacity: .75; line-height: 1.5; }
  #summary { font-size: .85rem; margin-bottom: 16px; font-weight: 600; }
  pre { font-size: .7rem; line-height: 1.4; white-space: pre-wrap; word-break: break-all;
        border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
        padding: 12px; border-radius: 6px; max-height: 60vh; overflow: auto; }
  #probe { position: absolute; left: -9999px; }
</style>
</head>
<body>
<h1>Mutation browser verification</h1>
<p>
  Puts every seeded mutation's expected accept/reject behaviour to THIS browser's constraint
  validation. <code>patternMismatch</code> is the browser's verdict. Length is computed in
  UTF-16 code units, because <code>tooLong</code> and <code>tooShort</code> apply only to
  user-edited values. A pattern that does not compile applies no constraint at all.
</p>
<div id="summary">running…</div>
<pre id="out"></pre>
<input id="probe" type="text">
<script>
const SPECS = ${JSON.stringify(SPECS)};
const probe = document.getElementById('probe');

function compiles(pattern) {
  if (pattern === null) return { applied: false, ok: true };
  try { new RegExp('^(?:' + pattern + ')$', 'v'); return { applied: true, ok: true }; }
  catch (e) { return { applied: false, ok: false, reason: String(e.message) }; }
}

function patternRejects(pattern, value) {
  probe.removeAttribute('pattern');
  if (pattern !== null) probe.setAttribute('pattern', pattern);
  probe.value = value;
  const bad = probe.validity.patternMismatch;
  probe.value = '';
  return bad;
}

function verdictFor(spec, value) {
  const c = compiles(spec.pattern);
  const units = value.length;
  const tooShort = spec.minlength !== null && units < spec.minlength;
  const tooLong = spec.maxlength !== null && units > spec.maxlength;
  const byPattern = c.applied ? patternRejects(spec.pattern, value) : false;
  return {
    value, units, accepted: !(byPattern || tooShort || tooLong),
    rejectedByPattern: byPattern, rejectedByLength: tooShort || tooLong,
    patternApplied: c.applied, patternCompiles: c.ok,
  };
}

const cases = SPECS.map((spec) => ({
  id: spec.id, rule: spec.rule, family: spec.family,
  pattern: spec.pattern, minlength: spec.minlength, maxlength: spec.maxlength,
  shouldAccept: spec.accepts.map((v) => verdictFor(spec, v)),
  shouldReject: spec.rejects.map((v) => verdictFor(spec, v)),
}));

for (const c of cases) {
  c.expectationHolds =
    c.shouldAccept.every((r) => r.accepted) && c.shouldReject.every((r) => !r.accepted);
}

const out = {
  harness: 'solo-mutation-browser-verify-v1',
  userAgent: navigator.userAgent,
  cases: cases.length,
  assertions: cases.reduce((n, c) => n + c.shouldAccept.length + c.shouldReject.length, 0),
  expectationsHeld: cases.filter((c) => c.expectationHolds).length,
  results: cases,
};
window.RESULT = out;
document.getElementById('out').textContent = JSON.stringify(out, null, 1);
document.getElementById('summary').textContent =
  out.expectationsHeld + ' of ' + out.cases + ' mutation expectations hold in this browser (' +
  out.assertions + ' assertions). ' + navigator.userAgent;
document.title = 'mutation verify: ' + out.expectationsHeld + '/' + out.cases;
</script>
</body></html>
`;

writeFileSync(join(here, 'browser-verify.html'), page, 'utf8');
console.log(`wrote browser-verify.html: ${SPECS.length} cases, ${SPECS.reduce((n, s) => n + s.accepts.length + s.rejects.length, 0)} assertions`);
