/**
 * EXPLORATORY. Excluded from the formal results - see README.md in this directory.
 *
 * It measures evaluation-v1.0.0, not the active evaluation-v1.1.0 instrument; its miss
 * detection cannot see a single missed rule when another rule fired; and it is not gated by
 * CI. No claim in the study rests on it.
 *
 * Differential: FormFair's findings against what a real browser actually rejects.
 *
 * This is the evaluation that needs no human ground truth, and it measures the claim the
 * project actually makes. FormFair says a control excludes legitimate names. A browser is
 * the thing that would do the excluding. So every finding is checked against whether the
 * browser, running the control's own declared constraints, really does reject a name the
 * finding predicts it rejects.
 *
 *   CORROBORATED  the browser rejects a name this finding predicts, and accepts the
 *                 all-ASCII control, so the rejection is specific rather than a field that
 *                 rejects everything
 *   CONTRADICTED  the browser rejects no such name; the finding has no observable referent
 *   VACUOUS       the control rejects even "Smith", so nothing about it is specific
 *
 * And the other direction: a name the browser rejects, on a control where FormFair reported
 * nothing, is a MISSED EXCLUSION.
 *
 * Browser verdicts come from differential/browser-results.json, produced by opening
 * differential.html in the browser named there. Regenerate it after changing the corpus.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInstrument, instrumentDirFromEnv } from '../src/instrument-ref.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const browser = JSON.parse(readFileSync(join(here, 'browser-results.json'), 'utf8'));
const instrument = await loadInstrument(instrumentDirFromEnv());

const NAMES = browser.names;
const idx = (pred) => NAMES.map((n, i) => [n, i]).filter(([n]) => pred(n)).map(([, i]) => i);
const ASCII = idx((n) => n.k === 'ascii-control')[0];
const DIACRITIC = idx((n) => n.k === 'diacritic');
const PUNCT = idx((n) => n.k === 'punctuation');
const SHORT = idx((n) => n.k === 'short');
const PAIRS = [...new Set(NAMES.filter((n) => n.pair).map((n) => n.pair))].map((p) => ({
  nfc: NAMES.findIndex((n) => n.pair === p && n.k === 'nfc'),
  nfd: NAMES.findIndex((n) => n.pair === p && n.k === 'nfd'),
}));

const CHARS = browser.characters ?? [];
const chIdx = (pred) => CHARS.map((c, i) => [c, i]).filter(([c]) => pred(c)).map(([, i]) => i);
const BEYOND_BL = chIdx((c) => c.k === 'macron' || c.k === 'fixture-diacritic' || c.k === 'outside-fixture-set');
const REQUIRED_DIACRITIC = chIdx((c) => c.k === 'macron' || c.k === 'fixture-diacritic');
const PUNCT_CH = chIdx((c) => c.k === 'punctuation');

/** What the browser's character sweep establishes for one control. */
function admissions(bits) {
  if (!bits) return { beyondBasicLatinAdmitted: false, requiredDiacriticExcluded: false, punctuationExcluded: false };
  const ad = [...bits].map((b) => b === '1');
  return {
    beyondBasicLatinAdmitted: BEYOND_BL.some((i) => ad[i]),
    requiredDiacriticExcluded: REQUIRED_DIACRITIC.some((i) => !ad[i]),
    punctuationExcluded: PUNCT_CH.some((i) => !ad[i]),
  };
}

const attr = (k, v) => (v === null || v === undefined ? '' : ` ${k}="${String(v).replace(/"/g, '&quot;')}"`);
const pageFor = (c) =>
  `<!doctype html><html><body><form><label for="x">First name</label>` +
  `<input id="x" name="firstName" autocomplete="given-name" type="text"` +
  attr('pattern', c.p) + attr('minlength', c.ml) + attr('maxlength', c.xl) + `></form></body></html>`;

