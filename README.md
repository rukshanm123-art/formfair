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

FF-01, FF-02 and FF-04 are decided from the character sets the pattern parses into,
one character at a time, never from whether a whole example name matches. The two are
not equivalent: `pattern="[A-Za-z]{1,3}"` rejects every name in the fixture set, but it
rejects them for their length, and reading that as a statement about characters
attributes the wrong defect to the field. The fixture names illustrate a finding; they
do not decide whether it fires.

FF-03 weighs `minlength`, `maxlength` and `pattern` together, because decomposing a name
lengthens it in UTF-16 code units. A `maxlength` alone can accept one encoding of a name
and reject the other, with no pattern involved at all.

Accessibility checks (labels, autocomplete tokens, error association) are delegated to
axe-core rather than reimplemented. Delegated findings are reported under their own
heading, labelled with the engine and version, and are excluded from FormFair's accuracy
figures — they are another tool's results, not this catalogue's.

## Identifying name controls

Before any rule runs, a control has to be recognised as holding a personal name. Signals
are weighed and summed against a threshold rather than allowed to veto one another: an
`autocomplete` token, the `name` and `id` attributes, the associated label text, the
placeholder and `aria-label`, and the class list each contribute, positively or
negatively. Label text is read from all three ways markup associates one — an enclosing
`<label>`, a `<label for>` elsewhere in the document, and `aria-labelledby` — because
where the attributes name the widget, the label is often the only place the human-facing
word appears.

A control missed here is never examined, and its anti-patterns are silently absent from
the output, so this stage is measured and reported separately from rule accuracy. Each
identified control carries the score and the signals that produced it.

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

Requires Node 20 or later: the analyser compiles patterns with the regular-expression
`v` flag, as a browser does.

```bash
npm install
npm test              # 86 tests, the rule catalogue and reports
npm run test:delegated  # the axe-core suite, which boots a DOM and is much slower
npm run typecheck
npm run build         # dist/index.js with type declarations
npm run example       # regenerates examples/sample-report.html
```

```ts
import { analyse, toText, toHtml, toJsonString } from './src/index.js';

const result = analyse('<input name="firstName" pattern="[A-Za-z]+">');

console.log(toText(result));      // plain text, for a terminal or CI log
toHtml(result);                   // self-contained HTML, no external assets
toJsonString(result);             // machine-readable, schema formfair/report@1
```

Every finding carries the source evidence that triggered it, an explanation, and a
concrete remediation. Declines are reported alongside findings rather than omitted,
so a consumer can distinguish "no anti-pattern" from "not analysed".

`examples/sample-report.html` is generated output, produced by `npm run example` so it
cannot drift from what the analyser emits.

### A worked example

The Unicode-aware pattern a careful developer reaches for is not sufficient on its own:

```
pattern="[\p{L}\u0027 \x2D]+"        FF-03 — accepts "Tāwhiao" but rejects its decomposed form
pattern="[\p{L}\p{M}\u0027 \x2D]+"   clean
```

`\p{L}` matches letters but not combining marks, so the precomposed and decomposed
forms of the same name are treated differently. This is the case FF-03 exists for.

The hyphen is written `\x2D` rather than bare. Under the `v` flag a literal `-` at the
end of a character class is a syntax error, so `[\p{L}\p{M}' -]+` is not a valid HTML
`pattern` at all. FormFair compiles with `v` only and declines such a control rather
than re-reading it under looser flags, which would describe an expression no browser runs.

## Catalogue snapshots

`docs/catalogue-snapshots/` holds dated captures of the published rule catalogues for
the seven production analysers the project compares itself against, with SHA-256 hashes.
Catalogues change between releases; the captures fix what was inspected so the comparison
stays checkable. Verify with `shasum -a 256 -c SHA256SUMS`.

## Licence

MIT.
