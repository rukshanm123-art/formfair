# Evaluation harness

Implements [the frozen protocol](../docs/evaluation/PROTOCOL.md) against
[the frozen instrument](../docs/evaluation/README.md).

**This package has no dependencies, by design.** It is kept out of the analyser's
dependency tree so that building evaluation tooling cannot change the instrument the
evaluation is run with. Tests use `node:test`.

```bash
cd evaluation
npm test              # 169 tests, on synthetic fixtures only
npm run draw-order    # verify the frozen order still matches the frame
npm run build-frame   # rebuild frame.csv from the archived page and re-assert its counts
npm run metrics -- fixtures/synthetic/dataset.valid.json --synthetic
npm run seal:verify -- data/seal.json
```

## The instrument is a separate checkout

The harness must be tested against `evaluation-v1.0.0`, not against this branch. main's
analyser sources drift as work continues, and the frozen instrument is not only a set of
rule behaviours: it includes the exact message, evidence and basis text a report carries.
A later commit replaced the en dashes in one evidence string, which is enough to make the
working tree the wrong thing to test against.

```bash
bash scripts/setup-instrument.sh          # git worktree at the tag, npm ci, build
export FORMFAIR_INSTRUMENT_DIR=$PWD/../.instrument
npm test
```

`instrument-ref.mjs` refuses any directory whose commit is not
`9f43862d033e1b45890f977cffb89ca4a9504d40` or whose lockfile does not match the hash
recorded in the tag, and a test asserts that the harness checkout itself is rejected.
parse5 is resolved from that directory too, so the inventory's source positions come from
the same parser the analyser uses.

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
| `src/instrument-ref.mjs` | resolves and verifies the frozen instrument checkout |
| `src/cli-inventory.mjs` | build the inventory from captured pages |
| `src/cli-join.mjs` | run the instrument under the seal and join into the dataset |
| `src/ground-truth.mjs` | derive final ground truth from both annotations plus adjudication |
| `src/run-lock.mjs` | exclusive, durable record that a run has started |
| `src/cli-ground-truth.mjs` | the same, from the command line |
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

## Order of the sealed pipeline

```
inventory -> annotate (x2) -> ground truth -> PRE-RUN SEAL -> join -> CLOSED SEAL -> metrics
                                                              ^
                                                     FormFair runs here, and
                                                     only here, and only with
                                                     a valid pre-run seal
```

**Ground truth is derived, not assembled.** `cli-ground-truth.mjs` produces it from both
annotations and the adjudication: where the annotators agree, that label stands; where
they disagree, an adjudicated decision is required and its absence is an error, never a
silent preference for one annotator. An adjudicated decision on a case nobody disputed is
also an error. Output is byte-identical for identical inputs.

**The pre-run seal covers six files**: both annotations, the kappa file, the adjudication,
the frozen inventory and the final ground truth. The last two are in it because the join
is handed paths to them; without sealing them, a different inventory or a hand-edited
ground truth could be supplied.

**`cli-join.mjs` requires `--seal` and will not start without it.** It is the command that
calls `findNameControls` and `analyseWith`, so this is where section 10 has to bite. It
also checks the inventory and ground truth it was given **by hash** against the seal, and
re-hashes every captured page against the sealed inventory, so the bytes analysed are
provably the bytes annotated. A seal that already records a run is refused: a second run
would be post hoc.

**The closed seal is a separate file.** Overwriting the pre-run seal would destroy the
evidence that annotation finished before the tool was seen. All hashes in it are computed
from the sealed files; there is no caller-supplied hash list to trust.

**A pre-run seal is good for exactly one run.** The seal is deliberately unchanged by a
run, so on its own it could be presented again and again, producing a second dataset and a
choice between them. Before the analyser is touched, `cli-join` claims the run by creating
`<seal>.run` exclusively and flushing it to disk. A second attempt against the same seal is
refused. A run that fails after claiming leaves the record behind marked `failed`, so it
cannot be quietly repeated: running again means deleting the lock deliberately.

**Everything checkable is checked before the analyser starts.** The sealed ground truth is
**regenerated** from the sealed annotations, adjudication and inventory and must match byte
for byte, so a hand-written ground truth cannot simply be sealed alongside annotations that
do not imply it. Every capture is verified against the sealed inventory, and the ground
truth must cover exactly the inventory. Nothing is written until the join and the schema
validation have both succeeded, so a fault cannot leave a half-finished run on disk.

**Delegated findings are actually collected.** The join runs the frozen instrument's
pinned axe-core 4.12.1 provider and emits `toJsonWithDelegated` reports. A count of zero
would otherwise be indistinguishable from never having asked, so a synthetic page carries
an unlabelled input and a test asserts the joined dataset contains a non-zero delegated
count that never enters the accuracy figures.

`--no-delegated` exists only to keep the synthetic fixtures fast, and is refused unless
`--synthetic` is passed with it. A synthetic run marks its dataset and closed seal
`synthetic: true`, which the metrics then refuse through the sealed path, so a run without
the delegated engine cannot become an official figure.

## Official metrics require a closed seal

`npm run metrics` refuses to run without `--seal` naming a **closed** seal carrying the
run record and the hashes of what the run produced, and it binds that seal to the dataset
in front of it: the dataset must hash to the sealed dataset and its `builtFrom` must name
the sealed inventory, ground truth, reports, both annotations, kappa and adjudication.

`--synthetic` bypasses this for fixtures, refuses any dataset not declaring
`"synthetic": true`, and is mutually exclusive with `--seal`.

## Figures below the reporting threshold

Where a denominator is under five, `wilson()` and `bootstrapF1()` return the reason and
the raw counts and **nothing else** - no point estimate, no interval. `score()` emits no
bare point either. A number that should not be reported is not left one property access
away from being printed.
