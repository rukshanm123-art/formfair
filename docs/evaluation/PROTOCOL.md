# FormFair Held-Out Evaluation Protocol

**Version 1.0 - frozen.** Tagged `protocol-v1.0.0`. Frozen before any government form was
opened or captured.

Instrument: [`evaluation-v1.0.0`](README.md). Catalogue: `catalogue-v1.0.0`.

**The key decision.** All new real-world forms are held out. The existing synthetic
fixtures are the development and training material.

## 1. Sampling frame

The sampling frame is the official CWAC "Website scores" page for the 30 June 2026 scan,
which gives the participating agencies and the websites monitored for each.

Before sampling:

1. Save a dated copy of the page.
2. Extract the agency-to-website mapping into `frame.csv`.
3. Record the source URL, retrieval time, scan date and SHA-256 hash.
4. Do not add organisations or websites from outside this frozen frame.

Source: <https://www.digital.govt.nz/standards-and-guidance/nz-government-web-standards/centralised-web-accessibility-checker-cwac/website-scores-cwac>

The population is described as **"websites of government agencies participating in the
CWAC programme"** - not all New Zealand websites, and not all government forms.

**Expected shortfall.** The CWAC agency leaderboard lists approximately 47 participating
agencies, so 40 eligible forms may not be reachable. That is accepted in advance. Attempt
all agencies in the frozen order and report the achieved sample honestly. The frame is
**not** widened afterwards to reach 40.

> **Observation, 11 August 2026, recorded when the frame was captured.** The Website
> scores page - the frame named above - carries **45** agencies, not 47. The page renders
> 47 accordions, two of which are explanatory panels rather than agencies. The leaderboard
> figure of 47 was descriptive context; the frame is the Website scores page, and it has
> not been substituted or widened. The target of 40 therefore allows at most 5 agencies to
> fail to yield an eligible form. See `evaluation/frame/README.md`. This note records what
> was found; it changes no rule in this protocol, and `protocol-v1.0.0` is not moved.

## 2. Random agency order

The agency is the sampling unit. One reproducible order is created before any form is
visited:

1. Sort agencies by their exact name from `frame.csv`.
2. For each agency, compute SHA-256 of `evaluation-v1.0.0|<frame-sha256>|<agency-name>`.
3. Sort agencies by that hash.
4. Save the complete result as `draw-order.csv` and hash it.

This prevents an agency being selected because its forms look interesting.

## 3. Form selection

Attempt agencies in the frozen order. **No more than one form page per agency.**

Priority order:

1. Account registration
2. Service application
3. Enquiry or contact
4. Subscription or newsletter

An eligible form must:

- be publicly reachable without signing in;
- be reached from a website listed for that agency in the CWAC frame;
- ask for the name of a natural person;
- display the name field without entering personal information or submitting the form;
- be normal HTML or a browser-rendered web application - not a PDF or native application.

A publicly reachable third-party form may be included only when it is directly linked or
embedded by a monitored agency website. Record both the agency URL and the final form host.

For each agency, record every URL examined and the reason for inclusion or exclusion.
Search by normal navigation, the sitemap, site search, and the fixed terms: *register,
sign up, apply, application, contact, enquiry, subscribe, newsletter, tono, whakapā*.

Within the first eligible priority category, select the candidate with the alphabetically
first canonical URL.

Stop after 40 eligible agencies. If all agencies are attempted and fewer than 40 qualify,
use all eligible forms and report the shortfall. **Do not expand the frame after seeing
the results.**

## 4. Partition boundary

- **Development and annotator-training set** - the synthetic fixtures and mutation cases
  that existed when `evaluation-v1.0.0` was tagged.
- **Held-out set** - every newly captured real CWAC form page.

There is no natural-form development subset, because the instrument is already frozen.
This is a pre-data clarification of the proposal's "development and held-out" wording.

The capture harness and the annotation interface are **built and tested only with
synthetic pages**. FormFair is not run on a held-out page until annotation and
adjudication are complete and sealed (section 10).

## 5. Capturing a page

A new browser profile with no account, saved data or personal information. One fixed
medium viewport of **1280 x 800**, matching CWAC's documented medium viewport.

Record for every attempt:

