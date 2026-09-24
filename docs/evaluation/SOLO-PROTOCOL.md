# FormFair Solo Evaluation Protocol

**Version 1.0 - frozen.** Tagged `solo-protocol-v1.0.0`. Dated 22 September 2026 and
frozen on 24 September 2026, before any government form was captured or analysed.

The analyser it governs is frozen as `evaluation-v1.1.0`. Existing catalogue, frame,
draw-order and historical harness tags are not moved, and the draw order remains derived
from the literal seed `evaluation-v1.0.0`.

Amendments to this document follow the same rule as the held-out protocol it supersedes:
the original text stays, and a dated amendment is appended stating what it supersedes and
the precondition under which it was made. This tag is not moved.

## 1. Purpose and claim boundary

This protocol evaluates FormFair without recruiting annotators, an adjudicator, or any
other research participant. It is a software-engineering evaluation with two distinct
parts:

1. a **primary automated technical study** using synthetic constraints fixed before
   real data; and
2. a **secondary descriptive scan** of publicly reachable New Zealand government form
   markup.

The study may claim conformance to the frozen catalogue cases, detection of seeded
faults, satisfaction of metamorphic relations, robustness over the recorded generator,
reproducibility, and measured runtime. It may describe what FormFair reports in the
sampled corpus.

It must not claim human-validated precision, recall, F1, Cohen's kappa, cultural
acceptability, or prevalence of actual defects. A real-form result is always called a
**tool-reported finding**. This limitation is stated beside every real-form table or
figure, not left only to a final limitations section.

## 2. Research questions

- **RQ1 — Catalogue conformance.** Does FormFair detect predeclared, browser-confirmed
  constraint mutations for each of FF-01 to FF-05 while leaving the paired baseline
  clean for the target rule?
- **RQ2 — Robustness.** Does the analyser preserve specified metamorphic relations and
  remain deterministic and crash-free over a seeded mixture of supported, unsupported,
  empty and malformed patterns?
- **RQ3 — Performance.** What median and 95th-percentile runtime is observed as the
  number of controls grows from 10 to 100 to 1,000 on the named reference environment?
- **RQ4 — Practical applicability.** Among the sampled government pages, how many
  supported inputs does FormFair identify as name controls, how often are observable
  constraints present, and what findings, declines, advisories and delegated findings
  does the frozen tool report?

RQ4 is descriptive tool output. It is not a defect-prevalence question.

## 3. Frozen artefacts and sequencing

The order is mandatory:

1. Resolve the FF-02 catalogue/implementation conflict and pass all tests. **Done, 23
   September 2026.** The corrected gate and the decision trail are recorded in
   [`OPEN-CONFLICT-FF-02.md`](OPEN-CONFLICT-FF-02.md).
2. Freeze the analyser as `evaluation-v1.1.0` and record its commit and lockfile hash.
   **Done, 23 September 2026**, at commit `ef58ad3`.
3. Freeze this protocol and the files under `evaluation/solo/` as
   `solo-protocol-v1.0.0`. **Done, 24 September 2026.**
4. Preserve the existing `frame-v1.0.0` frame and `draw-order.csv` byte for byte.
5. Only then visit and capture candidate forms.
6. Build the content-hash corpus manifest, commit it, and freeze that commit as
   `corpus-v1.0.0` before any FormFair output is seen.
7. Run the frozen analyser from a separate `evaluation-v1.1.0` checkout and preserve
   the unmodified JSON output.

The draw order is intentionally still derived from the literal seed
`evaluation-v1.0.0`. Replacing that seed with the new analyser tag would reroll the
sample and is prohibited. The historical human-annotation harness and its tags remain
available as an audit trail but do not produce figures for this design.

An official command refuses an untagged or dirty analyser checkout. `--development` is
available only with synthetic material and therefore cannot produce a real-form report.

## 4. Technical benchmark

### 4.1 Seeded constraint mutations

`evaluation/solo/cases.mjs` contains five mutation families for each catalogue rule,
25 in total. Each record contains:

- a target-rule-clean baseline;
- a single mutated constraint intended to expose the target risk;
- the target rule;
- an independently executable acceptance and rejection example, evaluated using the
  JavaScript `v`-flag regular-expression semantics used by HTML `pattern`, plus HTML
  length semantics where relevant.

