# Rule catalogue

**Version 1.0.0 - frozen.** Tagged `catalogue-v1.0.0`.

The catalogue is versioned independently of the tool because rule changes alter
reported results. Every report records the catalogue version that produced it, so
historical results stay reproducible. The catalogue is frozen before the held-out
evaluation partition is analysed; any revision after that point is reported separately
and labelled post hoc.

> **Erratum, 11 August 2026.** This document continued to describe the catalogue as
> "Version 0.1.0 - unfrozen" after the freeze, and stated the FF-01, FF-02 and FF-04
> triggers in terms of an earlier implementation that decided them by testing whole
> example names. It also omitted the frozen FF-03 wording and the advisory. The
> descriptions below are the corrected record. No rule behaviour changed in this
> correction; the code at `catalogue-v1.0.0` was already as described here.

## How the character rules decide

FF-01, FF-02 and FF-04 are decided from the character sets the pattern parses into,
one character at a time. They are **not** decided by testing whole example names against
the compiled pattern.

The distinction is not cosmetic. `pattern="[A-Za-z]{1,3}"` rejects every name in the
fixture set, but rejects them for their length; reading that as a statement about
characters attributes the wrong defect to the field. Conversely
`pattern="[\p{L}\p{M}\u0027\u2019 \x2D]{1,5}"` rejects the fixture names too,
while excluding no character any of them needs.

The fixture set therefore **illustrates** a finding and supplies its evidence. It does
not determine whether the finding fires.

## Decidability

A pattern must parse into the supported subset **and** compile under the regular
expression `v` flag, which is how a browser compiles the `pattern` attribute. There is
no fallback to `u` or to no flag: an expression that only compiles under looser
semantics is not a valid HTML `pattern`, and analysing it would describe something no
browser runs. Such a control is declined, and the decline is recorded.

## FF-01 - Basic Latin only

**Trigger.** A decidable pattern on an identified name control that admits at least one
letter in U+0041-U+005A or U+0061-U+007A and no letter outside that range, established
by enumerating the parsed character sets.

**Basis.** UTS #35 Part 8 advises drawing permitted characters from the CLDR exemplar
sets for the relevant languages rather than restricting to ASCII.

**Why the ranges and not the word "Latin".** The Latin script in Unicode extends well
beyond Basic Latin: Latin-1 Supplement and Latin Extended-A contain many precomposed
accented letters, including the macronised vowels of te reo Māori. A constraint
restricted to the Latin *script* does not necessarily exclude diacritics; one restricted
to Basic Latin does. The subsumption of FF-02 depends on this precision.

**Bound.** A class resting on a property escape is put to the regular expression engine
one character at a time. That can establish that a letter outside Basic Latin is
admitted, but never that none is; where it cannot be established the control is declined
rather than reported clean.

**Verification.** Enumeration of the parsed sets, with the fixture set supplying the
evidence string. Mutation injection into known-clean forms.

## FF-02 - Rejects diacritics

**Trigger.** A decidable pattern admitting letters beyond Basic Latin, where at least
one precomposed diacritic character required by a fixture name - such as U+0101 - is
admitted at no position in the pattern.

**Basis.** UTS #35 Part 8. Diacritics are ordinary letters in te reo Māori and many
other orthographies; vowel length is phonemic in te reo Māori, so stripping a macron
produces a different word rather than a variant spelling.

**Interaction.** Subsumed by FF-01. Where FF-01 fires this rule adds no information and
is listed as contributing evidence rather than emitted separately.

## FF-03 - Normalisation asymmetry

**Trigger.** FF-03 fires when the complete set of statically observable constraints
yields different accept/reject outcomes for at least one canonically equivalent pair in
the frozen, versioned NFC/NFD fixture set.

"Complete set of statically observable constraints" means `minlength`, `maxlength` and
`pattern` evaluated together. Decomposing a name lengthens it in UTF-16 code units, so a
`maxlength` alone can accept one encoding of a name and reject the other with no pattern
involved.

