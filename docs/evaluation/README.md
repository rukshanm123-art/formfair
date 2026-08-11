# The evaluation instrument

A catalogue version does not reproduce a result on its own. The HTML parser decides
which controls are seen at all, the accessibility engine decides the delegated findings,
the analysis code sits between them, and the build tooling can change any of it. An
evaluation is only reproducible if every one of those is fixed together.

Held-out analysis is therefore run from a single annotated tag, `evaluation-v1.0.0`,
which fixes all of them at once.

## What the tag fixes

| Element | Where it is recorded |
|---|---|
| Exact commit | the tag's target — `git rev-parse evaluation-v1.0.0^{}` |
| Resolved dependency tree | `package-lock.json` at that commit; its SHA-256 is in the tag message |
| Catalogue version | `CATALOGUE_VERSION` in `src/rules/index.ts`, and every report |
| FormFair package version | `package.json`, and every report |
| parse5 and axe-core versions | `src/instrument.generated.ts`, and every report |
| Node version used | recorded in the tag message; each report records the one it ran on |

Every JSON report carries an `instrument` block naming the catalogue, the package, the
dependency versions and the runtime, so a stored result can be tied back to the tag that
produced it without external bookkeeping.

## Reproducing a run

```bash
git checkout evaluation-v1.0.0
npm ci                    # the locked tree, not a fresh resolution
npm run verify:snapshots  # the engine matches its captured catalogue evidence
npm test
```

`npm ci` is required. `npm install` may resolve a newer dependency and silently change
the instrument.

## Rules for the evaluation period

1. **No dependency changes are merged while held-out analysis is in progress.** A
   dependency bump changes the instrument, which invalidates comparison against runs
   already completed.
2. Every held-out form is analysed at this exact tag.
3. Any rule change after the freeze is reported separately and labelled post hoc; it
   does not enter the frozen catalogue's figures.
4. A bump to a delegated engine additionally requires recapturing
   `docs/catalogue-snapshots/` in the same change. `npm run verify:snapshots` fails
   until that is done, and CI runs it.

## Relationship to the catalogue tag

`catalogue-v1.0.0` freezes *what the rules are*. `evaluation-v1.0.0` freezes *the whole
instrument that applies them*. The catalogue tag is the earlier of the two; the
evaluation tag is the one to cite for any reported figure.