A mutant counts as passed only if the browser-semantic check confirms the described
accept/reject behaviour, the baseline has no target-rule finding, and FormFair reports
the target rule on the mutant. Report results per rule and overall as a **seeded-fault
detection score**. Never rename this figure accuracy, sensitivity, recall or mutation
adequacy over an external fault population: the faults were authored for this study.

### 4.2 Metamorphic testing

The following relations are fixed before the official run:

- neutral wrapper markup does not change catalogue outcomes;
- an unrelated email input does not change the name control's outcomes;
- adding `required` does not change any FF rule;
- redundant pattern anchors do not change outcomes; and
- attribute order does not change outcomes.

The source and follow-up outputs are reduced to controls, findings, declines and
advisories before comparison so changed source coordinates cannot create a false failure.

### 4.3 Seeded robustness and determinism

Run 1,000 cases with seed `formfair-solo-v1.0.0`. The generator crosses five independent
name-identification signals with absent, empty, supported, unsupported and malformed
patterns and varied length limits. Every case is analysed twice. Success requires:

- no uncaught exception;
- byte-identical result objects across the two runs;
- one detected control; and
- no more than one outcome per rule.

Declines are expected and counted. They demonstrate bounded analysis rather than test
failure. Generated cases are not a sample of real web practice.

### 4.4 Performance

After three warm-up runs, measure 15 runs each at 10, 100 and 1,000 controls. Report the
runtime, Node version, operating system and hardware, with median, p95, minimum and
maximum. Timing is descriptive and is not a CI gate because shared CI hardware is not a
stable performance environment. The engineering objective, fixed before the official
run, is a median below two seconds for 1,000 controls on the named development machine.

## 5. Real-world descriptive scan

Sampling sections 1 to 3 of `PROTOCOL.md` remain in force: the existing 45-agency CWAC
frame, frozen agency order, one page per agency, category priority, eligibility criteria,
alphabetically first canonical URL tie-break, target of 40, and honest shortfall.

The fixed 1280 x 800 capture method and full rendered `outerHTML` boundary remain in
force. Scripts may run only during normal page loading; stored markup is later parsed
without executing page scripts. Cross-origin frames and closed shadow roots that cannot
be captured are excluded with a logged reason, never analysed as though empty.

The selection ledger records every attempted agency and URL, including exclusions. The
corpus manifest binds by SHA-256:

- frozen frame and draw-order hashes;
- selection ledger;
- page metadata;
- every captured HTML file; and
- the intended analyser tag.

A hash file does not prove its own timing. The manifest must therefore be committed and
tagged `corpus-v1.0.0` before analysis. The official descriptive command refuses an
untracked, modified or differently tagged manifest and separately verifies the analyser
commit and lockfile named inside it.

The descriptive report publishes hashes and aggregates, not captured third-party markup
or input snippets. Captured HTML stays private and outside version control under the
retention plan.

## 6. Descriptive measures

Report raw counts and explicitly named ratios only:

- supported text/search inputs;
- tool-detected name controls;
- detected controls carrying `pattern`, `minlength`, `maxlength`, or any of them;
- controls and pages carrying at least one tool-reported finding;
- findings and declines by FF rule;
- advisories by code; and
- delegated axe-core findings, labelled `scored: false`.

Permitted ratios include the tool-detected share of supported inputs, declared-constraint
share of tool-detected controls, and tool-reported-finding share of detected controls.
They describe the frozen tool's behaviour on this corpus. Do not calculate confidence
intervals for actual-defect prevalence, because no independent defect labels exist.

## 7. Acceptance criteria

The primary technical study succeeds only when:

- all 25 browser-semantic mutation checks pass;
- all 25 target mutants are detected and all paired baselines are target-rule clean;
- all five metamorphic relations pass;
- all 1,000 seeded robustness cases complete deterministically without a crash;
- the package test, delegated test, typecheck, build, package-consumer and audit gates
  pass on their stated Node versions; and
- every official report names a clean analyser checkout carrying
  `evaluation-v1.1.0`.

A failure is reported and investigated; cases or thresholds are not deleted after the
result is known. RQ4 may still report few or no constrained controls. That is an
applicability result, not a reason to widen the sample or invent an accuracy figure.

