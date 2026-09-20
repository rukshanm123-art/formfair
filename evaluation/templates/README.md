# Templates

Blank forms for the held-out evaluation, matching the frozen schema in `src/schema.mjs`.
Both JSON templates validate as they stand, so a copy that fails validation failed because
of an edit, not because the template was wrong.

| File | For |
|---|---|
| `annotation.template.json` | one primary annotator's independent labels |
| `adjudication.template.json` | the adjudicator's decisions on disagreements only |
| `results.template.md` | the reporting skeleton for section 9 |

A capture record template is deliberately absent: capture records are written by the
capture harness, not by hand. `fixtures/synthetic/capture.valid.json` shows the shape.

Validate a filled copy before handing it over:

```bash
node -e "import('./src/schema.mjs').then(async (s)=>{const f=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const r=s.VALIDATORS[process.argv[2]](f);console.log(r.valid?'valid':r.problems)})" your-file.json annotation
```

Three invariants the validators enforce, each protecting a research claim rather than the
parser:

- **`declined` is not a ground-truth label.** It is a FormFair outcome. Admitting it would
  let a hard case be recorded as agreement with the tool.
- **A personal-name control carries exactly five rule pairs.** Fewer shrinks the
  denominator; more double-counts.
- **Every label carries a reason and markup evidence.** A label cannot be a bare assertion,
  and adjudication needs something to work from.