**Bound.** A clean result means no asymmetry was witnessed within that fixture set. It
does **not** prove that arbitrary input is normalisation-safe.

**Why the rule is not generalised.** `maxlength` counts UTF-16 code units - HTML
Standard, via the Infra Standard's definition of string length - so for any finite
maximum M at least one value exists whose NFC form is M units and whose NFD form is
M+1. The general claim is therefore true for every M of 1 or more. It is deliberately
not scored, because doing so would change the rule from

> this control demonstrably treats a supported real-name fixture differently under NFC
> and NFD

to

> some theoretically constructible string could cross this boundary.

That is a different research construct: noisy at large limits, liable to duplicate other
findings where a pattern rejects both forms, and its precision denominator would largely
measure the presence of `maxlength` rather than observed cultural exclusion. It is
reported instead as the advisory below.

**Basis.** UAX #15; UTS #35 Part 8 recommends normalising before validation, typically
to NFC.

## FF-04 - Rejects name punctuation

**Trigger.** A decidable pattern admitting, at no position, at least one of apostrophe
(U+0027), right single quotation mark (U+2019), hyphen-minus (U+002D) or space
(U+0020), established by per-character membership.

**Basis.** UTS #35 Part 8. Names such as O'Brien, Anne-Marie and van der Berg require
these characters.

**Interaction.** Independent, never subsumed. A pattern may reject diacritics while
admitting punctuation, or the reverse.

## FF-05 - Minimum length above one

**Trigger.** An explicit `minlength` greater than one, or a decidable pattern whose
minimum accepted length, computed across the complete expression, exceeds one.

**Basis.** Ishida (2011) records that people can have single-letter names. UTS #35
Part 8 does not make this claim and is not cited for it.

**Bound.** Length is computed in UTF-16 code units to match the attributes. Where any
atom admits a supplementary-plane character the units cannot be reconciled and the
control is declined. A lazy or possessive quantifier is read as the language it matches,
so `[A-Za-z]+?` has a minimum of one; a repetition whose maximum is below its minimum is
declined rather than measured.

## Advisories - reported, never scored

An advisory records a constraint that *could* exclude a name without any fixture
witnessing that it does. Advisories appear in every output format, are marked
`scored: false` in JSON, are excluded from precision and recall by construction, and
their prevalence is reported separately from rule accuracy.

### ADV-NORM-BOUNDARY - potential normalisation boundary

**Trigger.** A finite `maxlength` of 1 or more.

**Statement.** A finite `maxlength` of 1 or more can distinguish some canonically
equivalent NFC and NFD inputs unless normalisation occurs before validation.

**Exclusion.** `maxlength="0"` raises no advisory. It rejects every non-empty name in
both encodings, so it separates no canonically equivalent pair.

**Basis.** UTS #35 Part 8 and UAX #15 recommend normalising before validating. See the
FF-03 note above for why this is an advisory rather than a finding.

## Fixture universe

Characters are drawn from the CLDR exemplar sets for the declared locale list -
mi, sm, to, en, fr, de, es, pl, cs, tr, vi - supplemented by an explicit macron set for
te reo Māori. The list is versioned with this catalogue. Detection is claimed only for
characters within it.

The fixture set supplies the characters each rule tests for membership, and the names
that appear in finding evidence. Since catalogue 1.0.0 it does not decide whether a
character rule fires; see "How the character rules decide" above.

## Identifying name controls

Before any rule runs, a control must be recognised as holding a personal name. Signals
are weighed and summed against a threshold rather than allowed to veto one another:
the `autocomplete` token, the `name` and `id` attributes, associated label text, the
placeholder and `aria-label`, and the class list each contribute positively or
negatively. Label text is read from an enclosing `<label>`, a `<label for>` elsewhere in
the document, and `aria-labelledby`.

A control missed at this stage is never examined and its anti-patterns are silently
absent from the output, so stage-one recall is measured and reported **separately** from
rule accuracy. Each identified control carries the score and the signals that produced
it.
