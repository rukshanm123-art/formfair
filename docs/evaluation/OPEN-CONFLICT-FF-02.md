# Open conflict: FF-02 fires without the letters its trigger requires

**Raised and resolved 22 September 2026, before any government form was captured.** This
file preserves the decision trail; no existing tag was moved.

Two frozen artefacts disagreed. The analyser has since been corrected in the working tree
and will be frozen as `evaluation-v1.1.0`; `catalogue-v1.0.0` is unchanged and no existing
tag has been moved. What follows is the conflict as it stood when it was raised.

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
case. It bites on any detected control whose constraint admits no letters at all, and there
are three such cases, not two as this file first said:

1. A **genuine personal-name field given a numeric-only or symbol-only pattern by mistake**
   — a copied postcode or reference-number pattern left on a name input. This is the case
   that matters most: the control really is a name field, it really is broken, and stage one
   is right about it. FF-02 then fires with an evidence string about macrons and diacritics
   that misdescribes what is wrong with the field.
2. A numeric field mislabelled such that stage one detects it.
3. A stage-one false positive.

In all three FF-02 fires where the catalogue says it should not, which inflates FF-02's
false positives and lowers its reported precision. It is narrow, it cuts against the tool
rather than for it, and it is a contradiction between two tagged artefacts either way.

## Options

1. **Amend the catalogue** so the precondition matches the implementation — i.e. FF-02
   fires on the exclusion alone. This is the smallest change, but it broadens the rule to
   cover controls that admit no letters, where "rejects diacritics" is a strange thing to
   say, and it weakens the FF-01/FF-02 subsumption argument that rests on the precision of
   what each admits. Requires `catalogue-v1.1.0`.
2. **Amend the analyser** to check the precondition, which is what the catalogue as written
   requires. This is the faithful fix, and it is the expensive one. It is not a one-tag
   change: the instrument tag is pinned in code, in CI and in the protocol, and every pin
   has to be considered separately.

   | What | Where |
   |---|---|
   | New instrument tag `evaluation-v1.1.0` | rebuilt frozen checkout, instrument record, snapshot verification |
   | Pinned tag **and commit** | `evaluation/src/instrument-ref.mjs` |
   | Instrument recorded in outputs | `metrics.mjs`, `inventory.mjs`, `agreement.mjs`, `cli-seal.mjs` |
   | Schema refusal | `schema.mjs` rejects any file not naming `evaluation-v1.0.0` |
   | Templates and synthetic fixtures | `templates/annotation.template.json`, `fixtures/synthetic/*.json` |
   | Setup and CI | `evaluation/scripts/setup-instrument.sh`, `.github/workflows/ci.yml` |
   | New harness tag | the harness hard-codes the instrument, so it cannot stay at `harness-v1.1.0` |
   | Dated protocol amendment | selecting the new instrument, since the protocol names `evaluation-v1.0.0` |

   **Two pins must NOT be changed with it.**

   - `DRAW_TAG` in `evaluation/src/draw-order.mjs`, and the identical string in protocol
     section 2, which hashes `evaluation-v1.0.0|<frame-sha256>|<agency-name>`. Recomputing
     the agency draw order under a new tag would produce a **different sample**. The draw
     order is already frozen and must stay pinned to the original string; the amendment has
     to say so explicitly, because the natural instinct on a version bump is to update every
     occurrence.
   - The bootstrap seed in `stats.mjs`, also the literal `evaluation-v1.0.0`. It is a seed,
     not a version reference. Changing it would move every interval for no reason and would
     be an unrelated change smuggled in under a correctness fix.

   Nothing has been evaluated with the current instrument, so no figure would need
   recomputing.
3. **Record it as a known deviation** and neither artefact changes. Honest and cheapest,
   but it means reporting FF-02 figures from an implementation that does not match its own
   published trigger, and an examiner who reads both will find it.

## Decision

Option 2 was selected. The catalogue's precondition
is not decoration: the argument that FF-01 subsumes FF-02 turns on exactly which characters
each admits, and loosening FF-02 to fire without any letters at all undermines it. No figure
exists to be recomputed and capture has not started, so this is the cheapest moment the fix
will ever be available — but "cheapest" is not "cheap". It means a new instrument tag, a new
harness tag, a dated protocol amendment, and a careful pass over the pins above in which two
of them are deliberately left alone. That is a day's work done carefully, and it must not be
attempted in the same week as capture. The analyser now returns clean for FF-02 when no
letter beyond Basic Latin is admitted, with regression cases for numeric-only,
symbol-only, Basic-Latin-only and selectively extended classes. The change remains
development work until the full suite passes and the exact commit is tagged
`evaluation-v1.1.0`.

## Status

- `catalogue-v1.0.0` unmoved.
- `evaluation-v1.0.0` unmoved.
- The corrected working tree is not yet the frozen `evaluation-v1.1.0` instrument.
- No form captured and no annotator recruited.
