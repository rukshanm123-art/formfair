/**
 * Cross-checks the catalogue-derived answer key against the frozen analyser.
 *
 * READ THIS BEFORE USING THE OUTPUT.
 *
 * The key in answer-key.json is derived from catalogue-v1.0.0 by reading it. This script
 * does NOT correct the key and must never be made to. Its only job is to surface places
 * where a human reading of the catalogue and the implementation of that catalogue differ,
 * so a person can decide which is wrong - and decide it against the catalogue text, not by
 * deferring to the tool.
 *
 * The reason is not fastidiousness. Annotators calibrated against a tool-derived key would
 * be trained to agree with the tool, and the held-out evaluation would then measure how
 * well two people had learned to imitate FormFair rather than whether FormFair is right.
 * A discrepancy here is a question, never an answer.
 *
 *   FORMFAIR_INSTRUMENT_DIR=/path/to/.instrument node calibration/cross-check.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInstrument, instrumentDirFromEnv } from '../src/instrument-ref.mjs';
import { RULES } from './controls.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const dir = instrumentDirFromEnv();
if (!dir) {
  console.error('FORMFAIR_INSTRUMENT_DIR is not set. Run scripts/setup-instrument.sh first.');
  process.exit(2);
}

const instrument = await loadInstrument(dir);
const key = JSON.parse(readFileSync(join(here, 'answer-key.json'), 'utf8'));

const discrepancies = [];
let comparedStageOne = 0;
let comparedRules = 0;
let declines = 0;

// Findings carry a source position, not a control id, so controls are keyed by the
// line/column that findNameControls reports for them and findings matched on that.
const at = (o) => `${o.line}:${o.column}`;

for (const page of key.pages) {
  const html = readFileSync(join(here, 'pages', `${page.pageId}.html`), 'utf8');
  const detected = instrument.formfair.findNameControls(html);
  const report = instrument.formfair.toJson(instrument.formfair.analyse(html));

  const positionOf = new Map();
  for (const d of detected) {
    if (d?.attrs?.id) positionOf.set(d.attrs.id, at(d.source));
  }

  for (const control of page.controls) {
    comparedStageOne += 1;
    const toolSaysName = positionOf.has(control.controlId);
    const keySaysName = control.stageOne === 'positive';
    if (toolSaysName !== keySaysName) {
      discrepancies.push({
        kind: 'stage-one',
        page: page.pageId,
        control: control.calibrationId,
        key: control.stageOne,
        tool: toolSaysName ? 'positive' : 'negative',
        basis: control.basis,
      });
    }

    if (!control.rules || !toolSaysName) continue;

    const pos = positionOf.get(control.controlId);
    const firedHere = new Set(
      (report.findings ?? []).filter((f) => at(f) === pos).map((f) => f.rule)
    );
    const declinedHere = new Set(
      (report.declined ?? []).filter((d) => at(d) === pos).map((d) => d.rule)
    );

    for (const rule of RULES) {
      comparedRules += 1;
      if (declinedHere.has(rule)) {
        declines += 1;
        discrepancies.push({
          kind: 'decline',
          page: page.pageId,
          control: control.calibrationId,
          rule,
          key: control.rules[rule],
          tool: 'declined',
          pattern: control.pattern,
          note: 'A decline is not a wrong answer. Check the control is decidable as intended; the key still records a human label.',
        });
        continue;
      }
      const toolLabel = firedHere.has(rule) ? 'positive' : 'negative';
      if (toolLabel !== control.rules[rule]) {
        discrepancies.push({
          kind: 'rule',
          page: page.pageId,
          control: control.calibrationId,
          rule,
          key: control.rules[rule],
          tool: toolLabel,
          pattern: control.pattern,
        });
      }
    }
  }
}

console.log(`instrument: ${instrument.tag} at ${instrument.commit.slice(0, 7)}`);
console.log(`compared ${comparedStageOne} stage-one and ${comparedRules} rule decisions`);
console.log(`declines: ${declines}`);
console.log(`discrepancies: ${discrepancies.length}`);
if (discrepancies.length) {
  console.log('\nEach line is a QUESTION for a human to settle against catalogue-v1.0.0.');
  console.log('The answer key is not rewritten by this script.\n');
  for (const d of discrepancies) console.log(JSON.stringify(d));
}
process.exit(0);