## 8. Threats to validity

- **Construct validity:** the developer authored the catalogue and mutants. Executable
  browser checks establish that each mutation changes acceptance as described, but do
  not make the benchmark independent human ground truth.
- **External validity:** synthetic constraints cannot represent all frameworks, dynamic
  validation or server-side behaviour. The descriptive corpus supplies real-markup
  evidence but no confirmed labels.
- **Stage-one validity:** tool-detected name controls are heuristic. Without human labels,
  false positives and false negatives are unknown; every RQ4 denominator names this
  limitation.
- **Sampling validity:** the frame covers websites participating in one CWAC programme,
  not all New Zealand government services. Eligibility shortfall is reported without
  replacement outside the frame.
- **Researcher bias:** cases, seeds, relations, success criteria and code are frozen
  before real pages are opened; failures and declines remain in the output.
- **Reproducibility:** published code, synthetic fixtures, seeds, hashes, exact tags and
  machine-readable reports permit the technical study to be repeated. Third-party HTML
  cannot be published and is represented by hashes and provenance.

## 9. Human participation and governance

No person is recruited, observed, interviewed, surveyed, trained as an annotator, or
asked to supply personal information. The study analyses synthetic inputs and publicly
reachable page markup. This removes the participant-dependent method; it does not by
itself constitute an institutional ethics determination. The previously submitted
project paperwork should be amended or withdrawn as Yoobee directs so that the recorded
method matches the work actually performed.

## Amendment 1: the capture harness

**Dated 24 September 2026, before the first held-out page was visited.** This tag,
`solo-protocol-v1.0.0`, is not moved.

Step 5 of the mandatory sequence assumed a tool that did not exist. The corpus draft
template expected provenance fields and captured markup to appear from somewhere, and
nothing produced them, so capture was blocked on tooling rather than on any decision.

`capture/` now holds that tool. It was written after this protocol was frozen and is
therefore outside that freeze, which is recorded here rather than left to be discovered.
It is frozen separately as `capture-v1.0.0` before the first held-out visit, with its
lockfile hash, Playwright version, Chromium version and politeness policy in that tag.

**It produces no FormFair output.** The analyser is never imported by it, and a CI step
fails the build if it ever is. That property is what makes its position outside this
freeze acceptable: it retrieves pages and records provenance, and every figure still comes
from `evaluation-v1.1.0` run against a corpus sealed before any output is seen.

**What it enforces rather than leaves to memory.** A fresh browser context with no stored
state, never a persistent profile. The fixed 1280 x 800 viewport. A fixed two-second
settling period after load, recorded in provenance, because capturing the instant `load`
fires misses constraints a framework applies a tick later, and a variable wait would make
two runs of the same page incomparable. No code path types text or clicks a submit
control, and a test asserts from the captured markup itself that no submit, input or
keydown event occurred during capture.

**Politeness policy**, which this protocol did not previously state and which is now part
of the artefact: one capture at a time; at least five seconds between top-level
navigations; `robots.txt` honoured, with a disallowed path recorded as excluded and never
fetched; a 429 stops the run and `Retry-After` is respected; one retry for a transient
failure, then the attempt is recorded as failed; authentication, CAPTCHA, blocking and
consent controls never bypassed, and a page behind one excluded under this protocol's
first eligibility criterion; the normal Chromium user agent, unmodified and recorded
exactly, because a custom agent could change what the server returns and would make the
sample less representative of what a member of the public receives.

**Eligibility and approval.** The harness proposes an assessment against the five frozen
criteria and records the evidence for an inclusion, not only a reason for an exclusion.
Every attempt starts at `approval: pending`, and the corpus draft is withheld while
anything is pending, so the corpus cannot be built on judgements the researcher has not
confirmed. This remains a solo study: the approval is the researcher's, and no outside
annotator is involved.

**Ledger and draft cannot disagree.** `capture-log.json` is the single append-only record,
and both the selection ledger and the corpus draft are derived from it. Neither is written
by hand, so a captured page cannot be missing from the ledger and a ledger row cannot name
a page the draft does not contain.

## Amendment 2: the bounded search rule

