/**
 * Generates a standalone page that runs the browser differential.
 *
 * The question FormFair actually claims to answer is "would this form reject this person's
 * name?". A browser answers that authoritatively, because a browser IS the thing that
 * rejects it. This harness asks it directly, for every control in the benchmark crossed
 * with every fixture name, and the result is ground truth by execution in the same engine
 * the end user's browser runs.
 *
 * DIVISION OF AUTHORITY, and it is deliberate.
 *   - `patternMismatch` comes from the browser. This is the hard part - the `v` flag,
 *     Unicode property escapes, class semantics - and it is exactly where a hand-written
 *     reimplementation kept being wrong.
 *   - Length is computed here in UTF-16 code units. The HTML Standard applies `tooLong`
 *     and `tooShort` only to values the USER edited, so a programmatically assigned value
 *     never triggers them; the browser cannot be asked. The arithmetic is trivial and
 *     uncontested, which is why splitting it off costs nothing.
 *
 * No dependency is added to the repository: the output is one HTML file that runs in any
 * browser and prints JSON.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME_CONTROLS } from '../calibration/controls.mjs';
import {
  DIACRITIC_NAMES,
  PUNCTUATED_NAMES,
  SHORT_NAMES,
  ASCII_CONTROL,
  NORMALISATION_PAIRS,
} from '../oracle/fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Every fixture name, tagged with what its rejection would mean. */
const NAMES = [
  { name: ASCII_CONTROL, kind: 'ascii-control', note: 'any usable name field must accept this' },
  ...DIACRITIC_NAMES.map((d) => ({ name: d.name, kind: 'diacritic', locale: d.locale })),
  ...PUNCTUATED_NAMES.map((p) => ({ name: p.name, kind: 'punctuation', codePoint: p.codePoint })),
  ...SHORT_NAMES.map((n) => ({ name: n, kind: 'short' })),
  ...NORMALISATION_PAIRS.flatMap((p) => [
    { name: p.nfc, kind: 'nfc', pair: p.nfc },
    { name: p.nfd, kind: 'nfd', pair: p.nfc },
  ]),
];

/**
 * The benchmark controls: the calibration corpus, plus the cases that broke every previous
 * attempt at a hand-written oracle. Those are kept because a benchmark that cannot
 * distinguish a correct implementation from a broken one is worth nothing, and the
 * calibration corpus alone demonstrably could not.
 */
const HARD_CASES = [
  { id: 'H01', pattern: '[A-Za-z]{6,10}', note: 'no short probe fits; defeated probe-based reasoning' },
  { id: 'H02', pattern: '[0-9]{1,5}', note: 'admits no letters at all' },
  { id: 'H03', pattern: '[d]', note: 'a single letter outside any hand-picked sample' },
  { id: 'H04', pattern: '', note: 'present but empty: compiles to an anchored empty expression' },
  { id: 'H05', pattern: null, note: 'absent attribute: no pattern applied' },
  { id: 'H06', pattern: "[A-Za-z' -]+", note: 'bare hyphen: does not compile under the v flag' },
  { id: 'H07', pattern: '(?:[A-Za-z]+ )?[A-Za-z]+', note: 'group: FormFair declines, a browser does not' },
  { id: 'H08', pattern: '^[A-Za-z]+$|^$', note: 'alternation: FormFair declines' },
  { id: 'H09', pattern: '[A-Za-zøå]+', note: 'Danish, outside every hand-written sample' },
  { id: 'H10', pattern: '[\\p{L}\\p{M}]+', note: 'property escapes admit supplementary-plane letters' },
  { id: 'H11', pattern: '[A-Za-z]+', minlength: 2, note: 'length constraint with a permissive class' },
  { id: 'H12', pattern: null, maxlength: 7, note: 'maxlength alone can split an NFC/NFD pair' },
];

const CONTROLS = [
  ...NAME_CONTROLS.map((c) => ({
    id: c.id,
    pattern: c.pattern ?? null,
    minlength: c.minlength ?? null,
    maxlength: c.maxlength ?? null,
    note: c.note,
  })),
  ...HARD_CASES.map((c) => ({
    id: c.id,
    pattern: c.pattern === undefined ? null : c.pattern,
    minlength: c.minlength ?? null,
    maxlength: c.maxlength ?? null,
    note: c.note,
  })),
];

/**
 * Individual characters, tested alongside whole names.
 *
 * Fixture NAMES cannot witness character admission: `[A-Za-zøå]+` admits letters outside
 * Basic Latin, but no fixture name contains o-slash or a-ring, so every name is rejected
 * and the admission is invisible. FF-02's trigger turns on exactly that admission, so the
 * character sweep is not an optional extra - without it a correct finding looks
 * contradicted. The browser evaluates these, so the authority is the same as for names.
 */
