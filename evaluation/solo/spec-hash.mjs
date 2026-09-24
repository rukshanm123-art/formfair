/**
 * The canonical digest of every browser specification in the mutation corpus.
 *
 * Recorded browser verdicts were previously looked up by case ID alone, so editing a
 * case's pattern or its accept/reject values while keeping its ID would silently reuse the
 * old verdict and still report twenty-five of twenty-five. The verdicts would then describe
 * a corpus that no longer existed.
 *
 * This digest binds the two. It is embedded in the generated page, carried through the raw
 * browser result, recorded in browser-verdicts.json, and recomputed by the study before it
 * trusts anything. Both sides call THIS function, so they cannot disagree about what
 * canonical means.
 *
 * Serialisation is explicit rather than JSON.stringify over the case objects: key order in
 * a literal is not a stable contract, and a digest that changes when a field is reordered
 * would fail open by forcing needless re-runs, or worse, be ignored.
 */

import { createHash } from 'node:crypto';

const norm = (v) => (v === undefined ? null : v);

/** One case, serialised so that only meaning-bearing changes alter the result. */
export function canonicalSpec(testCase) {
  const b = testCase.browser ?? {};
  return JSON.stringify([
    testCase.id,
    testCase.rule,
    norm(b.pattern),
    norm(b.minlength),
    norm(b.maxlength),
    [...(b.accepts ?? [])],
    [...(b.rejects ?? [])],
  ]);
}

/** SHA-256 over every case, ordered by id so the digest does not depend on array order. */
export function browserSpecDigest(cases) {
  const lines = cases.map(canonicalSpec).sort();
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}
