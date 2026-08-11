/**
 * Fails when the pinned version of a delegated engine no longer matches the catalogue
 * snapshot captured as evidence for it.
 *
 * The snapshot files are checksummed, so a corrupted capture is caught. Nothing
 * previously caught the opposite drift: bumping axe-core while the captured rule
 * descriptions still document the old release, leaving the comparison in the write-up
 * describing an engine the tool no longer runs. A Dependabot bump now fails here until
 * its evidence is recaptured in the same change.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pinned = require('../package.json').dependencies['axe-core'];

if (!/^\d+\.\d+\.\d+$/.test(pinned)) {
  console.error(`axe-core must be pinned exactly for the snapshot to mean anything; found "${pinned}".`);
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(new URL('../docs/catalogue-snapshots/manifest.json', import.meta.url), 'utf8')
);

const axe = (manifest.snapshots ?? []).find((e) => e.tool === 'axe-core');

if (!axe) {
  console.error('no axe-core entry in docs/catalogue-snapshots/manifest.json');
  process.exit(1);
}

const captured = axe.version;
if (captured !== pinned) {
  console.error(
    `axe-core is pinned at ${pinned} but the catalogue snapshot documents ${captured}.\n` +
      'Recapture docs/catalogue-snapshots/ for the new release, update SHA256SUMS and the\n' +
      'snapshot README, and include that in the same change as the version bump.'
  );
  process.exit(1);
}

console.log(`axe-core ${pinned} matches its catalogue snapshot`);
