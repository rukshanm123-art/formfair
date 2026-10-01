/**
 * Amendment 47: the version in force may never be a revoked tag.
 *
 * Three tags — `selection-v1.0.43`, `capture-v1.0.18` and `solo-protocol-v1.0.23` — were pushed
 * against `60038c0`, a commit containing no Amendment 46 implementation. The commit carrying it was
 * never made: the heredoc supplying its message was consumed by an earlier command in the same
 * shell chain, so HEAD never moved and the tag commands ran against the previous commit.
 *
 * They are not deleted or recreated. Once a tag name has been published, reusing it can leave
 * different clones resolving one version to different objects, so the mistake is preserved and a
 * corrected version issued. What must be enforced instead is that nothing goes on NAMING a revoked
 * tag as the version in force — which `solo-protocol-v1.0.23` was, in both constants, while
 * attesting to nothing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOLO_PROTOCOL_TAG } from '../descriptive.mjs';
import { SOLO_SEALER_TAG } from '../instrument.mjs';

const record = JSON.parse(
  readFileSync(new URL('../../provenance/revoked-tags.json', import.meta.url), 'utf8')
);
const revokedNames = record.revoked.map((r) => r.tag);

describe('the revocation record', () => {
  test('every entry names its object, its peeled commit, a reason and a replacement', () => {
    assert.ok(record.revoked.length > 0);
    for (const entry of record.revoked) {
      for (const field of ['tag', 'tagObject', 'peeledCommit', 'revokedAt', 'reason', 'replacedBy']) {
        assert.ok(entry[field], `${entry.tag ?? '(unnamed)'} has no ${field}`);
      }
      assert.match(entry.tagObject, /^[0-9a-f]{40}$/, `${entry.tag} tagObject is not a full object id`);
      assert.match(entry.peeledCommit, /^[0-9a-f]{40}$/, `${entry.tag} peeledCommit is not a full commit id`);
      assert.notEqual(entry.replacedBy, entry.tag, `${entry.tag} cannot replace itself`);
      assert.ok(!revokedNames.includes(entry.replacedBy), `${entry.tag} is replaced by a revoked tag`);
    }
  });

  test('no tag is revoked twice', () => {
    assert.equal(new Set(revokedNames).size, revokedNames.length);
  });
});

describe('the version in force is not revoked', () => {
  test('SOLO_PROTOCOL_TAG names no revoked tag', () => {
    assert.ok(
      !revokedNames.includes(SOLO_PROTOCOL_TAG),
      `SOLO_PROTOCOL_TAG is ${SOLO_PROTOCOL_TAG}, which is revoked`
    );
  });

  test('SOLO_SEALER_TAG names no revoked tag', () => {
    assert.ok(
      !revokedNames.includes(SOLO_SEALER_TAG),
      `SOLO_SEALER_TAG is ${SOLO_SEALER_TAG}, which is revoked`
    );
  });

  test('the two constants agree, so one cannot be corrected without the other', () => {
    // `solo-protocol-v1.0.23` was named by both, and both had to move together.
    assert.equal(SOLO_PROTOCOL_TAG, SOLO_SEALER_TAG);
  });

  test('the guard actually fires on a revoked name', () => {
    // Proving the assertion is not vacuous: the specific tag that was revoked must be caught.
    assert.ok(revokedNames.includes('solo-protocol-v1.0.23'));
    const pretend = 'solo-protocol-v1.0.23';
    assert.ok(revokedNames.includes(pretend), 'the revoked tag is not detected as revoked');
  });
});
