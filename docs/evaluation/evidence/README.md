# Evidence

Artefacts retained because the service that produced them does not keep them
indefinitely. GitHub expires workflow logs, so a run cited in an assessment or a viva
has to be preserved at the time it exists or it cannot be produced later.

Nothing here is evidence *about a held-out form*. No form has been captured. These are
records about the instrument and the harness.

## CI run 35541781221 - harness-v1.1.0

The continuous-integration run over the commit that `harness-v1.1.0` tags.

| | |
|---|---|
| Run | <https://github.com/rukshanm123-art/formfair/actions/runs/35541781221> |
| Workflow | CI |
| Commit | `9efb4ca9c98f684b632e1431b3c1ef3b19c9617c` |
| Tag at that commit | `harness-v1.1.0` |
| Conclusion | success, all six jobs |
| Retrieved | 21 September 2026 |

Jobs: `verify` on Node 20 and 22, `evaluation-harness`, `delegated`, `package` on
Node 20 and 22.

### What the run demonstrates

- `npm audit` exits clean. This matters because the gate is a plain `npm audit`, not
  `--audit-level=high`, and it had been failing on four dev-dependency advisories.
- The generated instrument record matches the installed tree, so the analyser's runtime
  dependencies are what `src/instrument.generated.ts` claims.
- The catalogue snapshot checksums verify, so axe-core is still 4.12.1 as pinned.
- The evaluation harness passes on synthetic fixtures only.
- The packed consumer builds and runs against the published entry points.

### What it does not demonstrate

It says nothing about accuracy on real forms. Every test in it runs on synthetic
fixtures and mutation cases that existed when `evaluation-v1.0.0` was tagged.

### Files

| File | SHA-256 |
|---|---|
| `ci-run-35541781221.json` | `3f5a0ba2fdf5fad81244207eae991a7f581a285d22156bd44f6ade9ee0a5ddd5` |
| `ci-run-35541781221.log` | `f9793ef9abb3856273487a881aeafca509e3fc0ed6d9c9ec351ed6b859493d81` |

`.json` is the run metadata as the GitHub API returned it, including per-job
conclusions. `.log` is the complete log of all six jobs, 3,258 lines.

Verify with:

```bash
shasum -a 256 -c SHA256SUMS
```
