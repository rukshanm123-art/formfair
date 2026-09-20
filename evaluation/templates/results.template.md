# Held-out evaluation results

> **Template.** Every figure below starts as `not estimable`. A figure is filled in only
> from the metrics output of the single official run, and a figure the harness refused is
> left as `not estimable` with its counts - never quietly omitted, and never replaced with
> a point estimate. Delete this block when the results are real.

## Provenance

Copy verbatim from the `harness` block of the metrics output. Do not retype from memory.

| | |
|---|---|
| Protocol | FormFair Held-Out Evaluation Protocol v1.0 (`protocol-v1.0.0`) |
| Analyser | `evaluation-v1.0.0` |
| Catalogue | `catalogue-v1.0.0` |
| Harness | `harness-v1.1.0`, commit `________` |
| Working tree clean at run time | `dirty: ________` |
| Tag present at that commit | `taggedAtThisCommit: ________` |
| Interval method, control level | page-cluster bootstrap, 2,000 resamples, seed `evaluation-v1.0.0` |
| Interval method, form level | Wilson score interval |
| Floors | denominator 5; contributing pages 5 |
| Run date (UTC) | ________ |

## Achieved sample

| | |
|---|---|
| Agencies in frame | 45 |
| Agencies attempted | ____ |
| Eligible forms captured | ____ of a target of 40 |
| Shortfall and why | ____ |
| Supported inputs annotated | ____ |
| Controls adjudicated as personal-name controls | ____ |

State the shortfall plainly. The frame is not widened to reach 40.

## Agreement, from the original independent labels

Computed before adjudication, from what each primary annotator wrote without seeing the
other. Percentage agreement and label counts accompany every kappa.

| Basis | Kappa | % agreement | n | Both positive | Both negative | Disagreements |
|---|---|---|---|---|---|---|
| Stage one | | | | | | |
| FF-01 | | | | | | |
| FF-02 | | | | | | |
| FF-03 | | | | | | |
| FF-04 | | | | | | |
| FF-05 | | | | | | |
| Pooled rule pairs | | | | | | |

Report `not estimable` where both annotators used a single category. Report
`stageOneDisagreements` and `controlsInPerRuleBasis` alongside the per-rule figures.

## Stage one - did FormFair find the name controls?

Denominator: every supported text/search input in the ground truth.

| | Point | 95% interval | tp | fp | fn | tn | Pages contributing |
|---|---|---|---|---|---|---|---|
| Precision | | | | | | | |
| Recall | | | | | | | |
| F1 | | | | | | | |

## Stage two - where it looked, was it right?

Denominator: decided rule-control pairs on detected name controls. **This measure
flatters the tool**, because it conditions on detection having succeeded. Report it, but
do not lead with it.

Per rule FF-01..FF-05, and micro-aggregated. For each: precision, recall, F1, decision
coverage, and raw counts including `declinedOnNegative`.

## End to end - what a user actually gets

Denominator: every ground-truth rule-control pair, including pairs on controls FormFair
never detected. **This is the honest headline.**

Per rule FF-01..FF-05, and micro-aggregated. Scoring follows the protocol's fixed table: a
missed name control carrying a positive rule and a declined positive are both false
negatives; a decline on a negative reduces decision coverage and is neither a false
positive nor a true negative.

## Prevalence, from adjudicated ground truth

| Rule | Control-level (clustered) | Form-level (Wilson) | Positive | Labelled | Pages affected |
|---|---|---|---|---|---|
| FF-01 | | | | | |
| FF-02 | | | | | |
| FF-03 | | | | | |
| FF-04 | | | | | |
| FF-05 | | | | | |

The two columns use different interval methods deliberately. See Amendment 1.

## Reported but not scored

Advisories and delegated axe-core findings are counted and never pooled into the accuracy
figures.

## Threats and departures

Every departure from the protocol, dated, with what was done instead and why. A departure
discovered after the run is still recorded here.
