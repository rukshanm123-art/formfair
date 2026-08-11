# Evaluation harness

Implements [the frozen protocol](../docs/evaluation/PROTOCOL.md) against
[the frozen instrument](../docs/evaluation/README.md).

**This package has no dependencies, by design.** It is kept out of the analyser's
dependency tree so that building evaluation tooling cannot change the instrument the
evaluation is run with. Tests use `node:test`.

```bash
cd evaluation
npm test                 # the harness's own tests, on synthetic fixtures only
npm run draw-order       # frozen agency order from frame.csv
npm run metrics          # metrics from sealed ground truth and FormFair reports
npm run seal:verify      # protocol section 10 gate
```

## What is here

| Path | |
|---|---|
| `src/stats.mjs` | Wilson intervals, Cohen's kappa, seeded cluster bootstrap |
| `src/draw-order.mjs` | protocol section 2 — deterministic agency ordering |
| `src/metrics.mjs` | protocol section 9 — stage one, stage two, end to end |
| `src/seal.mjs` | protocol section 10 — the gate that must pass before FormFair runs |
| `src/schema.mjs` | shapes of the ground-truth, capture and adjudication records |
| `fixtures/synthetic/` | development material — never a captured page |
| `data/` | **git-ignored.** Captured markup and annotation files live here |

## Order of operations

1. Capture the frame, build `frame.csv`, hash it.
2. `npm run draw-order` — before visiting any form.
3. Capture forms in that order, one page per agency.
4. Annotate, independently. Lock and hash each annotator's file.
5. Compute kappa, adjudicate, lock the adjudication file.
6. `npm run seal:verify` — must pass.
7. Only then run FormFair, once, at `evaluation-v1.0.0`.
8. `npm run metrics`.

Steps 3 onward have not been started. Nothing in `data/` is a captured government page.