| Field | |
|---|---|
| `originalUrl`, `finalUrl` | before and after redirects |
| `agency`, `website` | from the frame |
| `capturedAt` | UTC |
| `browser`, `automationTool` | with versions |
| `viewport`, `locale` | |
| `redirects` | the chain |
| `category` | the priority category from section 3 |
| `status`, `exclusionReason` | captured, or why not |
| `htmlSha256` | of the captured markup |

The website's normal scripts are allowed to run **while the page loads**. The complete
rendered `document.documentElement.outerHTML` is then saved. FormFair later reads that
saved markup without executing its scripts.

The **complete captured document** is analysed, not a hand-cut `<form>` fragment. Cutting
the form out would add a preprocessing step and could remove labels or surrounding
evidence.

Captured HTML is kept private and excluded from Git. Published: its hash, provenance
metadata, labels that do not reproduce large amounts of third-party content, schemas and
scripts.

## 6. Annotators

- Two trained primary annotators independently label every held-out page.
- One adjudicator, used only for disagreements the primaries cannot resolve.
- All three are blind to FormFair output.

Before the held-out corpus is opened, both primaries pass a **synthetic calibration
exercise**:

- at least 20 stage-one decisions - 10 personal-name and 10 non-name controls;
- at least 20 decisions for each FF rule - 10 positive and 10 negative.

Required Cohen's kappa is **at least 0.70** for stage one and for each individual rule.
Below 0.70 in any category: clarify the codebook and repeat with fresh synthetic cases.
Held-out pages are never used for training.

> **Gate.** Before annotators are recruited, obtain written confirmation from the
> supervisor that they are research-team members or are covered by the ethics approval.
> Someone recruited informally from class is not assumed to sit outside the
> human-participant process.

## 7. Annotation units

### Stage one

Annotate **every** `<input>` whose `type` is missing, empty, `text` or `search` - the only
controls FormFair's frozen stage one considers.

A **positive** control collects a natural person's name, name component, nickname,
preferred name, or an HTML name component such as given name, family name or honorific.
**Excluded**: usernames, organisation names, business names, product names, pet names,
street names, search boxes, display names.

Annotating only the controls FormFair detects is **prohibited** - it would hide stage-one
false negatives.

### Stage two

For every control manually labelled a personal-name control, create five rule-control
pairs, FF-01 through FF-05.

Each human label is `positive` or `negative`. **"Declined" is a FormFair outcome, not a
ground-truth label.** Difficult cases go to adjudication.

Apply the frozen catalogue wording exactly. In particular:

- FF-01 suppresses FF-02 when the constraint is Basic-Latin-only.
- FF-03 uses only the frozen NFC/NFD fixture pairs.
- `ADV-NORM-BOUNDARY` is an advisory and is never scored.
- Delegated axe-core findings are never part of FormFair precision or recall.

Every label carries a short reason and the relevant markup evidence.

## 8. Blinding and adjudication

Each annotator's file is stored separately and locked with a SHA-256 hash **before**
comparison. Then:

1. Compute Cohen's kappa from the original independent labels.
2. Preserve both original annotation files permanently.
3. Produce a disagreement list.
4. The two annotators reconsider disagreements using only the frozen codebook and the
   markup.
5. Unresolved cases go to the adjudicator.
6. Record the final decision, reason and catalogue clause in a separate adjudication file.

The adjudicator does not see FormFair output.

If held-out kappa is low, **report it**. Do not retrain annotators, change the catalogue,
or relabel agreements after seeing FormFair results.

## 9. Metrics

Report:

- Stage-one precision, recall, F1 over all supported text/search inputs.
- Stage-two precision, recall, F1 over decided rule-control pairs.
- End-to-end precision, recall, F1 over every ground-truth rule-control pair.
- Decision coverage.
- Each FF rule separately, and micro-aggregated across all five.
- Form-level and control-level prevalence from adjudicated ground truth.
- Advisory prevalence, separately.
- Delegated axe-core findings, separately.

End-to-end scoring:

| Case | Counted as |
|---|---|
| Missed name control containing a positive rule | false negative |
| Positive case FormFair declines | false negative |
| Decline on a negative case | neither FP nor TN; reduces decision coverage |
| Finding on a negative case | false positive |

