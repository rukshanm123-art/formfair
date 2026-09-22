# Open conflict: FF-02 fires without the letters its trigger requires

**Raised 22 September 2026. Before any held-out form was captured. Unresolved — this file
records the conflict and the options; it does not decide.**

Two frozen artefacts disagree. Neither has been changed, and no tag has been moved.

## The conflict

`catalogue-v1.0.0`, FF-02:

> **Trigger.** A decidable pattern **admitting letters beyond Basic Latin**, where at least
> one precomposed diacritic character required by a fixture name — such as U+0101 — is
> admitted at no position.

The trigger has two conditions. The first is a precondition about admission: the pattern
must admit letters beyond Basic Latin. The second is about exclusion.

`evaluation-v1.0.0` checks the second and not the first.

## Reproduction

A control detected as a personal-name field, carrying `pattern="[0-9]{1}"`:

```
findings: FF-02, FF-04
declined: (none)
FF-02 evidence: No position in pattern="[0-9]{1}" admits the characters these names
  require: Tāwhiao (mi, needs ā), Ngātā (mi, needs ā), Faʻasamoa (sm, needs ʻ),
  Émile (fr, needs É), Müller (de, needs ü), Núñez (es, needs ú ñ), Łukasz (pl, needs Ł),
  Dvořák (cs, needs ř á), Gültekin (tr, needs ü), Nguyễn (vi, needs ễ).
```

`[0-9]{1}` admits no letters at all, so the catalogue's precondition is not met and FF-02
should not fire. The evidence string shows the reasoning: it is entirely about exclusion,
and never asks whether any letter beyond Basic Latin is admitted.

FF-04 firing on the same control is consistent with the catalogue, which does not gate
FF-04 on letters being admitted.

## Why it matters, and how much

It cannot affect a control that admits ordinary letters, so it does not touch the common
case. It matters where stage one detects a control whose constraint admits no letters —
either a genuine numeric field that is mislabelled, or a stage-one false positive. In both
cases FF-02 fires where the catalogue says it should not, which inflates FF-02's false
positives and lowers its reported precision. It is narrow, but it is in the direction that
makes the tool look worse rather than better, and it is a contradiction between two tagged
artefacts either way.

## Options

1. **Amend the catalogue** so the precondition matches the implementation — i.e. FF-02
   fires on the exclusion alone. This is the smallest change, but it broadens the rule to
   cover controls that admit no letters, where "rejects diacritics" is a strange thing to
   say, and it weakens the FF-01/FF-02 subsumption argument that rests on the precision of
   what each admits. Requires `catalogue-v1.1.0`.
2. **Amend the analyser** to check the precondition, which is what the catalogue as written
   requires. This is the faithful fix. It changes the instrument, so it requires
   `evaluation-v1.1.0`, a rebuilt frozen checkout, and a re-run of the instrument record and
   snapshot verification. Nothing has been evaluated with the current instrument, so
   nothing would need recomputing.
3. **Record it as a known deviation** and neither artefact changes. Honest and cheapest,
   but it means reporting FF-02 figures from an implementation that does not match its own
   published trigger, and an examiner who reads both will find it.

## Recommendation, for the supervisor's decision

Option 2. The catalogue's precondition is not decoration: the argument that FF-01 subsumes
FF-02 turns on exactly which characters each admits, and loosening FF-02 to fire without
any letters at all undermines it. No figure exists to be recomputed, the capture has not
started, and this is therefore the cheapest moment this fix will ever be available. It does
mean a new instrument tag before capture.

Option 3 is acceptable only if the deviation is stated wherever FF-02 precision is
reported, not once in a limitations section.

## Status

- `catalogue-v1.0.0` unmoved.
- `evaluation-v1.0.0` unmoved.
- No form captured, no annotator has coded anything.
