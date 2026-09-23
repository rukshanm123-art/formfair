#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealCorpus } from './descriptive.mjs';
import { instrumentIdentity, SOLO_INSTRUMENT_TAG } from './instrument.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const draftPath = flag('--draft');
const capturesDir = flag('--captures');
const out = flag('--out');
const synthetic = args.includes('--synthetic');
const development = args.includes('--development');
if (!draftPath || !capturesDir || !out) {
  console.error('usage: node solo/cli-seal-corpus.mjs --draft <draft.json> --captures <dir> --out <corpus.json> [--synthetic --development]');
  process.exit(1);
}
if (development && !synthetic) {
  console.error('--development is permitted only with --synthetic; a real corpus must bind to the frozen instrument');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const instrumentDir = resolve(process.env.FORMFAIR_SOLO_INSTRUMENT_DIR ?? join(here, '..', '..'));
try {
  const identity = instrumentIdentity(instrumentDir);
  if (!development && !identity.officialReady) {
    throw new Error(`real corpus sealing requires a clean instrument tagged ${SOLO_INSTRUMENT_TAG}`);
  }
  const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
  if ((draft.synthetic === true) !== synthetic) {
    throw new Error(`draft synthetic=${draft.synthetic === true} does not match the command mode`);
  }
  const sealed = sealCorpus({ draft, capturesDir, instrument: identity });
  if (!sealed.manifest) throw new Error(sealed.problems.join('\n'));
  writeFileSync(out, `${JSON.stringify(sealed.manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(`sealed ${sealed.manifest.pages.length} pages and the selection ledger`);
  console.log(`wrote ${resolve(out)}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
