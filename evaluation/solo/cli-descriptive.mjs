#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { analyseDescriptively, loadSealedPages } from './descriptive.mjs';
import {
  loadDelegatedProvider,
  loadSoloInstrument,
  SOLO_INSTRUMENT_TAG,
  verifyCorpusAttestation,
} from './instrument.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const manifestPath = flag('--manifest');
const capturesDir = flag('--captures');
const out = flag('--out');
const synthetic = args.includes('--synthetic');
const development = args.includes('--development');
if (!manifestPath || !capturesDir || !out) {
  console.error('usage: node solo/cli-descriptive.mjs --manifest <corpus.json> --captures <dir> --out <report.json> [--synthetic --development]');
  process.exit(1);
}
if (development && !synthetic) {
  console.error('--development is permitted only with --synthetic; real-form output requires the frozen instrument');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const instrumentDir = resolve(process.env.FORMFAIR_SOLO_INSTRUMENT_DIR ?? join(here, '..', '..'));
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if ((manifest.synthetic === true) !== synthetic) {
    throw new Error(`manifest synthetic=${manifest.synthetic === true} does not match the command mode`);
  }
  if (!development && manifest.instrument?.tag !== SOLO_INSTRUMENT_TAG) {
    throw new Error(`official corpus must name instrument ${SOLO_INSTRUMENT_TAG}`);
  }
  const loaded = loadSealedPages({ manifest, manifestPath, capturesDir });
  if (!loaded.pages) throw new Error(loaded.problems.join('\n'));

  const { identity, core } = await loadSoloInstrument(instrumentDir, { development });
  if (
    manifest.instrument?.tag !== SOLO_INSTRUMENT_TAG ||
    manifest.instrument?.commit !== identity.commit ||
    manifest.instrument?.lockfileSha256 !== identity.lockfileSha256
  ) {
    throw new Error('the corpus manifest is bound to a different analyser commit or lockfile');
  }
  let attestation = { tag: null, commit: null };
  if (!development) {
    attestation = verifyCorpusAttestation(join(here, '..', '..'), manifestPath);
    if (!attestation.valid) throw new Error(attestation.problems.join('\n'));
  }
  const provider = await loadDelegatedProvider(instrumentDir);
  const require = createRequire(join(instrumentDir, 'package.json'));
  const { parseFragment } = await import(pathToFileURL(require.resolve('parse5')).href);
  const report = await analyseDescriptively({
    pages: loaded.pages,
    analysePage: (html) => core.analyseWith(html, provider),
    findNameControls: core.findNameControls,
    parseFragment,
    instrument: {
      ...identity,
      reportIdentity: core.toJson(core.analyse('<form></form>')).instrument,
      mode: development ? 'development' : 'official',
    },
    manifest: { ...manifest, sha256: loaded.manifestSha256, attestation },
  });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`descriptive corpus: ${report.corpus.pages} pages`);
  console.log(`tool-detected name controls: ${report.counts.toolDetectedNameControls}`);
  console.log(`tool-reported findings: ${Object.values(report.toolOutput.findingsByRule).reduce((a, b) => a + b, 0)}`);
  console.log('These are unvalidated tool outputs, not confirmed defects or prevalence.');
  console.log(`wrote ${resolve(out)}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