Wilson 95% confidence intervals for proportions; 2,000 bootstrap resamples for F1. Show
raw counts. **Where a denominator is below five, label the result "not estimable"** rather
than presenting it as reliable.

> **Superseded in part by [Amendment 1](#amendment-1-interval-method-for-clustered-proportions),
> 20 September 2026, before any held-out form was captured.** The interval method above is
> replaced for proportions computed over controls. The rest of this paragraph, including
> the denominator floor, stands unchanged.

Compute held-out Cohen's kappa for stage one, every rule, and the pooled rule pairs. Also
report percentage agreement and label counts. Where kappa cannot be computed because both
annotators used a single category, report **"not estimable"**.

> **Frozen decision, 11 August 2026, before any annotation: which controls enter
> per-rule agreement.**
>
> Per-rule kappa is computed over **controls both annotators independently labelled as
> personal-name controls at stage one**, and over no others.
>
> Two alternatives were rejected. Taking the union and treating an absent rule label as
> negative would invent labels: an annotator who judged a control not to be a name never
> formed a view on FF-01 for it, and the invented labels would usually agree, inflating
> the figure. Using the controls the adjudicator later ruled to be name controls would
> leak a post-adjudication decision into a measure the protocol requires to come from the
> original independent labels.
>
> The consequence is that stage-one disagreements are excluded from per-rule agreement
> rather than resolved inside it, so `stageOneDisagreements` and `controlsInPerRuleBasis`
> are reported alongside every per-rule figure.

### Two implementation choices recorded here

Neither is specified above; both are fixed now rather than after seeing results.

1. **Bootstrap resampling unit: the page (cluster bootstrap).** Controls within a page
   share markup, framework and author, so their errors are correlated; resampling
   individual pairs would understate the interval. Pages are resampled with replacement.
2. **Bootstrap seed: the string `evaluation-v1.0.0`,** through a deterministic PRNG, so
   the intervals are reproducible from the tag alone.

## 10. Evaluation seal

Only after both primary annotation files, the kappa results and the adjudication file are
locked and hashed may FormFair be run.

Every page is run **once**, at the exact `evaluation-v1.0.0` tag. The unmodified JSON
reports are preserved. Any later rerun, rule change or dependency change is labelled post
hoc and excluded from the frozen evaluation.

`npm run seal:verify` in `evaluation/` checks the seal and exits non-zero if the required
files are missing or their hashes do not match the recorded manifest.

## Amendments

Version 1.0 of this protocol is frozen and its tag `protocol-v1.0.0` is **not moved**.
Amendments are recorded here, each dated, each stating what it supersedes and why, and
each made before the evidence it affects exists. An amendment made after seeing results
would be worthless, so the precondition is recorded as part of the amendment itself.

### Amendment 1: interval method for clustered proportions

**Dated 20 September 2026. Harness tag `harness-v1.1.0`. Made before any held-out form was
captured, and therefore before any figure this affects could be known.**

**What section 9 said.** Wilson 95% confidence intervals for proportions; 2,000 bootstrap
resamples for F1.

**What is changed.** Proportions whose denominator counts **controls or rule-control
pairs** are now reported as **page-cluster bootstrap** intervals, by the same method and
the same seed already specified for F1. This covers precision, recall, decision coverage
at both stage two and end to end, and control-level prevalence.

**What is unchanged.**

- **Form-level prevalence keeps its Wilson interval,** because there the page *is* the
  unit of observation and pages are independent of one another. Advisory form-level
  prevalence likewise.
- The **denominator floor of five** and the "not estimable" rule, applied to the same
  denominator as before, per measure.
- The requirement to **show raw counts**. Every clustered interval carries `successes` and
  `total` exactly as a Wilson result does, so nothing downstream loses them.
- The seed string and the number of resamples.

**Five decisions this amendment makes that section 9 does not address.** Recorded here
because they are the amendment's own choices, fixed now, before any evidence exists. None
of them can be attributed to the frozen protocol.

1. **Quantile placement: nearest rank.** The q-quantile of the resample distribution is the
   ceil(q x n)-th smallest draw, one-indexed. The earlier implementation used floor(q x n)
   as a zero-indexed position, which shifted both bounds one order statistic upward.
2. **An unresolved bootstrap is refused, not reported.** Where fewer than **95%** of
   resamples yield a defined estimate, the result is "not estimable" with its counts and
   its resolved proportion, and no interval. Concentrating on the few draws that survived
   produces a narrow - often zero-width - interval that looks more precise than the data
   beneath it, which is the failure the denominator floor already guards against arriving
   by a second route.
3. **F1 is zero when nothing was found, not undefined.** Only counts with nothing scored at
   all are undefined. Treating a resample with no true positives as undefined would discard
   exactly the worst draws and lift the lower bound, biasing the figure in the tool's own
   favour.
4. **The floor of five applies to the number of CONTRIBUTING pages as well as the
   denominator.** Section 9 puts the floor on the denominator, which for these measures
   counts controls. For a clustered estimator the unit of observation is the page, so forty
   controls spread over two pages is two observations, not forty, and one page yields a
   zero-width interval that could not have been anything else. A page counts only where its
   denominator for that measure is greater than zero: a page with no labelled control for a
   rule is in the corpus but is not an observation of that quantity, and counting it would
   let three contributing pages hide inside forty. The **complete** page set is still
   resampled, because an empty page drawn contributes nothing while still consuming a draw,
   which is what makes a sparse corpus yield a wider interval than a dense one. This is a
   faithful application of section 9's own rule to the unit the method actually resamples,
   not a new restriction, but the reading is the amendment's and is recorded as such.

   A consequence worth stating: once five contributing pages are required, a resample misses
   all of them with probability at most about e^-5, so decision 2's stability rule can
   essentially no longer fire for an estimator that is undefined only on an empty
   denominator. It is retained as a backstop, not as an active filter.
5. **Pages are sorted into a canonical order before resampling.** The generator walks the
   cluster array, so without this the published interval would depend on the order the
   pages happened to be listed in - the same corpus, read from a differently ordered
   directory, would produce a different interval.

**Why.** Section 9 was already in tension with the implementation choice recorded at the
end of it, which states that controls within a page share markup, framework and author and
so their errors are correlated. That reasoning was applied to F1 and not to the other
proportions, although it holds for them identically. A Wilson interval assumes independent
observations; controls pooled across pages are not independent, and the resulting interval
is too narrow.

**Evidence.** The amendment is not justified by argument alone. `evaluation/test/clustered.test.mjs`
simulates 20 pages of 10 controls each, every page carrying its own rate, with a known true
proportion of 0.5, and counts how often each interval covers it. Over **ten independent
simulation seeds of 300 trials each**, a nominal 95% Wilson interval on the pooled counts
covers the true value **54-69% of the time (mean 59%)**; the page-cluster interval covers it
**91-97% (mean 94%)**. The range is quoted rather than a single figure because one seed
would make the published number an accident of that seed. The test asserts against the
**best** Wilson seed and the **worst** clustered seed, so neither can be a lucky draw, and it
fails if the measured range moves outside what is published here.

**What that evidence does and does not establish.** The simulated page rates are drawn from
Beta(1/2, 1/2), a strong-correlation regime close to the worst case for Wilson. It
establishes the direction and the mechanism, not the magnitude to expect on real government
forms, which is unknown and stays unknown until the corpus exists. Under weaker within-page
correlation the gap narrows; under none it vanishes, which is what the converse test
measures: with one observation per page the method does **not** inflate the interval. That
is why retaining Wilson at form level is consistent rather than arbitrary.

**Provenance of the figures.** Every report records the harness that produced it: its
version, its commit, whether the working tree was clean at the time, whether that commit
carries the `harness-v1.1.0` tag, and the analysis constants themselves - interval method
at each level, resample count, seed, quantile convention, both floors and the stability
threshold. The protocol and the analyser tag alone cannot distinguish a figure computed
under `harness-v1.0.6` from one computed under this amendment, and a report that cannot
name its own statistics cannot be checked.

**Status of the frozen instrument.** `evaluation-v1.0.0` is unchanged and remains the tag
at which FormFair itself is run. This amendment touches the **analysis harness only** -
how intervals are computed from the labels - and not the analyser, the rule catalogue, the
sampling frame or any annotation. No result is recomputed, because none exists.
