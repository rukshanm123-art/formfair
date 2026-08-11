/**
 * Statistics for the held-out evaluation.
 *
 * Every figure the protocol asks for is computed here, including the two cases it
 * insists be reported rather than papered over: a denominator below five, and a kappa
 * that cannot be computed because both annotators used a single category. Both return
 * `{ estimable: false }` instead of a number, so a caller cannot accidentally print a
 * misleading value.
 */

/** Denominators below this are reported as not estimable (protocol section 9). */
export const MIN_DENOMINATOR = 5;

const Z_95 = 1.959963984540054;

const notEstimable = (reason) => ({ estimable: false, reason });

/**
 * Wilson score interval. Preferred over the normal approximation because the
 * proportions here are often near 0 or 1 with small denominators, where the normal
 * interval runs outside [0, 1] and understates coverage.
 */
export function wilson(successes, total, z = Z_95) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total < 0) {
    throw new TypeError('wilson expects non-negative integer counts');
  }
  if (successes > total) throw new RangeError('successes cannot exceed the total');
  if (total === 0) return notEstimable('no observations');

  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denominator;
  const halfWidth =
    (z / denominator) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));

  // Below the threshold the caller gets the counts and the reason, and nothing that
  // could be mistaken for an estimate. Returning a point alongside estimable: false
  // leaves the misleading number one property access away, which is the situation this
  // guard exists to prevent.
  if (total < MIN_DENOMINATOR) {
    return {
      estimable: false,
      reason: `denominator ${total} is below ${MIN_DENOMINATOR}`,
      successes,
      total,
    };
  }

  return {
    estimable: true,
    point: p,
    lower: Math.max(0, centre - halfWidth),
    upper: Math.min(1, centre + halfWidth),
    successes,
    total,
  };
}

/**
 * Cohen's kappa for two raters over binary labels, plus the percentage agreement and
 * label counts the protocol also requires.
 *
 * Returns not estimable when expected agreement is 1, which is what happens when both
 * annotators used a single category - the case the protocol names explicitly.
 */
export function cohensKappa(a, b) {
  if (a.length !== b.length) throw new RangeError('rater vectors must be the same length');
  const n = a.length;
  if (n === 0) return notEstimable('no paired labels');

  const cell = { pp: 0, pn: 0, np: 0, nn: 0 };
  for (let i = 0; i < n; i++) {
    const key = `${a[i] === 'positive' ? 'p' : 'n'}${b[i] === 'positive' ? 'p' : 'n'}`;
    cell[key] += 1;
  }

  const observed = (cell.pp + cell.nn) / n;
  const aPositive = (cell.pp + cell.pn) / n;
  const bPositive = (cell.pp + cell.np) / n;
  const expected = aPositive * bPositive + (1 - aPositive) * (1 - bPositive);

  const counts = {
    n,
    bothPositive: cell.pp,
    bothNegative: cell.nn,
    disagreements: cell.pn + cell.np,
    raterAPositive: cell.pp + cell.pn,
    raterBPositive: cell.pp + cell.np,
  };

  if (expected === 1) {
    return {
      ...notEstimable('both annotators used a single category, so expected agreement is 1'),
      percentageAgreement: observed,
      counts,
    };
  }

  return {
    estimable: true,
    kappa: (observed - expected) / (1 - expected),
    percentageAgreement: observed,
    counts,
  };
}

/** Deterministic PRNG, so a bootstrap interval is reproducible from the seed alone. */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function f1From({ tp, fp, fn }) {
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  if (precision === null || recall === null || precision + recall === 0) return null;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Cluster bootstrap over pages.
 *
 * Pages are the resampling unit, not individual rule-control pairs: controls on one page
 * share markup, framework and author, so their errors are correlated and resampling
 * pairs independently would produce an interval that is too narrow. This choice is
 * recorded in the protocol rather than left to the implementation.
 */
export function bootstrapF1(clusters, { resamples = 2000, seed = 'evaluation-v1.0.0' } = {}) {
  const usable = clusters.filter((c) => c && typeof c === 'object');
  const total = usable.reduce((n, c) => n + c.tp + c.fp + c.fn, 0);
  if (usable.length === 0 || total === 0) return notEstimable('no scored pairs');

  const point = f1From(usable.reduce(
    (acc, c) => ({ tp: acc.tp + c.tp, fp: acc.fp + c.fp, fn: acc.fn + c.fn }),
    { tp: 0, fp: 0, fn: 0 }
  ));
  if (point === null) return notEstimable('precision and recall are both undefined');

  if (total < MIN_DENOMINATOR) {
    // Counts only. No point estimate and no interval, for the same reason as wilson().
    return {
      estimable: false,
      reason: `denominator ${total} is below ${MIN_DENOMINATOR}`,
      scoredPairs: total,
      clusters: usable.length,
    };
  }

  const random = mulberry32(seedFromString(seed));
  const draws = [];
  for (let r = 0; r < resamples; r++) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < usable.length; i++) {
      const picked = usable[Math.floor(random() * usable.length)];
      tp += picked.tp;
      fp += picked.fp;
      fn += picked.fn;
    }
    const value = f1From({ tp, fp, fn });
    if (value !== null) draws.push(value);
  }

  if (draws.length === 0) return notEstimable('every resample was undefined');
  draws.sort((x, y) => x - y);
  const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))];

  return {
    estimable: true,
    point,
    lower: at(0.025),
    upper: at(0.975),
    resamples: draws.length,
    clusters: usable.length,
    seed,
  };
}
