# FormFair

Static analysis of declared personal-name validation constraints in web-form markup.

A form can satisfy WCAG 2.2 Level AA in full and still refuse a legitimate personal
name. Conformance testing checks that a field is perceivable, operable, understandable
and robust; it does not check whether the field can hold the name of the person filling
it in. FormFair checks the second property.

The analyser reads HTML, identifies personal-name controls, and reports constraints that
exclude legitimate names — with the source evidence that triggered each finding, an
explanation, and a concrete remediation. Analysis runs entirely client-side; markup is
never transmitted.

## Scope

FormFair reasons about what the markup *declares*. Server-side validation, framework
logic and script-driven mutation are not observable from markup and are out of scope by
construction. The tool reports statically observable constraints, never whether a
deployed form ultimately accepts a given name.

## Rules

| ID | Constraint detected | Severity |
|---|---|---|
| FF-01 | Character class admits letters only from Basic Latin (U+0041–U+005A, U+0061–U+007A) | Critical |
| FF-02 | Admits letters beyond Basic Latin but rejects precomposed diacritics | Critical |
| FF-03 | Accept/reject outcomes differ for canonically equivalent NFC and NFD forms | High |
| FF-04 | Excludes apostrophe, hyphen-minus or internal space | High |
| FF-05 | Minimum accepted length exceeds one character | Medium |

FF-01 subsumes FF-02: a class restricted to Basic Latin necessarily excludes every
precomposed diacritic, so where FF-01 fires FF-02 adds nothing. FF-04 is independent —
a pattern may reject diacritics while admitting punctuation, or the reverse.

Accessibility checks (labels, autocomplete tokens, error association) are delegated to
axe-core rather than reimplemented.

## Decidability

The `pattern` attribute compiles as a JavaScript regular expression with the `v` flag
and matches the entire value, so patterns are treated as fully anchored; a redundant
leading `^` or trailing `$` is stripped before analysis.

Reasoning about arbitrary patterns is not attempted. The supported subset is a top-level
concatenation of atoms — a literal, an enumerated character class, a Unicode property
escape, or a predefined class — each optionally quantified. Alternation, groups carrying
quantifiers, lookaround, backreferences and `v`-flag set operations are **declined**:
no finding is emitted, and the decline is recorded so decision coverage can be reported
alongside accuracy. Silence and a clean result are different outcomes.

### Length units

`minlength` and `maxlength` count UTF-16 code units; quantifiers in a Unicode-aware
regular expression count code points. These coincide only within the Basic Multilingual
Plane. Where an atom admits a supplementary-plane character the units cannot be
reconciled without approximation, so no length bound is computed and the control is
declined for the length-dependent rules.

## Usage

```bash
npm install
npm test          # 42 tests
npm run typecheck
```

```ts
import { analyse, decisionCoverage } from './src/index.js';

const result = analyse('<input name="firstName" pattern="[A-Za-z]+">');
console.log(result.findings);
console.log(decisionCoverage(result));
```

## Catalogue snapshots

`docs/catalogue-snapshots/` holds dated captures of the published rule catalogues for
the seven production analysers the project compares itself against, with SHA-256 hashes.
Catalogues change between releases; the captures fix what was inspected so the comparison
stays checkable. Verify with `shasum -a 256 -c SHA256SUMS`.

## Licence

MIT.
