# Synthetic fixtures

Development and annotator-training material, protocol section 4. Everything here is
invented. **No file in this directory is, or may become, a captured page.**

These exercise the harness end to end without touching the held-out set: the schema
validators, the metrics, and the command-line entry points are all tested against them.

| File | |
|---|---|
| `dataset.valid.json` | a joined dataset covering every scoring case the protocol fixes |
| `dataset.invalid.json` | the same shape with faults the validators must catch |
| `annotation.valid.json` | one annotator's independent labels |
| `annotation.invalid.json` | faults an annotation file must not pass with |
| `adjudication.valid.json` | decisions on disagreements |
| `capture.valid.json` | capture records, one captured and one excluded |
