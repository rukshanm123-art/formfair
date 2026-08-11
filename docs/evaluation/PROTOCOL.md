# FormFair Held-Out Evaluation Protocol

**Version 1.0 — frozen.** Tagged `protocol-v1.0.0`. Frozen before any government form was
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
CWAC programme"** — not all New Zealand websites, and not all government forms.

**Expected shortfall.** The CWAC agency leaderboard lists approximately 47 participating
agencies, so 40 eligible forms may not be reachable. That is accepted in advance. Attempt
all agencies in the frozen order and report the achieved sample honestly. The frame is
**not** widened afterwards to reach 40.

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
- be normal HTML or a browser-rendered web application — not a PDF or native application.

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

- **Development and annotator-training set** — the synthetic fixtures and mutation cases
  that existed when `evaluation-v1.0.0` was tagged.
- **Held-out set** — every newly captured real CWAC form page.

There is no natural-form development subset, because the instrument is already frozen.
This is a pre-data clarification of the proposal's "development and held-out" wording.

The capture harness and the annotation interface are **built and tested only with
synthetic pages**. FormFair is not run on a held-out page until annotation and
adjudication are complete and sealed (section 10).

## 5. Capturing a page

A new browser profile with no account, saved data or personal information. One fixed
medium viewport of **1280 × 800**, matching CWAC's documented medium viewport.

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

- at least 20 stage-one decisions — 10 personal-name and 10 non-name controls;
- at least 20 decisions for each FF rule — 10 positive and 10 negative.

Required Cohen's kappa is **at least 0.70** for stage one and for each individual rule.
Below 0.70 in any category: clarify the codebook and repeat with fresh synthetic cases.
Held-out pages are never used for training.

> **Gate.** Before annotators are recruited, obtain written confirmation from the
> supervisor that they are research-team members or are covered by the ethics approval.
> Someone recruited informally from class is not assumed to sit outside the
> human-participant process.

## 7. Annotation units

### Stage one

Annotate **every** `<input>` whose `type` is missing, empty, `text` or `search` — the only
controls FormFair's frozen stage one considers.

A **positive** control collects a natural person's name, name component, nickname,
preferred name, or an HTML name component such as given name, family name or honorific.
**Excluded**: usernames, organisation names, business names, product names, pet names,
street names, search boxes, display names.

Annotating only the controls FormFair detects is **prohibited** — it would hide stage-one
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

Compute held-out Cohen's kappa for stage one, every rule, and the pooled rule pairs. Also
report percentage agreement and label counts. Where kappa cannot be computed because both
annotators used a single category, report **"not estimable"**.

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
