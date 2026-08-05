# Rule catalogue

Version 0.1.0 — unfrozen.

The catalogue is versioned independently of the tool because rule changes alter
reported results. Every report records the catalogue version that produced it, so
historical results stay reproducible. The catalogue is frozen at a tagged version
before the held-out evaluation partition is analysed; any revision after that point
is reported separately and labelled post hoc.

## FF-01 — Basic Latin only

**Trigger.** A decidable pattern on an identified name control whose character class
admits letters only from U+0041–U+005A and U+0061–U+007A.

**Basis.** UTS #35 Part 8 advises drawing permitted characters from the CLDR exemplar
sets for the relevant languages rather than restricting to ASCII.

**Why the ranges and not the word "Latin".** The Latin script in Unicode extends well
beyond Basic Latin: Latin-1 Supplement and Latin Extended-A contain many precomposed
accented letters, including the macronised vowels of te reo Māori. A constraint
restricted to the Latin *script* does not necessarily exclude diacritics; one restricted
to Basic Latin does. The subsumption of FF-02 depends on this precision.

**Verification.** Paired fixtures — a Basic Latin control name that must be accepted,
and the diacritic fixture set that must all be rejected — plus mutation injection into
known-clean forms.

## FF-02 — Rejects diacritics

**Trigger.** A decidable pattern admitting letters beyond Basic Latin but rejecting
precomposed diacritic code points such as U+0101.

**Basis.** UTS #35 Part 8. Diacritics are ordinary letters in te reo Māori and many
other orthographies; vowel length is phonemic in te reo Māori, so stripping a macron
produces a different word rather than a variant spelling.

**Interaction.** Subsumed by FF-01. Where FF-01 fires this rule adds no information and
is listed as contributing evidence rather than emitted separately.

## FF-03 — Normalisation asymmetry

**Trigger.** A decidable pattern or length constraint yielding different accept/reject
outcomes for at least one pair in the predefined NFC/NFD test set.

**Basis.** UAX #15; UTS #35 Part 8 recommends normalising before validation, typically
to NFC.

**Bound.** The rule detects asymmetry for the predefined pairs. It does not prove the
absence of asymmetry for arbitrary input, and no general claim is made.

## FF-04 — Rejects name punctuation

**Trigger.** A decidable pattern excluding apostrophe (U+0027 or U+2019), hyphen-minus
(U+002D) or internal space.

**Basis.** UTS #35 Part 8. Names such as O’Brien, Anne-Marie and van der Berg require
these characters.

**Interaction.** Independent, never subsumed. A pattern may reject diacritics while
admitting punctuation, or the reverse.

## FF-05 — Minimum length above one

**Trigger.** An explicit `minlength` greater than one, or a decidable pattern whose
minimum accepted length, computed across the complete expression, exceeds one.

**Basis.** Ishida (2011) records that people can have single-letter names. UTS #35
Part 8 does not make this claim and is not cited for it.

**Bound.** Length is computed in UTF-16 code units to match the attributes. Where any
atom admits a supplementary-plane character the units cannot be reconciled and the
control is declined.

## Fixture universe

Characters are drawn from the CLDR exemplar sets for the declared locale list —
mi, sm, to, en, fr, de, es, pl, cs, tr, vi — supplemented by an explicit macron set for
te reo Māori. The list is versioned with this catalogue. Detection is claimed only for
characters within it.