/** What each rule predicts the browser will do, given the rejection bits for a control. */
const PREDICTS = {
  'FF-01': (r) => DIACRITIC.some((i) => r[i]),
  // The precondition - admits letters beyond Basic Latin - is about CHARACTER admission,
  // and fixture names cannot witness it: `[A-Za-zøå]+` admits two such letters while
  // rejecting every fixture name, so on names alone a correct finding looks contradicted.
  // The browser's own character sweep answers it directly.
  'FF-02': (r, a) => a.beyondBasicLatinAdmitted && a.requiredDiacriticExcluded,
  'FF-03': (r) => PAIRS.some((p) => r[p.nfc] !== r[p.nfd]),
  'FF-04': (r, a) => PUNCT.some((i) => r[i]) || a.punctuationExcluded,
  'FF-05': (r) => SHORT.every((i) => r[i]),
};

const t = { findings: 0, corroborated: 0, contradicted: 0, vacuous: 0, declined: 0, missed: 0, controls: 0 };
const detail = [];

for (const [id, c] of Object.entries(browser.controls)) {
  const bits = [...c.bits].map((b) => b === '1');
  const html = pageFor(c);
  const detected = instrument.formfair.findNameControls(html);
  if (detected.length === 0) continue;
  t.controls += 1;

  const report = instrument.formfair.toJson(instrument.formfair.analyse(html));
  const fired = (report.findings ?? []).map((f) => f.rule);
  const declined = (report.declined ?? []).map((d) => d.rule);
  t.declined += declined.length;

  const vacuous = bits[ASCII];
  const adm = admissions(c.admit);

  for (const rule of fired) {
    t.findings += 1;
    if (vacuous) {
      t.vacuous += 1;
      detail.push({ control: id, rule, verdict: 'VACUOUS', why: 'the control rejects even the all-ASCII control name', pattern: c.p });
      continue;
    }
    if (PREDICTS[rule]?.(bits, adm)) t.corroborated += 1;
    else {
      t.contradicted += 1;
      detail.push({ control: id, rule, verdict: 'CONTRADICTED', why: 'the browser rejects no name this rule predicts', pattern: c.p, minlength: c.ml, maxlength: c.xl });
    }
  }

  // The other direction: a real exclusion the tool said nothing about.
  if (!vacuous && fired.length === 0 && declined.length === 0) {
    const excluded = NAMES.map((n, i) => (bits[i] ? n : null)).filter(Boolean);
    if (excluded.length > 0) {
      t.missed += 1;
      detail.push({ control: id, verdict: 'MISSED EXCLUSION', why: `browser rejects ${excluded.map((n) => n.n).join(', ')} but no finding was reported`, pattern: c.p, minlength: c.ml, maxlength: c.xl });
    }
  }
}

console.log('EXPLORATORY - excluded from formal results. See differential/README.md.');
console.log(`instrument ${instrument.tag} at ${instrument.commit.slice(0, 7)} (SUPERSEDED by evaluation-v1.1.0)`);
console.log(`browser    ${browser.ua.match(/Chrome\/[\d.]+/)?.[0] ?? 'unknown'}, captured ${browser.capturedAt}`);
console.log(`evidence   ${browser.decisions} name decisions + ${browser.charDecisions ?? 0} character decisions`);
console.log('');
console.log(`controls detected as name fields   ${t.controls} of ${Object.keys(browser.controls).length}`);
console.log(`findings reported                  ${t.findings}`);
console.log(`  corroborated by the browser      ${t.corroborated}`);
console.log(`  contradicted                     ${t.contradicted}`);
console.log(`  vacuous (control rejects all)    ${t.vacuous}`);
console.log(`rules declined                     ${t.declined}`);
console.log(`controls with a missed exclusion   ${t.missed}`);
const scored = t.corroborated + t.contradicted;
if (scored > 0) {
  console.log('');
  console.log(`Corroboration rate ${((t.corroborated / scored) * 100).toFixed(1)}% (${t.corroborated}/${scored} non-vacuous findings)`);
}
if (detail.length) {
  console.log('\nEverything not corroborated:');
  for (const d of detail) console.log(' ', JSON.stringify(d));
}
