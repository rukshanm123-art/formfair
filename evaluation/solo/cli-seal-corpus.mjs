#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealCorpus } from './descriptive.mjs';
import { instrumentIdentity, sealerIdentity, SOLO_INSTRUMENT_TAG, SOLO_SEALER_TAG } from './instrument.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const draftPath = flag('--draft');
const capturesDir = flag('--captures');
const out = flag('--out');
// The authoritative capture log. Required for a real seal, because the exhaustion records are
// claims about what was searched and the seal verifies them rather than trusting their shape.
const captureLogPath = flag('--capture-log');
const synthetic = args.includes('--synthetic');
const development = args.includes('--development');
if (!draftPath || !capturesDir || !out) {
  console.error('usage: node solo/cli-seal-corpus.mjs --draft <draft.json> --captures <dir> --out <corpus.json> [--capture-log <capture-log.json>] [--synthetic --development]');
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
  // The sealer attests itself too. A corpus sealed from a modified working tree cannot be
  // reproduced, and nothing in the manifest would afterwards reveal which rules were applied.
  const sealer = sealerIdentity(instrumentDir);
  if (!development && !sealer.officialReady) {
    throw new Error(`real corpus sealing requires a clean sealer checkout tagged ${SOLO_SEALER_TAG}`);
  }
  if (!synthetic && !captureLogPath) {
    throw new Error('--capture-log is required for a real corpus: each exhaustion is verified against it');
  }
  const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
  if ((draft.synthetic === true) !== synthetic) {
    throw new Error(`draft synthetic=${draft.synthetic === true} does not match the command mode`);
  }
  const sealed = sealCorpus({ draft, capturesDir, instrument: identity, sealer, captureLogPath });
  if (!sealed.manifest) throw new Error(sealed.problems.join('\n'));
  writeFileSync(out, `${JSON.stringify(sealed.manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(`sealed ${sealed.manifest.pages.length} pages and the selection ledger`);
  console.log(`exhausted agencies: ${sealed.manifest.exhaustedAgencies.length}`);
  console.log(`protocol: ${sealed.manifest.protocol}  sealer: ${sealed.manifest.sealer?.tag ?? 'development'}`);
  console.log(`wrote ${resolve(out)}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