**Dated 24 September 2026. Precondition: no held-out page has been visited or captured.**
`solo-protocol-v1.0.0` and `capture-v1.0.0` are not moved. Frozen separately as
`selection-v1.0.0`.

Section 3 of the held-out protocol fixes which agency is attempted and in what order, and
which categories are preferred. It does not fix **how hard to look inside one agency**, and
that decides the achieved sample as much as the draw order does. Deciding effort agency by
agency would make "attempted" mean something different each time and invite exactly the
selection-bias question the frozen draw order exists to answer. The bound is therefore
fixed here, before the first agency.

### The rule

1. Agencies are processed only in the frozen draw order.
2. Categories are searched in the frozen priority order: account registration, service
   application, enquiry or contact, subscription or newsletter.
3. For each category, candidate URLs are gathered from normal navigation, the linked
   sitemap or `/sitemap.xml`, and the first page of the agency's own internal search
   results for that category's terms.
4. The ten frozen terms, by category:

   | Category | Terms |
   |---|---|
   | Account registration | `register`, `sign up` |
   | Service application | `apply`, `application`, `tono` |
   | Enquiry or contact | `contact`, `enquiry`, `whakapā` |
   | Subscription or newsletter | `subscribe`, `newsletter` |

5. **No external search engine.** Where an agency has no internal search, that is recorded
   as unavailable rather than substituted, because a third-party index would introduce a
   ranking this study does not control.
6. Discovered URLs are canonicalised, deduplicated and sorted alphabetically.
7. At most **five candidate form URLs per category** are examined.
8. All five are examined - or all available, if fewer - before one is chosen.
9. If the category yields an eligible form, the alphabetically first eligible canonical URL
   is selected and the search of that agency stops.
10. Otherwise the next category is searched.
11. Maximum effort is therefore **twenty candidate form pages per agency**.
12. If none qualifies, the agency is recorded as
    `effort bound exhausted — no eligible form located`.
13. The scan stops when 40 agencies have qualified or all 45 have been attempted.

### Canonicalisation

The page's own `<link rel="canonical">` is used when it resolves to an http or https URL;
otherwise the final URL after redirects. Fragments are removed, scheme and hostname are
lowercased, and a default port is removed. **Query parameters are kept**, because a
government form is routinely identified by one and dropping them would silently merge two
distinct forms into a single candidate. The path's case is preserved, because paths are
case-sensitive on many servers.

### Discovery pages

Any navigation page, sitemap or search results page actually inspected is recorded in the
log as a discovery page with how it was found. Discovery pages do **not** consume the
effort bound: they are inspected to find candidates and are not themselves forms being
assessed. Counting them would let a thorough search exhaust its bound before assessing a
single form. Recording them is what makes the search auditable rather than only its
outcome.

### Approval

Eligibility is proposed against the five frozen criteria with the evidence for an
inclusion, and the researcher approves or rejects every decision, including exclusions and
agencies recorded as exhausted. The corpus draft is withheld while anything is pending. No
outside annotator is involved; this remains a solo study.

### Limitation

The bounded search may miss an eligible form that exists outside the discovered candidate
set - one reachable only by a path the three discovery methods did not surface, or ranked
below the fifth candidate in its category. The achieved sample is therefore a sample of
what this procedure finds, not of every form an agency publishes, and it is reported that
way. A larger bound would reduce that risk and would also make the effort per agency less
comparable; the bound is fixed rather than tuned, because tuning it after seeing results is
the failure this amendment exists to prevent.

### A form linked by two agencies

The same third-party form may legitimately be linked by more than one agency, and refusing
to record it for the second would hide that the second agency genuinely links it. So:

- the same URL **may** be recorded separately for different agencies;
- if its canonical URL was already **selected** for an earlier agency, it is recorded for
  the later one as `duplicate shared form` and the search of that agency continues;
- the same canonical page never enters the corpus twice.

This keeps the evidence that the later agency links it, without counting one page of markup
as two observations.

### The locked candidate set

Discovery and assessment are separate steps, and the order between them is binding:

1. discovered candidate URLs are recorded for the agency and category;
2. discovery for that category is **closed**;
3. the recorded URLs are canonicalised, deduplicated and sorted;
4. the first five are **locked**;
5. only a URL in the locked set may be assessed;
6. the category is settled only once every locked candidate has an outcome.

