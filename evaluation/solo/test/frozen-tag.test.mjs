/**
 * The tag the implementation reports must be the tag it was frozen as.
 *
 * `solo-protocol-v1.0.26` was created, pushed and recorded in Amendment 49, whose text states it.
 * The commit it points at never bumped `SOLO_PROTOCOL_TAG` or `SOLO_SEALER_TAG`, which both still
 * read `solo-protocol-v1.0.25` - so for the whole of that freeze the sealer identified itself as a
 * version one behind the tag that contained it. Every freeze before it had bumped the constants in
 * the same commit as the change; Amendment 49 touched only a test script and a guard, and the step
 * was missed.
 *
 * Nothing failed, which is the point. The sealer's identity is what a reader uses to tell which
 * implementation produced a seal, and a published artefact that misreports its own version cannot
 * be checked against the protocol that governs it.
 *
 * Checked against the protocol document rather than against git, so it holds in a shallow CI clone
 * with no tags fetched: the amendment that freezes a version states it, and the constants must
 * agree with the most recent such statement.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOLO_PROTOCOL_TAG } from '../descriptive.mjs';
import { SOLO_SEALER_TAG } from '../instrument.mjs';
import revoked from '../../provenance/revoked-tags.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const protocol = readFileSync(
  join(here, '..', '..', '..', 'docs', 'evaluation', 'SOLO-PROTOCOL.md'), 'utf8'
);

/** Every solo-protocol version the document declares a freeze at, in document order. */
const frozenVersions = [...protocol.matchAll(/^\*Frozen as .*?`solo-protocol-(v\d+\.\d+\.\d+)`/gm)]
  .map((m) => m[1]);

const ordinal = (v) => v.slice(1).split('.').map(Number);
const compare = (a, b) => {
  const [x, y] = [ordinal(a), ordinal(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

describe('the frozen tag the implementation reports', () => {
  test('the analyser and the sealer report the same one', () => {
    // They are separate files and separate checkouts; disagreeing versions would mean a seal and
    // the analysis it covers were produced under different protocols.
    assert.equal(SOLO_PROTOCOL_TAG, SOLO_SEALER_TAG);
  });

  test('it is the latest version the protocol declares frozen', () => {
    assert.ok(frozenVersions.length > 0, 'the protocol document declares no frozen version');
    const latest = frozenVersions.reduce((a, b) => (compare(a, b) >= 0 ? a : b));
    assert.equal(
      SOLO_PROTOCOL_TAG, `solo-protocol-${latest}`,
      `the protocol document's latest freeze is ${latest}; the implementation reports ` +
        `${SOLO_PROTOCOL_TAG}. Bump the constants in the same commit as the change, as every ` +
        'freeze before Amendment 49 did.'
    );
  });

  test('it is not a revoked tag', () => {
    // Amendment 47's guard, which until now never ran in CI. Kept here so the two checks on the
    // reported tag sit together.
    const names = (revoked.revoked ?? revoked).map((r) => r.tag ?? r);
    assert.equal(names.includes(SOLO_PROTOCOL_TAG), false, `${SOLO_PROTOCOL_TAG} is revoked`);
    assert.equal(names.includes(SOLO_SEALER_TAG), false, `${SOLO_SEALER_TAG} is revoked`);
  });
});
