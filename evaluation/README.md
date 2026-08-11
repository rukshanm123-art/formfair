# Evaluation harness

Implements [the frozen protocol](../docs/evaluation/PROTOCOL.md) against
[the frozen instrument](../docs/evaluation/README.md).

**This package has no dependencies, by design.** It is kept out of the analyser's
dependency tree so that building evaluation tooling cannot change the instrument the
evaluation is run with. Tests use `node:test`.

```bash
cd evaluation
npm test              # 96 tests, on synthetic fixtures only
npm run draw-order    # verify the frozen order still matches the frame
npm run build-frame   # rebuild frame.csv from the archived page and re-assert its counts
npm run metrics -- fixtures/synthetic/dataset.valid.json
npm run seal:verify -- data/seal.json
```

`npm run draw-order` **verifies and changes nothing.** The order is frozen and tagged; a
command that silently rewrote it could re-roll the draw without leaving a trace, which is
the one thing that artefact exists to prevent. Creating it takes an explicit `--write`.

## What is here

| Path | |
|---|---|
| `src/stats.mjs` | Wilson intervals, Cohen's kappa, seeded cluster bootstrap |
| `src/schema.mjs` | frozen shapes for capture, annotation, adjudication and the joined dataset |
| `src/metrics.mjs` | protocol section 9 - stage one, stage two, end to end |
| `src/draw-order.mjs` | protocol section 2 - deterministic agency ordering |
| `src/seal.mjs` | protocol section 10 - the gate that must pass before FormFair runs |
| `src/build-frame.mjs` | protocol section 1 - frame extraction, with count assertions |
| `src/cli-draw-order.mjs` | verify, or `--write`, the frozen order |
| `src/cli-metrics.mjs` | compute the metrics from a joined dataset |
| `src/cli-seal.mjs` | check the seal |
| `frame/` | **the frozen sampling frame.** Tagged `frame-v1.0.0`, hashed, do not edit |
| `fixtures/synthetic/` | development material. Nothing here is, or may become, a captured page |
| `test/` | `stats`, `metrics`, `schema`, `protocol` and `cli` suites |
| `data/` | **git-ignored.** Captured markup and annotation files live here |

## The schema is frozen before annotation

`src/schema.mjs` is settled now rather than after data arrives, because a schema fixed
afterwards can be bent to fit whatever was collected. The invariants it enforces are the
ones that protect the research claim:

- **`declined` is refused as a ground-truth label.** It is a FormFair outcome. Admitting
  it would let a hard case be recorded as agreement with the tool instead of going to
  adjudication.
- **A personal-name control carries exactly five rule pairs.** Fewer silently shrinks the
  denominator; more double-counts.
- **Every label carries a reason and markup evidence**, so a label cannot be a bare
  assertion and adjudication has something to work from.
- **The viewport is fixed at 1280x800.** A capture at another size is not comparable.
- **`detected` is required on every control in a dataset.** Stage-one recall cannot be
  computed without it.

## Order of operations

1. Capture the frame, build `frame.csv`, hash it. **Done** - see `frame/README.md`.
2. `npm run draw-order` - before visiting any form. **Done and frozen.**
3. Capture forms in that order, one page per agency.
4. Annotate independently. Lock and hash each annotator's file.
5. Compute kappa, adjudicate, lock the adjudication file.
6. `npm run seal:verify` - must pass.
7. Only then run FormFair, once, at `evaluation-v1.0.0`.
8. Join the ground truth with the reports into a dataset, then `npm run metrics`.

Steps 3 onward have not been started. `data/` exists but is empty and git-ignored;
nothing in it is a captured government page.

## Known gap before step 8

A JSON report does not name the controls FormFair identified. Findings and declines carry
a source reference, but a detected control on which all five rules come back clean leaves
no trace beyond the `summary.controls` count, so stage-one precision and recall cannot be
computed from reports alone.

This does **not** require changing the frozen analyser: `findNameControls` is exported
from `formfair`, so the join step can enumerate detected controls at
`evaluation-v1.0.0` and pair them with the report by source line and column. The dataset
schema requires `detected` for exactly this reason, and the join is deliberately a
separate, inspectable artefact rather than something that happens invisibly inside the
scoring.
