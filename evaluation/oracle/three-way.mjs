/**
 * Compares three sources of rule labels over the calibration corpus.
 *
 *   KEY     labels a human derived by reading catalogue-v1.0.0
 *   WITNESS what execution can ESTABLISH - three states, most of them `unknown`
 *   TOOL    what FormFair reports, by parsing and enumerating character sets
 *
 * READ THE LIMITS BEFORE READING THE NUMBERS.
 *
 * This is not a validation of the tool and cannot be used as evaluation evidence. The
 * witness is only decisive where it is not independent (FF-03, and FF-05 via minlength,
 * are the same arithmetic FormFair does) and only independent where it cannot be decisive
 * (FF-01, FF-02 and FF-04 fire on absences that probing cannot establish). So agreement
 * between WITNESS and TOOL is informative only on the subset where the witness established
 * something, and that subset is reported separately rather than folded into a headline.
 *
 * An earlier version of this file printed "118 of 118 agree" by counting every decision,
 * including those the witness could not decide, and called key/tool differences "human
 * misread the catalogue". Both were overclaims. A difference is a question for a person to
 * settle against the catalogue; nothing here settles it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInstrument, instrumentDirFromEnv } from '../src/instrument-ref.mjs';
import { witnessStates, ESTABLISHED_POSITIVE, ESTABLISHED_NEGATIVE, UNKNOWN } from './oracle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RULES = ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05'];
const instrument = await loadInstrument(instrumentDirFromEnv());
const key = JSON.parse(readFileSync(join(here, '..', 'calibration', 'answer-key.json'), 'utf8'));

const at = (o) => `${o.line}:${o.column}`;
const asLabel = (s) =>
  s === ESTABLISHED_POSITIVE ? 'positive' : s === ESTABLISHED_NEGATIVE ? 'negative' : null;

const t = {
  decisions: 0,
  toolDeclined: 0,
  witnessUnknown: 0,
  established: 0,
  establishedAgree: 0,
  establishedConflict: 0,
  keyDiffersFromTool: 0,
};
const open = [];
const perRule = Object.fromEntries(RULES.map((r) => [r, { established: 0, unknown: 0 }]));

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

    const w = witnessStates({
      pattern: control.pattern,
      minlength: control.minlength ?? undefined,
      maxlength: control.maxlength ?? undefined,
    });
    if (w.undecidable) continue;

    for (const rule of RULES) {
      if (declined.has(rule)) {
        t.toolDeclined += 1;
        continue;
      }
      t.decisions += 1;
      const keyLabel = control.rules[rule];
      const toolLabel = fired.has(rule) ? 'positive' : 'negative';
      const witnessLabel = asLabel(w.states[rule]);

      if (keyLabel !== toolLabel) {
        t.keyDiffersFromTool += 1;
        open.push({ control: control.calibrationId, rule, key: keyLabel, tool: toolLabel, witness: w.states[rule], needs: 'human resolution against catalogue-v1.0.0' });
      }

      if (witnessLabel === null) {
        t.witnessUnknown += 1;
        perRule[rule].unknown += 1;
        continue;
      }
      t.established += 1;
      perRule[rule].established += 1;
      if (witnessLabel === toolLabel) t.establishedAgree += 1;
      else {
        t.establishedConflict += 1;
        open.push({ control: control.calibrationId, rule, witness: witnessLabel, tool: toolLabel, pattern: control.pattern, needs: 'TWO IMPLEMENTATIONS CONFLICT - settle against catalogue-v1.0.0' });
      }
    }
  }
}

console.log(`instrument ${instrument.tag} at ${instrument.commit.slice(0, 7)}`);
console.log('');
console.log(`rule decisions compared            ${t.decisions}`);
console.log(`  tool declined (not compared)     ${t.toolDeclined}`);
console.log(`  witness could not establish      ${t.witnessUnknown}  <- no evidence either way`);
console.log(`  witness established              ${t.established}`);
console.log(`    agrees with tool               ${t.establishedAgree}`);
console.log(`    conflicts with tool            ${t.establishedConflict}`);
console.log(`key differs from tool              ${t.keyDiffersFromTool}`);
console.log('');
console.log('what the witness could establish, by rule:');
for (const r of RULES) {
  const { established, unknown } = perRule[r];
  const total = established + unknown;
  console.log(`  ${r}  established ${String(established).padStart(3)} of ${String(total).padStart(3)}`);
}
console.log('');
console.log(`Coverage: the witness established ${t.established} of ${t.decisions} decisions`);
console.log('(' + Math.round((t.established / Math.max(1, t.decisions)) * 100) + '%). The rest carry no evidence.');
console.log('This is NOT a validation of the tool. See the header of this file.');
if (open.length) {
  console.log('\nOpen questions for a person:');
  for (const o of open) console.log(' ', JSON.stringify(o));
}
