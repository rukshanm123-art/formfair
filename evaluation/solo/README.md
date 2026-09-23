# Solo evaluation

This is the active no-participant evaluation defined by
[`docs/evaluation/SOLO-PROTOCOL.md`](../../docs/evaluation/SOLO-PROTOCOL.md). The older
annotation, adjudication and accuracy harness remains under `evaluation/src/` as a
historical frozen design; it is not weakened or used without its required people.

## Evidence produced

| Command | Evidence |
|---|---|
| `npm run solo:study` | 25 seeded mutants, browser-semantic checks, five metamorphic relations, 1,000 deterministic robustness cases, optional performance profile |
| `npm run solo:seal-corpus` | builds a content-hash manifest for the frame identity, draw order, selection ledger, page metadata and every capture |
| `npm run solo:descriptive` | applicability, observable constraints, tool-reported findings, declines, advisories and unscored delegated findings |
| `npm run test:solo` | adversarial tests for the study and the corpus manifest |

The technical report states its own limits. Its mutation score is not precision or
recall. The descriptive report calls every result a tool-reported finding and contains no
accuracy or defect-prevalence field.

## Development run

Build the analyser first. Development mode is permitted only for synthetic material.

```bash
npm run build
npm --prefix evaluation run test:solo
npm --prefix evaluation run solo:study -- --development --performance --out /tmp/formfair-study.json
```

The technical command refuses to overwrite an existing output. Before official use,
create a clean annotated `evaluation-v1.1.0` tag. Without `--development`, the loader
requires that exact tag at `HEAD`, a clean working tree, a built package and a lockfile.

## Real-form sequence

1. Freeze `evaluation-v1.1.0` and `solo-protocol-v1.0.0`.
2. Follow the existing frame and draw order. Record every attempted URL and exclusion in
   a selection ledger.
3. Save the full rendered page at 1280 x 800 and complete a copy of
   `corpus-draft.template.json`.
4. Build the content-hash corpus manifest:

   ```bash
   npm run solo:seal-corpus -- --draft data/corpus-draft.json \
     --captures data/captures --out corpus/corpus-v1.0.0.json
   ```

5. Commit the manifest, tag that commit `corpus-v1.0.0`, and leave the captured HTML
   outside version control. The tag is the evidence that the manifest existed before
   FormFair output was seen; a hash cannot prove its own timing.
6. Check out `evaluation-v1.1.0` separately, set
   `FORMFAIR_SOLO_INSTRUMENT_DIR` to that checkout, and produce the report from the
   `corpus-v1.0.0` checkout:

   ```bash
   npm run solo:descriptive -- --manifest corpus/corpus-v1.0.0.json \
     --captures data/captures --out data/descriptive-report.json
   ```

Both commands verify the frozen instrument. The descriptive command also refuses an
untracked, modified or untagged corpus manifest, re-hashes the selection ledger and every
page before running FormFair, invokes the inert jsdom-backed axe provider, and publishes
positions and aggregates without reproducing captured input markup.

## What may be concluded

The study can support software-engineering claims about catalogue conformance, seeded
fault detection, defined metamorphic relations, robustness, determinism, reproducibility
and runtime. It can describe tool behaviour in the captured corpus.

It cannot support human-validated accuracy, actual-defect prevalence, or a claim that
affected people find the rules culturally sufficient. Those limits are encoded in the
JSON reports as well as documented here.