Locking is what makes the ordering rule operational rather than documented. Once a set is
locked it cannot grow, so a candidate cannot be added after an earlier one has already
produced an outcome - which is the route by which a search could otherwise be extended
until it found something.

### What is enforced, and what is not

Enforced by `capture/`, and covered by tests written from attacks that worked:

- every candidate carries a category, because one without escaped its category's limit and
  allowed ten candidates from a single real category;
- five per category and twenty per agency, refused with an error naming the limit;
- only a locked candidate may be assessed, and a locked set cannot grow;
- a category is settled only when every locked candidate has an outcome;
- the agency and category to work on next are **derived from the frozen draw order and the
  log**, never supplied by the operator;
- the scan stops once forty agencies have qualified;
- at most one approved page per agency, at most forty in total, every agency present in the
  frozen frame, and the selected page drawn from the first category that yielded an
  eligible result;
- the same canonical page cannot be captured twice.

**Not enforced, and procedural by nature.** No code can confirm that a sitemap was actually
read, that an internal search was actually run, or that a link which looked like a contact
form was correctly judged a candidate. Those steps are recorded as discovery pages with the
method that found them, and the record is auditable, but the judgement is the researcher's
and is approved as such. The discovered candidate set is therefore the part of this
procedure that rests on judgement rather than on code, and the limitation above applies to
it directly.

## Amendment 3: the approval state machine

**Dated 24 September 2026. Precondition: no held-out page has been visited or captured.**
`solo-protocol-v1.0.0`, `capture-v1.0.0` and `selection-v1.0.0` are not moved. Frozen as
`selection-v1.0.1`.

Amendment 2 made the selection rule enforceable. A further review found that its approval
states were still walkable, in five ways, each of which would have let the scan proceed on
something nobody had confirmed.

**The candidate set is approved before anything in it is assessed.** Amendment 2 said the
discovered candidate set is where judgement sits and no code can check it; it then left
that judgement unreviewed, approving only the verdicts on candidates. A locked set is now
`pending` until the researcher approves it, assessment of an unapproved or rejected set is
refused, and a rejected set means discovery for that category is redone.

**Only an approved capture qualifies an agency.** Qualification counted anything not
rejected, so forty captures still awaiting review would have ended the scan - the exact
opposite of what the approval gate exists for.

**Work does not advance past an unresolved outcome.** A pending or rejected outcome blocks
the next candidate, the next category and the next agency for that agency, rather than
being stepped over.

**A rejected decision is corrected, not erased.** The correction is a new attempt that
explicitly supersedes the rejected one, and the original stays in the log with its
rejection. A correction that erases what it corrected is not a correction, and the ledger
has to show what was decided first.

**Discovery pacing is recorded and checked.** Discovery browsing is not performed by the
capture harness, so the pacer cannot pace it. Every top-level discovery page now carries
its navigation timestamp, the gap from the previous navigation is checked against the
five-second minimum, and the measured gap is stored on the record. A run that went too fast
is visible rather than merely promised. This closes a gap in `capture-v1.0.0`, whose
politeness policy reads as covering the whole scan while only the capture step was paced.

All five are covered by tests written from the defect that found them. The capture package
has 54 tests.

## Amendment 4: the discovery pilot, and what it found

**Dated 24 September 2026. Precondition: one agency's discovery was performed; nothing was
assessed, captured or analysed, and no held-out markup exists.** `solo-protocol-v1.0.0`,
`capture-v1.0.0`, `selection-v1.0.0` and `selection-v1.0.1` are not moved.

### What the pilot did

Discovery was run for Te Puni Kōkiri, the first agency in the frozen draw order, for the
first category in the frozen priority order (account registration). All four of the
agency's websites in the frame were searched. Seven discovery pages were recorded, each
with its method and navigation timestamp, paced at or above the five-second minimum.

One candidate was found: a "Create new account" link on Te Haeata leading to
`/user/register`. The set was locked and the tool stopped at the approval gate. **Nothing
was assessed, captured, analysed, or run through FormFair.** No held-out markup exists.

