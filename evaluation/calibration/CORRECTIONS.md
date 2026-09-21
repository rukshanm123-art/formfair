# Corrections to the answer key

A record of every change made to `answer-key.json` after it was first derived, why, and on
what authority. It exists because the key is the only declared guard against the author
misreading the catalogue, and a guard whose own history is invisible guards nothing.

The examiner's question is the right one: if three labels were changed after both
implementations disagreed with them, on what basis should anyone accept that they were
corrected *against the catalogue* rather than by deferring to the tool? This file is the
answer, and it is weaker than it should be.

## Correction 1 - FF-03 on B06, B07, B11

**Dated 21 September 2026. Before any held-out form was captured.**

| Control | Pattern (as first written) | Before | After |
|---|---|---|---|
| B06 | `[A-Za-zéèêëàâ]+` | FF-03 positive | FF-03 negative |
| B07 | `[A-Za-zéèêë'’ \-]{2,}` | FF-03 positive | FF-03 negative |
| B11 | `[A-Za-zéèêëàâîô'’ \-]+` | FF-03 positive | FF-03 negative |

**The error.** The key was derived on the reading that any class admitting precomposed
diacritics but no combining marks creates an NFC/NFD asymmetry, and therefore fires FF-03.

**The catalogue clause relied on.** FF-03's trigger is scoped: it fires on "at least one
canonically equivalent pair **in the frozen, versioned NFC/NFD fixture set**". That set is
`NORMALISATION_PAIRS` in `src/rules/fixtures.ts`: Tāwhiao, Émile, Müller. The three classes
above admit none of those names in NFC - Tāwhiao needs U+0101, Émile needs uppercase
U+00C9, Müller needs U+00FC, and none of the three is in any of the classes. Both forms of
every pair are therefore rejected, which is symmetric treatment, and the rule does not
fire. The general claim about precomposed diacritics is the one the catalogue explicitly
declines to score, reporting it as ADV-NORM-BOUNDARY instead.

**Honest statement of how the error was found.** It was not found by re-reading the
catalogue. It was found because the behavioural witness and the frozen analyser both
disagreed with the key, which prompted the re-reading that located the scoping clause. The
correction was then justified from the clause above, but the *prompt* to look was the
disagreement. Anyone weighing this key should know that.

**Not recoverable from git.** The correction was made before the first commit of the
calibration corpus, so the pre-correction key was never committed and this table is the
only record of it. That is a defect in how the work was done, not a property of the method.
Every future correction is to be committed before it is applied, so the prior state is
recoverable from history rather than from a file the author wrote afterwards.

## Correction 2 - restoring the FF-03 balance

**Same date.** Correction 1 dropped FF-03 to 7 positives, below protocol section 6's floor
of ten. Uppercase É (U+00C9) was added to the three classes, which makes Émile reachable in
NFC but not in NFD and therefore genuinely triggers FF-03. This changed the *corpus*, not
the reading of the catalogue: the labels follow from the amended patterns.
