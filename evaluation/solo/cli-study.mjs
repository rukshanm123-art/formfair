#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSoloInstrument } from './instrument.mjs';
import { runSoloStudy } from './study.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const out = flag('--out');
const development = args.includes('--development');
const includePerformance = args.includes('--performance');
if (!out) {
  console.error('usage: node solo/cli-study.mjs --out <report.json> [--performance] [--development]');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const instrumentDir = resolve(process.env.FORMFAIR_SOLO_INSTRUMENT_DIR ?? join(here, '..', '..'));
try {
  const { identity, core } = await loadSoloInstrument(instrumentDir, { development });
  const jsonIdentity = core.toJson(core.analyse('<form></form>')).instrument;
  const report = runSoloStudy({
    analyse: core.analyse,
    instrument: { ...identity, reportIdentity: jsonIdentity, mode: development ? 'development' : 'official' },
    includePerformance,
  });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`technical study: ${report.passed ? 'PASS' : 'FAIL'}`);
  console.log(`mutation: ${report.mutation.passed}/${report.mutation.total}`);
  console.log(`metamorphic: ${report.metamorphic.passed}/${report.metamorphic.total}`);
  console.log(`robustness: ${report.robustness.cases - report.robustness.failures.length}/${report.robustness.cases}`);
  console.log(`wrote ${resolve(out)}`);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