Two observations, recorded because they are results rather than incidents:
`www.tpk.govt.nz` serves a 404 page for both `robots.txt` and `sitemap.xml`, so it has
neither; and `www.tkm.govt.nz` disallows `/search` in its `robots.txt`, so internal search
is unavailable there and was recorded as such rather than substituted.

### Why the first candidate set was rejected

The discovery provenance was incomplete. Seven pages were recorded, but **four further
inspections were not**: `robots.txt` on three hosts and `sitemap.xml` on one. Those
inspections determined whether a discovery method was available at all - the sitemap and
search findings above rest on them - so omitting them left the record unable to show how
the candidate set was arrived at.

The set is preserved as rejected, and discovery for that category is redone under a new
version. A redo that erased the attempt it replaced would hide exactly what the ledger
exists to show.

### Changes this amendment makes

**A rejected candidate set is superseded, not edited.** Recording new candidates onto a
rejected set is refused. Superseding archives it with its rejection, its note and a stated
reason, and opens the next version. The version number is part of the published record.

**A corpus draft is not built without real frame hashes.** The first draft was written with
`frameSha256: null` because the hashes were not supplied. The seal would have refused it,
but writing it at all invites it being read as a real artefact.

**Provenance is published separately from the data.** `evaluation/data/` is ignored by Git,
correctly, because it holds captured third-party markup. The selection ledger was inside
it, which would have left the audit trail unpublishable. A `publish` command now writes a
tracked copy - the ledger and a provenance summary - containing no markup, and a test
asserts that nothing published contains any.

**Every inspection counts as a discovery page**, including a `robots.txt` or a `sitemap.xml`
that turns out not to exist. A method found unavailable is a finding about the agency, and
the absence has to be as visible as the presence.

## Amendment 5: discovery rounds are identifiable, and bound to what they produced

**Dated 24 September 2026. Precondition: three discovery rounds have been performed for one
agency and one category. Nothing has been assessed, captured or analysed, no FormFair
output exists, and no held-out markup exists.** `solo-protocol-v1.0.0`, `capture-v1.0.0`,
`capture-v1.0.1`, `selection-v1.0.0`, `selection-v1.0.1` and `selection-v1.0.2` are not
moved.

### What went wrong

Amendment 4 rejected the first candidate set for incomplete discovery provenance and
required a redo. The redo was not a separate round. It was the first round's records plus
eight additions, because a discovery record carried no category, no set version and no
stable identifier, so nothing distinguished round two from round one. A reader could see
that inspections happened and that a set existed, but not that the one produced the other.

Three further defects were found at the same time. A robots.txt fetch was filed under the
`sitemap` method, so the published method counts described inspections that never happened.
The fixes for the previous amendment were tagged before they had tests, so `capture-v1.0.1`
and `selection-v1.0.2` point at a commit that does not contain the code that produced the
second round. And the invalid corpus draft carrying null hashes was still sitting beside
the real artefacts.

### What changes

**A discovery record identifies its round.** It carries the category it served, the
candidate-set version it supports, a stable identifier, the method used and the outcome
established. All five are required.

**`robots` is a method of its own**, alongside navigation, sitemap and internal search.

**An outcome is recorded**: `candidates-found`, `no-candidates`, `unavailable` or
`disallowed`. A method that does not exist, or that robots.txt forbids, is a finding about
the agency and has to be as visible as one that produced candidates.

**A locked set is bound to the records that support it.** Locking without a discovery round
for that agency, category and version is refused, and the set records the identifiers and
methods that produced it.

**A later round may re-inspect the same page.** Refusing that is what made an independent
round impossible: a new round could only ever be additions to the first.

**The published counts describe what happened** — by method, by outcome, by round — and
pending candidate *sets* are counted, not only pending attempts. A pending set is what
blocks the work, and it was not counted at all.

**The invalid draft is quarantined**, not deleted, with the reason recorded beside it.

### The record as it stands

Rounds one and two are preserved as rejected, with their reasons. Their fifteen discovery
records are retained unchanged and appear in the published provenance as unattributed, with
no outcome — which is what they are. Rewriting them to look like a proper round would
falsify the thing this protocol exists to protect.

Round three is a complete run: fifteen inspections across the agency's four websites, each
attributed to its category, version, method and outcome, and bound to the locked set. It is
locked and pending approval. Nothing has been assessed or captured.

