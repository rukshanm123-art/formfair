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

/**
 * Below this proportion of resolved resamples a bootstrap is refused rather than reported.
 * Amendment harness-v1.1.0; section 9 of the frozen protocol does not address it.
 */
export const STABILITY_THRESHOLD = 0.95;

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

  // A caller printing agreement should not have to guard every field. Even with nothing
  // to compare, the raw counts are returned: a corpus where the annotators never both
  // called the same control a name has an empty per-rule basis, which is a result to
  // report, not a crash.
  if (n === 0) {
    return {
      ...notEstimable('no paired labels'),
      percentageAgreement: null,
      counts: {
        n: 0,
        bothPositive: 0,
        bothNegative: 0,
        disagreements: 0,
        raterAPositive: 0,
        raterBPositive: 0,
      },
    };
  }

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

/**
 * F1 over summed counts.
 *
 * Zero true positives is a RESULT, not an absence of one: a run that found nothing right
 * has an F1 of 0. Returning null there would let the bootstrap discard exactly the worst
 * resamples, which biases the lower bound upward and flatters the tool. Only a set of
 * counts with nothing scored at all is genuinely undefined.
 */
export function f1From({ tp = 0, fp = 0, fn = 0 }) {
  if (tp + fp + fn === 0) return null;
  if (tp === 0) return 0;
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Estimators over summed cluster counts. Each returns null where the figure is undefined
 * for those counts, which the bootstrap treats as a draw to discard rather than a zero.
 */
export function precisionFrom({ tp = 0, fp = 0 }) {
  return tp + fp === 0 ? null : tp / (tp + fp);
}

export function recallFrom({ tp = 0, fn = 0 }) {
  return tp + fn === 0 ? null : tp / (tp + fn);
}

export function coverageFrom({ decided = 0, denominator = 0 }) {
  return denominator === 0 ? null : decided / denominator;
}

/**
 * Percentile bootstrap over CLUSTERS, resampling whole pages with replacement.
 *
 * The unit of resampling is the page, not the control, because controls on one page share
 * markup, framework and author, so their errors are correlated. Treating them as
 * independent - which is what a Wilson interval on pooled controls does - understates the
 * width. Wilson is retained only where the page itself is the unit of observation, such as
 * form-level prevalence.
 *
 * Amendment harness-v1.1.0, dated before any held-out form was captured. The protocol tag
 * protocol-v1.0.0 specified Wilson for all proportions; that specification is superseded
 * here and the tag is not moved.
 *
 * `estimate` maps summed counts to a value or null. `denominator` maps summed counts to the
 * count the MIN_DENOMINATOR guard applies to, so that "not estimable" means the same thing
 * it does for wilson().
 */
export function bootstrapClustered(
  clusters,
  { estimate, denominator, numerator, resamples = 2000, seed = 'evaluation-v1.0.0' } = {}
) {
  if (typeof estimate !== 'function' || typeof denominator !== 'function') {
    throw new TypeError('bootstrapClustered needs an estimate and a denominator function');
  }
  // Sorted into a canonical order before anything is drawn. The PRNG walks the array, so
  // without this the published interval depends on the order the caller happened to list
  // the pages in - the same corpus, read from a differently ordered directory, would give
  // a different interval. Identical clusters sort together, so ties cannot reintroduce it.
  const canonical = (c) =>
    JSON.stringify(
      Object.keys(c)
        .sort()
        .map((k) => [k, c[k]])
    );
  const usable = (clusters ?? [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => [canonical(c), c])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, c]) => c);

  const sum = (list) => {
    const acc = {};
    for (const c of list) {
      for (const [k, v] of Object.entries(c)) {
        if (typeof v === 'number' && Number.isFinite(v)) acc[k] = (acc[k] ?? 0) + v;
      }
    }
    return acc;
  };

  const observed = sum(usable);
  const total = denominator(observed);
  // The protocol requires raw counts beside every figure, estimable or not. Where the
  // measure is a simple proportion the caller supplies a numerator, and the result
  // carries successes/total exactly as wilson() does, so the two are interchangeable.
  const raw =
    typeof numerator === 'function' ? { successes: numerator(observed), total } : { total };

  if (usable.length === 0 || total === 0) {
    return { ...notEstimable('no scored observations'), ...raw, clusters: usable.length };
  }

  const point = estimate(observed);
  if (point === null) {
    return {
      ...notEstimable('the estimate is undefined for these counts'),
      ...raw,
      clusters: usable.length,
    };
  }

  if (total < MIN_DENOMINATOR) {
    // Counts only, for the same reason as wilson(): a point estimate sitting next to
    // estimable:false leaves the misleading number one property access away.
    return {
      estimable: false,
      reason: `denominator ${total} is below ${MIN_DENOMINATOR}`,
      ...raw,
      counts: observed,
      clusters: usable.length,
    };
  }

  const random = mulberry32(seedFromString(seed));
  const draws = [];
  for (let r = 0; r < resamples; r++) {
    const picked = [];
    for (let i = 0; i < usable.length; i++) {
      picked.push(usable[Math.floor(random() * usable.length)]);
    }
    const value = estimate(sum(picked));
    if (value !== null && Number.isFinite(value)) draws.push(value);
  }

  // A resample can be undefined - every drawn page empty for this measure - so the
  // proportion that resolved is reported. Amendment harness-v1.1.0 fixes the threshold at
  // 0.95 and refuses below it; this rule is the amendment's, not something section 9 of
  // the protocol already said, and it is recorded there as such.
  const resolved = draws.length / resamples;
  if (draws.length === 0) {
    return {
      ...notEstimable('every resample was undefined'),
      ...raw,
      counts: observed,
      clusters: usable.length,
      resamples,
      resolved,
    };
  }

  // Refused rather than reported. An unresolved bootstrap concentrates on the few draws
  // that survived, which produces a narrow - often zero-width - interval that looks more
  // precise than the data it rests on. That is the exact failure the denominator floor
  // exists to prevent, arriving by a different route.
  if (resolved < STABILITY_THRESHOLD) {
    return {
      estimable: false,
      reason: `only ${(resolved * 100).toFixed(1)}% of resamples resolved, below ${STABILITY_THRESHOLD * 100}%`,
      ...raw,
      counts: observed,
      clusters: usable.length,
      resamples,
      resolved,
      stable: false,
    };
  }

  draws.sort((x, y) => x - y);
  // Nearest rank: the q-quantile is the ceil(q*n)-th smallest draw, one-indexed. Using
  // floor(q*n) as a zero-indexed position would shift BOTH bounds one order statistic up.
  const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.ceil(q * draws.length) - 1))];

  return {
    estimable: true,
    method: 'page-cluster bootstrap',
    point,
    lower: at(0.025),
    upper: at(0.975),
    // `resamples` is what the protocol fixes at 2,000. `resolvedDraws` is how many of them
    // yielded a defined estimate; reporting the latter as `resamples` contradicted the
    // protocol's own figure.
    resamples,
    resolvedDraws: draws.length,
    resolved,
    stable: true,
    clusters: usable.length,
    ...raw,
    counts: observed,
    seed,
  };
}

/** Kept as the F1 entry point; now a thin wrapper over the shared clustered bootstrap. */
export function bootstrapF1(clusters, options = {}) {
  return bootstrapClustered(clusters, {
    ...options,
    estimate: f1From,
    // Scored pairs, matching the denominator the protocol applies the floor to.
    denominator: ({ tp = 0, fp = 0, fn = 0 }) => tp + fp + fn,
  });
}
