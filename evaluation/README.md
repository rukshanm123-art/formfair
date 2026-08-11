# Evaluation harness

Implements [the frozen protocol](../docs/evaluation/PROTOCOL.md) against
[the frozen instrument](../docs/evaluation/README.md).

**This package has no dependencies, by design.** It is kept out of the analyser's
dependency tree so that building evaluation tooling cannot change the instrument the
evaluation is run with. Tests use `node:test`.

```bash
cd evaluation
npm test              # 125 tests, on synthetic fixtures only
npm run draw-order    # verify the frozen order still matches the frame
npm run build-frame   # rebuild frame.csv from the archived page and re-assert its counts
npm run metrics -- fixtures/synthetic/dataset.valid.json --synthetic
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
| `src/inventory.mjs` | protocol section 7 - the neutral control inventory annotators label |
| `src/join.mjs` | inventory + adjudicated truth + run output -> the scored dataset |
| `src/metrics.mjs` | protocol section 9 - stage one, stage two, end to end |
| `src/draw-order.mjs` | protocol section 2 - deterministic agency ordering |
| `src/seal.mjs` | protocol section 10 - the gate that must pass before FormFair runs |
| `src/build-frame.mjs` | protocol section 1 - frame extraction, with count assertions |
| `src/cli-draw-order.mjs` | verify, or `--write`, the frozen order |
| `src/cli-metrics.mjs` | compute the metrics from a joined dataset |
| `src/cli-seal.mjs` | check the seal |
| `frame/` | **the frozen sampling frame.** Tagged `frame-v1.0.0`, hashed, do not edit |
| `fixtures/synthetic/` | development material. Nothing here is, or may become, a captured page |
| `test/` | `stats`, `metrics`, `schema`, `protocol`, `cli` and `pipeline` suites |
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

## The control inventory

Line and column alone are too weak an identity: two inputs can share a position after a
whitespace change, and a position moves if the bytes are ever re-saved. Each inventory
record therefore carries `pageId`, the captured HTML's SHA-256, line, column, the SHA-256
of the element's exact source slice, the supported input type, and a stable `controlId`.

The inventory is built from the captured bytes with the **instrument's own pinned parse5
7.3.0**. A different parser, or a different version, can report different source
positions, and a position that disagreed with the analyser's would break the join
silently. This is why the harness declares no dependencies of its own but does need the
instrument built: `npm ci && npm run build` at the repository root.

Annotators label exactly this inventory, which is frozen before annotation, so the set of
things being judged cannot be influenced by the tool's output. A supported input that is
plainly not a personal-name control is still in the inventory and still annotated;
omitting it would hide a false positive.

## The join, and what it refuses

After the seal closes, `findNameControls` is called at `evaluation-v1.0.0` and each
detected control must match **exactly one** inventory record by page, position and
snippet hash. Ambiguity is an error, not a best guess.

The join then asserts, and refuses to produce a dataset otherwise:

- `findNameControls().length` equals the report's control count;
- every finding, decline and advisory maps to one detected control;
- every detected personal-name control receives exactly one outcome per FF rule;
- every control has adjudicated ground truth.

It records the SHA-256 of the inventory, the annotation, the adjudication, the reports,
the captured HTML per page, and the dataset itself, so any figure can be traced to the
exact material behind it.

Why a report alone is not enough: a detected control on which all five rules come back
clean leaves no trace beyond the `summary.controls` count. `findNameControls` supplies
the missing identities without changing the frozen analyser.

## Official metrics require a closed seal

`npm run metrics` refuses to run without `--seal` naming a **closed** seal: one carrying
the run record and the hashes of what the run produced. A pre-run seal is not enough,
because it says annotation finished before the tool was seen but not which run the
figures describe.

`--synthetic` bypasses this for fixtures, and refuses any dataset that does not declare
`"synthetic": true`, so it cannot be used to score real data by mistake. The two flags
are mutually exclusive.

## Figures below the reporting threshold

Where a denominator is under five, `wilson()` and `bootstrapF1()` return the reason and
the raw counts and **nothing else** - no point estimate, no interval. `score()` emits no
bare point either. A number that should not be reported is not left one property access
away from being printed.
