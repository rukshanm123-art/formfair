/**
 * Three-way comparison over the calibration corpus:
 *   KEY    - labels a human derived by reading catalogue-v1.0.0
 *   ORACLE - labels derived by executing the constraints against the frozen fixtures
 *   TOOL   - labels FormFair produces by parsing and enumerating character sets
 *
 * Where all three agree, the label is about as well established as it can be. Where the
 * oracle and the tool agree and the human differs, the human misread the catalogue. Where
 * the oracle and the tool differ, one of the two implementations is wrong and a person
 * must decide which - against the catalogue, not by deferring to either.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInstrument, instrumentDirFromEnv } from '../src/instrument-ref.mjs';
import { suggestedLabels } from './oracle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RULES = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];
const instrument = await loadInstrument(instrumentDirFromEnv());
const key = JSON.parse(readFileSync(join(here, '..', 'calibration', 'answer-key.json'), 'utf8'));

const at = (o) => `${o.line}:${o.column}`;
const tally = { all3: 0, oracleToolAgree_keyDiffers: 0, oracleDiffersFromTool: 0, total: 0 };
const interesting = [];

for (const page of key.pages) {
  const html = readFileSync(join(here, '..', 'calibration', 'pages', `${page.pageId}.html`), 'utf8');
  const detected = instrument.formfair.findNameControls(html);
  const report = instrument.formfair.toJson(instrument.formfair.analyse(html));
  const pos = new Map(detected.filter((d) => d?.attrs?.id).map((d) => [d.attrs.id, at(d.source)]));

  for (const control of page.controls) {
    if (!control.rules || !pos.has(control.controlId)) continue;
    const p = pos.get(control.controlId);
    const fired = new Set((report.findings ?? []).filter((f) => at(f) === p).map((f) => f.rule));
    const declined = new Set((report.declined ?? []).filter((d) => at(d) === p).map((d) => d.rule));

    const o = suggestedLabels({
      pattern: control.pattern,
      minlength: control.minlength ?? undefined,
      maxlength: control.maxlength ?? undefined,
    });
    if (o.undecidable) continue;

    for (const rule of RULES) {
      if (declined.has(rule)) continue;
      tally.total += 1;
      const k = control.rules[rule];
      const orc = o.rules[rule];
      const tool = fired.has(rule) ? 'positive' : 'negative';
      if (k === orc && orc === tool) { tally.all3 += 1; continue; }
      if (orc === tool && k !== orc) {
        tally.oracleToolAgree_keyDiffers += 1;
        interesting.push({ control: control.calibrationId, rule, key: k, oracle: orc, tool, verdict: 'human misread the catalogue' });
      } else {
        tally.oracleDiffersFromTool += 1;
        interesting.push({ control: control.calibrationId, rule, key: k, oracle: orc, tool, pattern: control.pattern, verdict: 'ORACLE AND TOOL DISAGREE - a person must settle this' });
      }
    }
  }
}

console.log(`compared ${tally.total} rule decisions`);
console.log(`  all three agree:                     ${tally.all3}`);
console.log(`  oracle+tool agree, human differed:   ${tally.oracleToolAgree_keyDiffers}`);
console.log(`  oracle and tool DISAGREE:            ${tally.oracleDiffersFromTool}`);
if (interesting.length) {
  console.log('');
  for (const i of interesting) console.log(' ', JSON.stringify(i));
}