const CHARACTERS = [
  { ch: 'a', kind: 'basic-latin' },
  { ch: 'Z', kind: 'basic-latin' },
  { ch: 'd', kind: 'basic-latin' },
  ...[...'\u0101\u0113\u012b\u014d\u016b'].map((ch) => ({ ch, kind: 'macron' })),
  ...[...'\u00e9\u00c9\u00fc\u00f1\u0159\u0141\u1ec5\u02bb'].map((ch) => ({ ch, kind: 'fixture-diacritic' })),
  ...[...'\u00f8\u00e5\u0111\u0127\u03b1\u0430'].map((ch) => ({ ch, kind: 'outside-fixture-set' })),
  ...[..."'\u2019 -"].map((ch) => ({ ch, kind: 'punctuation' })),
  { ch: '0', kind: 'digit' },
];

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FormFair browser differential</title>
<style>
  :root { color-scheme: light dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  body { margin: 0; padding: 24px; max-width: 900px; }
  h1 { font-size: 1.1rem; margin: 0 0 4px; }
  p { margin: 0 0 16px; font-size: .85rem; opacity: .75; line-height: 1.5; }
  #summary { font-size: .85rem; margin-bottom: 16px; }
  pre { font-size: .7rem; line-height: 1.4; white-space: pre-wrap; word-break: break-all;
        border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
        padding: 12px; border-radius: 6px; max-height: 60vh; overflow: auto; }
  #probe { position: absolute; left: -9999px; }
</style>
</head>
<body>
<h1>FormFair browser differential</h1>
<p>
  Asks this browser, for every benchmark control crossed with every fixture name, whether the
  control's declared constraints reject the name. <code>patternMismatch</code> is the browser's
  own verdict. Length is computed in UTF-16 code units, because the HTML Standard applies
  <code>tooLong</code> and <code>tooShort</code> only to user-edited values.
</p>
<div id="summary">running…</div>
<pre id="out"></pre>
<input id="probe" type="text">

<script>
const NAMES = ${JSON.stringify(NAMES)};
const CONTROLS = ${JSON.stringify(CONTROLS)};
const CHARACTERS = ${JSON.stringify(CHARACTERS)};

const probe = document.getElementById('probe');

function compiles(pattern) {
  if (pattern === null) return { ok: true, applied: false };
  try { new RegExp('^(?:' + pattern + ')$', 'v'); return { ok: true, applied: true }; }
  catch (e) { return { ok: false, applied: false, reason: String(e.message) }; }
}

/** Asks the browser. Returns true when THIS browser reports a pattern mismatch. */
function patternRejects(pattern, value) {
  probe.removeAttribute('pattern');
  if (pattern !== null) probe.setAttribute('pattern', pattern);
  probe.value = value;
  const bad = probe.validity.patternMismatch;
  probe.value = '';
  return bad;
}

const results = [];
for (const c of CONTROLS) {
  const c1 = compiles(c.pattern);
  for (const n of NAMES) {
    const units = n.name.length;
    const tooShort = c.minlength !== null && units < c.minlength;
    const tooLong = c.maxlength !== null && units > c.maxlength;
    // An uncompilable pattern is ignored by constraint validation: no expression applies.
    const byPattern = c1.applied ? patternRejects(c.pattern, n.name) : false;
    results.push({
      control: c.id, pattern: c.pattern, minlength: c.minlength, maxlength: c.maxlength,
      name: n.name, kind: n.kind, locale: n.locale ?? null, codePoint: n.codePoint ?? null,
      pair: n.pair ?? null, units,
      patternApplied: c1.applied, patternCompiles: c1.ok,
      rejectedByPattern: byPattern, rejectedByLength: tooShort || tooLong,
      rejected: byPattern || tooShort || tooLong,
    });
  }
}

// Character admission, probed at several lengths because a length attribute would
// otherwise read as a character restriction. A hit is a WITNESS that the character is
// admitted; a miss is only a miss, and nothing here treats it as proof of absence.
const charResults = [];
for (const c of CONTROLS) {
  const c1 = compiles(c.pattern);
  for (const t of CHARACTERS) {
    let admitted = false;
    if (!c1.applied) admitted = true;
    else {
      const lens = [1, 2, 3, 5, 6, 8, 10, c.minlength, c.maxlength].filter((n) => Number.isFinite(n) && n > 0 && n <= 32);
      for (const n of new Set(lens)) {
        const v = t.ch.repeat(n);
        const tooShort = c.minlength !== null && v.length < c.minlength;
        const tooLong = c.maxlength !== null && v.length > c.maxlength;
        if (!tooShort && !tooLong && !patternRejects(c.pattern, v)) { admitted = true; break; }
      }
    }
    charResults.push({ control: c.id, ch: t.ch, kind: t.kind, admitted });
  }
}

const out = {
  harness: 'browser-differential-v2',
  userAgent: navigator.userAgent,
  controls: CONTROLS.length,
  names: NAMES.length,
  decisions: results.length,
  rejections: results.filter(r => r.rejected).length,
  characters: CHARACTERS.length,
  charDecisions: charResults.length,
  results,
  charResults,
};
window.RESULT = out;
document.getElementById('out').textContent = JSON.stringify(out, null, 1);
document.getElementById('summary').textContent =
  out.decisions + ' decisions over ' + out.controls + ' controls x ' + out.names +
  ' fixture names. ' + out.rejections + ' rejections. Engine: ' + navigator.userAgent;
document.title = 'differential: ' + out.decisions + ' decisions';
</script>
</body>
</html>
`;

mkdirSync(here, { recursive: true });
writeFileSync(join(here, 'differential.html'), page, 'utf8');
console.log(`wrote differential.html: ${CONTROLS.length} controls x ${NAMES.length} names = ${CONTROLS.length * NAMES.length} decisions`);
