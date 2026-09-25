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

> **Deviation, 25 September 2026.** This clause was breached during the third agency's first
> discovery round, and the breach is recorded here beside the rule rather than only in an
> amendment. `www.health.govt.nz/robots.txt` disallows `/search?`, and four internal-search URLs
> on that host were fetched: `?query=register` and `?query=sign%20up`, which were recorded, and an
> earlier `?keywords=` pair fetched during a wrong-parameter attempt and never recorded. Six
> requests were made across those four URLs, in the browser and again by the recording script.
>
> The cause was structural, not a lapse of attention: `robots.txt` was enforced only inside the
> `capture` command, while discovery browsing relied on the operator to remember. A policy
> enforced in one command and trusted in another is not enforced. From `selection-v1.0.10` the
> `discovery` command fetches and checks `robots.txt` itself and refuses to record any outcome
> other than `disallowed` for a forbidden path, because a substantive outcome asserts the page was
> retrieved.
>
> Round 1 is preserved in full, rejected, with its reason and its observed results intact — those
> two search result counts are excluded from round 2's evidence, and round 2 records internal
> search on that host as `disallowed`, not performed. They cannot be unseen, and this note is the
> disclosure rather than a claim that they were discarded. The Ministry search endpoints are not
> accessed again.

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


## Amendment 6: a page is not its analytics

**Dated 24 September 2026. Precondition: one candidate had been approved for assessment and
the capture failed. No page has been captured and no markup has been analysed.**
`solo-protocol-v1.0.0`, `capture-v1.0.0` through `capture-v1.0.2`, and `selection-v1.0.0`
through `selection-v1.0.3` are not moved.

### What happened

The first candidate the pilot approved — the Te Kāhui Māngai contact form, the only page in
Te Puni Kōkiri's four websites that asks a natural person for a name — could not be
captured. Both the attempt and its single permitted retry ended as a navigation timeout
after forty-five seconds, and the failure was recorded.

The page was not slow. Its document returned HTTP 200 in 373 milliseconds, with both
personal-name inputs present in the markup. One third-party request, to a Matomo analytics
script on a different host, never completed. Because the harness treated the `load` event
as a precondition of navigation, and `load` waits for every outstanding subresource, an
analytics script on a host the study is not measuring was able to veto the capture of a
page the study exists to measure.

### Why this had to be fixed rather than worked around

The obvious workaround — capture the page by hand, or exclude it — would have been worse
than the defect. A prevalence estimate is only as good as the reasons pages leave the
denominator, and "the agency's analytics vendor was slow on the afternoon we visited" is
not a property of the agency, the form, or the constraint being measured. Left alone, this
would drop pages non-randomly, and it would drop them in a direction: sites carrying more
third-party tracking would be under-represented, and nothing in the published figures would
say so. It also could not be detected after the fact, because a dropped page leaves behind
a timeout, not a form.

### The change

**Navigation waits for `domcontentloaded`; the `load` event is then waited for separately,
within its own fifteen-second budget.** A page that reaches `load` is captured at exactly
the point the previous harness would have captured it — the two paths converge, and no page
that succeeded before behaves differently now. The fifteen seconds is frozen at
`capture-v1.0.3` and is not exposed as a command-line flag: it is injectable only so that
the fallback can be exercised in a test in one second rather than in fifteen, and every
real capture uses the constant.

**A page that does not reach `load` is captured anyway, and says so.** Its provenance record
carries `loadState: "domcontentloaded"` instead of `"load"`, and `outstandingRequests`
naming what was still in flight when the budget expired. The fixed post-load settling
period is unchanged and applies in both cases.

**Only a timeout is a deviation.** Any other failure of the load wait — a closed page, a
crashed target, a navigation away mid-wait — means the capture did not happen, and stays a
failure. A fallback that swallowed every error would have converted an unknown document
into a successful capture, which is a worse defect than the one it was written to fix.

**An outstanding request is recorded as origin and pathname, and nothing else.** Query
strings and fragments are removed. The field exists to name the host and resource that held
the load event open, which origin and path answer completely; an analytics beacon's query
string is generated per visit and routinely carries a session or client identifier, a
cache-buster, and the URL of the page being viewed. Provenance is published, so anything
left in that field would be published with it.

**`loadState` and `outstandingRequests` reach the corpus draft**, not merely the log. A
field that stopped at the log would leave two captures of the same page, taken in different
load states, indistinguishable in the sealed corpus — and the reproducibility the seal
exists to support would be asserted rather than true.

### What it costs

The change does not raise the worst case; it raises the worst case for a capture that
*succeeds*.

| | before | after |
| --- | --- | --- |
| page reaches `load` | up to 45 + 2 s | unchanged |
| page reaches `domcontentloaded` but never `load` | failed after ~90 s (two attempts) | captured after up to 45 + 15 + 2 ≈ 62 s |
| page never reaches `domcontentloaded` | failed after ~90 s (two attempts) | unchanged |

The retry allowance is what makes both failure rows ~90 seconds rather than 45: a failed
navigation is attempted twice, plus the pacing delay between them. The previous harness
therefore already spent about ninety seconds on the Te Kāhui Māngai contact form before
recording nothing. The new path spends at most about sixty-two and records a page.

### Correcting the rejected failure

The failed attempt stays in the log as a failure, with its reason. It is corrected, not
erased, and the correction names the decision it replaces rather than the page:

**`supersedesAttemptId` replaces `supersedes: <url>`.** Superseding by URL was unambiguous
only while one attempt per URL could exist. Once a page can be attempted, rejected and
re-attempted, a URL names two records and a third attempt would appear to supersede both of
the first two. The earlier form is still honoured so that corrections already in the log
keep their meaning.

**`approve` takes `--id`, and refuses `--url` once a URL has more than one attempt.**
Resolving `--url` with a first-match search returned the *rejected* attempt, so approving a
rerun would silently have re-approved the failure it was meant to replace. The refusal
names the candidate ids rather than merely blocking.

### What this does not change

No page is captured that would previously have been rejected on eligibility, robots, or
blocking grounds; the politeness policy, the viewport, the locale, the settling period, the
retry allowance and the no-input rule are untouched. The replacement attempt may validly
record either `load` or the fallback, depending on whether the tracker responds on the day
— which is itself the reason the field is recorded per page rather than assumed.

Nineteen tests hold the change, written from the defect and from the review that followed
it: a page that reaches `load` records `load` and nothing outstanding; a page whose load
event never fires is still captured with its markup intact; the stalling requests are named,
sanitised to origin and path, with query and fragment removed; the deviation survives
capture, log, draft and the hash the seal takes of it; a stalled capture is bounded *below*
by its load budget — without which shortening the wait to nothing would still pass — and
above by well under the navigation budget; a non-timeout load error stays a failure and
leaves no partial capture; six tests cover supersession by id, including the case that
found a hole in the first draft of it, where an id naming a different page was accepted in
silence; and four cover approval by id, including that approval by URL still works while a
URL has exactly one attempt. The fixtures stall an image and an async script deliberately — a render-blocking
script in `<head>` would stall `domcontentloaded` as well, which is a different failure with
a different remedy. The capture package has 99 tests.

## Amendment 7: a round that found nothing is a finding

**Dated 24 September 2026. Precondition: one page is captured and approved; the second
agency's first category had been searched and found nothing, and could not be recorded as
such.** No existing capture or selection tag is moved.

### What happened

The second agency in the frozen order, the Family Violence and Sexual Violence Executive
Board, publishes no account registration anywhere on its single website: robots disallows
the CMS login, no sitemap is published, both frozen search terms return only prose and PDF
filenames, and none of the forty-five links on the home page matches register, sign up,
join, member, account, portal or login. The round was complete and its result was nil.

That result could not be recorded. `candidates` required `--add`, and `lock` refused a set
that did not exist with "no candidates recorded" — which reads as though the discovery was
never done. The only way through was `candidates --add ""`, which worked by accident: the
empty string was filtered out of the URL list and left an empty set behind as a side
effect.

### Why it matters more than it looks

Most agencies will publish no form at all in most categories. A nil result is therefore not
an edge case but the commonest thing the scan produces, and it is evidence: the prevalence
denominator is agencies searched, not agencies that happened to have a form. An interface
in which the ordinary finding is unsayable pushes the operator toward either the
empty-string trick or, worse, skipping the record altogether — and a skipped category is
indistinguishable from one that was never reached.

It also could not be told apart after the fact. A set created by `--add ""` and a set
created by a mistyped URL that normalised away are byte-identical in the log.

### The change

**`candidates --none` records an explicitly empty set**, which locks, carries its
`discoveryRecordIds` like any other, and is approved by the researcher exactly as a set
with candidates is. An empty set is still bound to the round that produced it: a nil finding
has to be evidenced too.

**`--add` with no usable URL is now refused** and names `--none` in the refusal, so the
accidental path is closed rather than left as a second way to do the same thing. `--none`
and `--add` together are refused, as are neither.

Five tests hold it, including that the empty-string path no longer creates a set as a side
effect. The capture package has 104 tests.

### The safeguard was incomplete, and what closed it

Recording the nil result was necessary but not sufficient. Review reproduced three states
that locked cleanly under the first version of this amendment, and each of them falsifies
the prevalence data rather than merely looking untidy:

- **Discovery reported `candidates-found`, and an empty set still locked.** The published
  figure would say the agency publishes no such form, while the agency's own discovery
  record says an inspection found one.
- **Discovery reported only `no-candidates`, and a non-empty set still locked.** The
  reverse: a candidate enters the corpus that no inspection records finding, so it has no
  provenance at all.
- **An empty set built straight from the library locked without any declaration.**
  `--none` set `urls: []` and stored nothing, so the CLI's declaration existed only for the
  length of the process. Binding a set to its round proved a round had happened; it did not
  check that the round *says* what the set claims.

**The declaration is now stored.** A set carries `candidateDeclaration: "none"` and
`declaredAt`. An empty array is no longer read as a nil finding, because an empty array is
also what a set nobody populated looks like, and those are opposite findings.

**Locking enforces agreement between the set and its round.** An empty set requires an
explicit nil declaration *and* no supporting `candidates-found` record. A non-empty set
requires at least one. A refusal names the contradicting record ids rather than only
objecting, because the operator has to know which of the two to correct — the discovery
outcome or the candidate list.

**The rule lives in the library, not the CLI.** The CLI is not the only caller, so an
undeclared empty set is refused at `lockCandidateSet`, whatever built it. Declaring nil on a
set that is already locked, empty and unapproved is permitted and changes no membership —
the guards refuse it the moment anything has been discovered — which is how a set locked
empty before declarations existed records the declaration that was in fact made. Declaring
nil on a locked non-empty set, or on an approved set, is refused.

Sixteen further tests hold this, including all three reproduced contradictions, direct
library creation of an undeclared empty set, and the four ways a declaration can conflict
with a candidate list. Three earlier tests were corrected rather than the rule relaxed: they
had recorded a candidate against a `no-candidates` round, which is now exactly what is
forbidden. The capture package has 120 tests.

### Correction, dated 25 September 2026: the gate was in the wrong place

`selection-v1.0.4` put the consistency rule inside `lockCandidateSet`. Review then
reproduced an attack that walked straight past it:

1. Begin with a set locked empty before the rule existed.
2. Its bound discovery record reports `candidates-found`.
3. Attach the retrospective nil declaration.
4. Approve it.

The result was **APPROVED**, with the set claiming no form for an agency whose own bound
evidence said an inspection found one. Nothing was tampered with and no file was hand-edited;
the attack simply used a code path that did not pass through the lock. Approval had never
revalidated anything, because the rule had been written as a property of one function rather
than of the data.

**The rule is now one shared validator, `assertSetAgreesWithRound`, called from three
places**: the lock, the retrospective declaration, and — decisively — `approveCandidateSet`.
It resolves the records a set is *bound to* rather than merely the records of its round,
because the binding is the claim being made, and rechecks the round's outcomes against the
set's membership and declaration.

**Rejection is deliberately not gated.** A set whose evidence contradicts itself is precisely
the kind that must remain rejectable; refusing to record the rejection would leave the
contradiction in the log with no way to resolve it.

The general lesson, which outlives this defect: validating where a value is *written* is not
the same as validating where it is *trusted*. The last gate before a set becomes evidence is
the one that has to hold, and it must hold against states no current code path can produce,
because logs already on disk contain them.

Six further tests, the first of which is the four-step attack above, run end to end and
asserting that nothing is approved on the way out. They also cover a legacy empty set never
declared at all, a locked non-empty set with no `candidates-found` record, that a
contradictory set can still be rejected, that a *consistent* legacy set still approves with
its disclosed later `declaredAt`, and that revalidation follows the binding rather than the
round. The capture package has 126 tests.

**Agency 2's records are consistent** — five inspections, none reporting `candidates-found` —
so the nil result stands and no further discovery round is needed. Its `declaredAt` of
25 September is later than its `lockedAt` of 24 September, and that gap is disclosed here
rather than smoothed over: the declaration was made when the set was locked, and the tooling
of the day failed to persist it.

### Correction, dated 25 September 2026: the binding itself had to be sound

Revalidating at the approval gate was necessary, but `selection-v1.0.5` trusted
`discoveryRecordIds` as a given. The resolver mapped ids to records and discarded whatever
failed to resolve, which meant:

- **a set bound entirely to ids that do not exist validated cleanly**, because it then had no
  contradicting evidence — true only in the sense that it had no evidence at all;
- **a set bound to another agency's record was validated against that agency's inspections.**

Both reached **APPROVED**. Probing the same surface found five more of the same family, and
all seven are now refused: a foreign category, a foreign round, the same id bound twice, a
candidate attempt bound as though it were an inspection, and a locked set with an empty
binding.

The last of those was the most dangerous, because it was not a lenient resolution but a
deliberate fallback: a locked set naming no records was judged against *every* record for its
round, so an unbound set looked exactly as well evidenced as a bound one.

**The binding is now verified before it is used.** Every bound id must exist; ids must be
unique; every record must be a `discovery` record and must match the set's own agency,
category and version; and a locked set must name at least one record, with no fallback to
general round records. A locked set stands on its binding and on nothing else.

The shape of this defect is worth stating plainly, because it is the same one twice over: a
check that resolves references leniently is not a check, since the lenient path is precisely
the one an inconsistent record takes. `.filter(Boolean)` turned every integrity question into
a silent no-op.

Eleven further tests, the first two being the reproduced attacks. They also hold that a
*partially* real binding is refused rather than quietly narrowed to its real part, that an
unsound binding can still be rejected, and — as a guard against over-tightening — that a set
locked by the ordinary tooling path is soundly bound by construction. The capture package has
137 tests.

**Agency 2 already satisfies every one of these conditions**, so no new discovery, declaration
or round is required: its five bound records all exist, are unique, are `discovery` records,
and belong to its own agency, category and round.

## Operational correction, dated 25 September 2026: an ineligible form is still a form found

**This is a correction to the record of the scan, not to the tooling. No tag moves.**
It was made before the corpus seal, while one page is captured and two agencies are in
progress.

### Two errors in the selection trail

**A document application form is a candidate, and is excluded — not filtered out of
discovery.** The second agency in the draw order publishes four Ministerial Advisory Group
application forms in DOCX. Discovery recorded them as prose results and declared the category
nil. That is wrong, and not merely untidy: a nil candidate set conflates

- *no form was found*, with
- *forms were found, and every one was ineligible*,

and those are different findings about an agency. The `exclude` stage exists precisely to keep
them apart, and collapsing them destroys the distinction between an agency that offers no
application at all and one that offers an application only as a document. For a study whose
subject is the constraints forms place on names, "this agency's application exists but is not
on the web" is a result, not an absence.

**Criterion two was misread.** It requires a form to be *reached from* a website listed for
the agency, not hosted on one, and the frozen protocol states explicitly that a publicly
reachable third-party form may be included when it is directly linked or embedded by a
monitored agency website. The workforce survey this agency links on
`consultations.justice.govt.nz` was recorded as failing criterion two because of its host.
It does not fail criterion two. It is not a service-application candidate because it is a
workforce survey, which is outside all four categories — and that is what the replacement
record says. The replacement also states that only the agency page was examined; the linked
survey itself was not opened, and the record no longer implies otherwise.

### What was redone

Both affected rounds were rejected with their reasons, superseded, and redone. The rejected
versions and their reasons stay in the log.

**Family Violence and Sexual Violence Executive Board, service application.** Round 2 records
the `application` search as `candidates-found` and locks the four DOCX forms as candidates.
They are **pending assessment** at the time of writing; each is expected to be excluded under
criterion five, but that exclusion is a recorded outcome rather than a foregone one, and this
amendment does not claim it has happened. Their content type was confirmed by request
(`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) rather than
inferred from the file extension.

**Te Puni Kōkiri, service application.** Its round-1 note claimed that applications for the
Māori Development Fund are "eight PDFs, excluded by criterion five". Re-inspection does not
support that. The page carries four supporting PDFs — eligibility and investment criteria
guidance, the investment plan, agreement terms and conditions, and data reporting requirements
— and **none of them is an application form**. The proposal template is not published at all:
the page directs kaitono to contact a regional office, which supplies the template, and the
completed proposal is returned by email or post. A search for `application form` across the
site returns no document link of any kind.

**That finding was itself incomplete, and the conclusion drawn from it was wrong.** Round 2
concluded that this agency publishes no application form at all and therefore has no document
candidate to record and exclude. That conclusion rested on inspecting one of its four frame
websites. `www.tupu.nz` does publish downloadable application forms, and round 3 records them:

- `MLC Form 1 General Application` and `MLC Document A1 Request for waiver`, both PDFs hosted
  on `www.tupu.nz` itself;
- `MLC Form 36`, `MLC Form 37` and `MLC Document B1`, PDFs on `maorilandcourt.govt.nz` that
  tupu links directly — admitted by criterion two precisely because a directly linked
  third-party form is in scope.

All five return HTTP 200 with content type `application/pdf`, confirmed by request rather than
inferred from the extension, and `maorilandcourt.govt.nz/robots.txt` disallows only `/admin/`,
`/Security/`, `/installerTest/`, `/interactive/` and the two search paths, so `/assets/` is
permitted. Two further DOCX files on the same tupu page — a newspaper advertisement template
and a trustee CV template — are *not* application forms and are recorded as inspected and not
taken, rather than filtered out in silence.

The round-1 note for tupu had called all eleven of its application-related pages "guidance
rather than forms". That was wrong in the same way the Māori Development Fund note was wrong,
and for the same reason: a document that *is* the application was read as material *about* an
application.

So the corrected finding is not that one agency publishes an ineligible form and the other
publishes none. **Both publish application forms, and every one of them is a document rather
than a web form.** That is a stronger and more interesting result than either version of the
error allowed, and it is now visible in the log rather than collapsed into a nil.

The selected Te Puni Kōkiri page is still unaffected. Its capture came from enquiry or contact,
and the category priority order is satisfied because service application yields no *eligible*
form in any version: five candidates, each expected to be excluded under criterion five, with
the exclusions recorded as outcomes rather than assumed here.

The set is at the per-category bound of five, so nothing was dropped beyond it. Two of the five
— Document B1, a trustee's consent, and Document A1, a request for waiver — are supporting
documents within an application bundle rather than application forms in the narrowest sense.
They are recorded as candidates deliberately: each is a form a natural person completes and
signs, the judgement is arguable either way, and the place to record an arguable judgement is
the candidate set and its outcome, not a discovery note that quietly omits them.

### The limitation this does not support

An earlier draft of this work proposed a limitation to the effect that a frame built from
agency websites systematically misses forms agencies operate on shared whole-of-government
platforms. That claim is wrong, because a directly linked shared-platform form is explicitly
in scope.

The defensible limitation is narrower, and is about the search rather than the frame: bounded
discovery may miss forms — shared-platform forms among them — that the monitored agency pages
do not surface within the fixed terms and the effort bound. What is in scope is what an agency
links; what may be missed is what no inspected agency page links.

### Correction, dated 25 September 2026: unfinished work could be stepped over

Two failures were reproduced in the live run while the corrections above were in flight, and
both had the same cause: the guards asked about *attempts* and forgot that the candidate **set**
is where the selection judgement lives.

**`next` stepped over a correction in progress.** Te Puni Kōkiri's service-application set had
been rejected, superseded, redone and locked, and was awaiting approval. But that agency already
had an approved capture, and `nextWork` skipped a qualified agency on qualification alone — so
the scan reported the *second* agency as the work to do and the correction became invisible. An
operator following `next` would have carried on and never returned to it.

`nextWork` now resolves everything outstanding for an agency before skipping it: unresolved
outcomes, an active set that is pending or rejected, and an approved set with locked candidates
that have no outcome. A category the agency never searched is deliberately *not* outstanding,
because qualification is exactly what stops the later categories being searched; treating them
as unfinished would strand every qualified agency forever.

**`deriveDraft` built a corpus draft while two sets were pending.** It withheld the draft for
pending *attempts* only, so a pending or rejected *set* was invisible to it — and it produced a
clean one-page draft while both service-application corrections were mid-flight. That directly
contradicted this protocol's own statement that the draft is withheld until nothing is
unresolved, and it meant a corpus could be frozen from a sample whose selection was still under
review.

`deriveDraft` now refuses when any active candidate set is not approved (naming each set and its
state), when an approved set has a locked candidate with no outcome, and when a rejected attempt
has not been superseded by a correction. That last case was never checked at all: only `pending`
was looked for, so a rejection left standing quietly dropped its candidate out of the corpus with
no correction recorded anywhere.

**Te Puni Kōkiri's round 2 was itself incomplete, and is rejected.** Round 1 inspected all four
of that agency's frame websites; round 2 inspected only `www.tpk.govt.nz`, because it was written
to correct one page's note rather than to replace a round. Under the binding rule introduced at
`selection-v1.0.6` a set stands only on the records it is bound to, so round 2 cannot inherit the
still-valid Te Haeata, Te Kāhui Māngai and Tupu records from the superseded round 1. Round 3
covers all four websites. The rule and the incomplete redo were both correct in isolation; it is
their combination that made the redo insufficient, which is the kind of interaction only a real
run surfaces.

Nine further tests hold these, including both reproduced bypasses, and — as a guard against
over-tightening — that `next` *does* still step over a qualified agency once nothing is
outstanding, and that a draft *does* build once every set is approved and every locked candidate
assessed. One earlier test was corrected rather than the rule relaxed: it had used a dangling
rejected attempt as a device to reach the category-ordering guard, which the new refusal now
intercepts, so it supersedes the rejection to get there. The capture package has 146 tests.

## Amendment 8: structured exclusions, and the order in which they were recorded

**Dated 25 September 2026.** `capture-v1.0.4`. Moves no earlier tag.

### Why an exclusion now names its criterion

The first document candidates in the scan — nine PDF and DOCX application forms across the
first two agencies — all fail for the same reason: they are not HTML. Recorded only as a
sentence in `exclusionReason`, that would make *"how many candidates failed criterion five"* a
question the log cannot answer, although the scan's document-versus-web-form finding rests on
exactly that count. `capturePage` already recorded `publiclyReachableWithoutSigningIn: false`
structurally when it detected a blocking control; an exclusion had no equivalent.

`exclude --fails <criterion>` sets the named criterion to `false` and leaves the other four
`null`, because an exclusion establishes one thing and not five. The criterion is validated
against the frozen list, and the flag is optional: a robots exclusion turns on no eligibility
criterion at all. `exclude` also now accepts `--supersedes-attempt-id`, so a rejected exclusion
is corrected the same way a rejected capture is.

### The order of events, stated plainly

The tooling change and the data it produced are recorded here in sequence, because the change
landed between two tags and the data was written in the gap:

1. `selection-v1.0.7` was tagged at `4b399ca`.
2. `d5503bd` corrected the Te Puni Kōkiri finding in this document.
3. `803dd29` added `exclude --fails` with three tests, and was pushed. CI passed on all eight
   jobs, including the dependency audit, and the capture package passed 149 of 149.
4. **The nine structured criterion-five exclusions (`c-0125`–`c-0133`) were recorded using
   committed, CI-green `803dd29`, before any tag pointed at it.** They were then approved.
5. This amendment and the `status` correction below were written, and the result tagged
   `capture-v1.0.4`.

Step 4 is the one worth being explicit about. The code that produced those nine records was
committed, pushed and tested at the time it ran, and the commit is reachable from
`capture-v1.0.4` — but no tag existed when the records were written. Nothing needs redoing on
that account, and the sequence is written down rather than left to be inferred from
timestamps.

### `status` reported nothing outstanding while something was

`status` counted pending *attempts* only, so it printed `pending approval 0` at the exact moment
a locked candidate set was waiting for approval. That is the same attempts-versus-sets confusion
that let the corpus draft build while two corrections were in flight, and an operator reading
that line would have concluded the scan was clear.

It now reports pending attempt approvals and pending candidate-set approvals separately, names
each pending set, lists rejected sets awaiting supersession and rejected attempts not yet
superseded, and closes with whether the corpus draft is withheld. Three tests.

A test-fixture divergence was fixed in the same change: the CLI records a discovery record as
approved — a page inspected to find links is not a judgement to approve — but the shared test
helper left it pending, so fixtures carried a state no real log contains and individual tests
worked around it. The helper now matches the CLI. The capture package has 152 tests.

### One interpretation, held consistently for the rest of the scan

Criterion two was misread once already, and the reasoning is fixed here so it is not
re-derived per agency:

- **External ownership alone never excludes a form.** A form on another organisation's host is
  eligible if it is reached from a website listed for the agency.
- **A directly linked or embedded third-party form, relevant to the category, is in scope**, and
  both the agency URL and the final form host are recorded.
- **A link to a home page or a directory index is not a direct link to a form**, and discovery
  does not crawl outward from one.

The third point is what excludes the 32 crisis-support organisations linked from the second
agency's contact page: every link targets an organisation home page or a help-finder index, so
there is no directly linked form to admit. That reason is sufficient on its own. The note on
that record also observes that those are other organisations' support channels rather than the
agency's own enquiry channel; **that observation is not an exclusion rule and must not be used
as one.** Where the two could diverge, the direct-link test governs.

## Amendment 9: an agency leaving the scan without a page

**Dated 25 September 2026. Written before the first real exhaustion is recorded.**
`selection-v1.0.8`. Moves no earlier tag.

### The gap

The second agency in the draw order was searched in all four categories and yielded no eligible
form: no account registration anywhere on its single website, application forms published only
as DOCX, contact by email, and a newsletter subscribed to by email. `next` said so — *"every
category is settled with no eligible form. Record it as exhausted"* — and then nothing could
record it.

`nextWork` could return `exhaustedAgency`, but no command wrote to `log.exhausted`, the array
stayed empty, and the scan therefore could not reach the third agency at all. The only way
onward was to edit the log by hand, which this protocol forbids for exactly the reason that
makes the prohibition worth keeping: a hand-written exhaustion would have no timestamp, no
stated reason, and no evidence, and would be indistinguishable afterwards from an agency quietly
skipped because its forms looked inconvenient.

### Why this is not bookkeeping

An exhaustion is a claim about the sample. It is the difference between *forty agencies were
sampled* and *forty-five agencies were searched, of which forty had an eligible form*, and only
the second of those supports a prevalence statement. The agencies that leave the scan
contributing nothing are part of the denominator, so each needs to say when it left, why, and on
what evidence.

### The operation

**The agency is derived from the draw order, never supplied.** `exhaust` asks `nextWork` whose
turn it is and refuses anything else. `--agency` is a *check*: an operator states who they think
it is, and a mismatch is refused rather than honoured. Accepting an agency would let the order be
skipped — exhausting the seventh while the third is unfinished — and the draw order is the whole
sampling claim.

**Every category must be settled and approved.** All four sets must exist, be locked, be
researcher-approved, and have an outcome for every locked candidate. This is re-verified in the
operation rather than inferred from `nextWork` having said so, on the lesson already learned
twice here: a rule that lives in one caller is a rule another caller does not have.

**An agency that contributed a page is not exhausted.** An approved capture and an exhaustion are
mutually exclusive, and the refusal names the page.

**The record is structured and singular.** It carries the agency, the timestamp, the frozen
reason, and the version of each category's candidate set. The reason is frozen rather than
free text because it is the denominator's explanation: five agencies that did not qualify is
interpretable only if all five left for the same stated reason. A duplicate is refused.

**It is sealed, not merely held in memory.** The exhaustion records are carried into the corpus
draft the seal hashes, and into the published provenance. A corpus that recorded only its pages
would describe a sample of forty without saying how many agencies were examined to obtain them.
A legacy bare-string entry is normalised so that an older log still seals and still counts as
exhausted — otherwise a finished agency would be silently re-offered as work.

**`next` advances only after this explicit action**, which is what the first test below asserts
end to end.

Nine tests: the valid transition with `next` advancing afterwards; premature exhaustion, which
reports what the next work actually is; naming an arbitrary agency, which would skip the order;
an unassessed locked candidate; a category still pending approval; a duplicate; an agency holding
an approved capture; inclusion in both the sealed draft and the published provenance, including
that the draft's hash changes if the exhaustion is removed; and the legacy bare-string case.
Every one asserts that nothing is written on a refusal. The capture package has 161 tests.

### A note on spelling

The second agency's newsletter is the *Pānui*, with the macron, and it is written that way in
this document and in the final report. The locked discovery record for that page spells it
without the macron. That record is approved and sealed into its round; it is not rewritten for
typography alone, and this note is the correction.

## Amendment 10: the seal did not read the denominator

**Dated 25 September 2026.** `selection-v1.0.9` for the capture-side gate and
`solo-protocol-v1.0.1` for the sealer. `selection-v1.0.8` and `solo-protocol-v1.0.0` are not
moved. No discovery, capture or approval is redone.

### The claim that was false

Amendment 9 said the exhaustion records were "sealed with the corpus". They were not.
`sealCorpus` does not hash the corpus draft: it *constructs* a manifest from the pages and the
selection ledger, and it never looked at `exhaustedAgencies`. The test offered as proof hashed
the draft JSON inside the test, which demonstrates only that `JSON.stringify` is sensitive to its
input. It tested nothing about the sealer.

So a corpus could have been sealed recording forty pages and saying nothing about how many
agencies were searched to obtain them — the denominator of every prevalence figure in the study
living in an array the seal did not read.

Three further contradictions existed in the live state at the same moment: `next` said an agency
had to be recorded as exhausted, `status` said *"nothing outstanding; the corpus draft is not
withheld"*, and the draft built with one page and no exhaustion record. Three commands
disagreeing about one log.

### The capture-side gate

**`status` counts an agency awaiting exhaustion as outstanding**, so it no longer contradicts
`next`.

**The corpus draft is withheld** until every agency that finished all four categories with
nothing eligible has an exhaustion record. This is derived from the log rather than from
`nextWork`, so it holds for every such agency at once and not only for whichever is next in turn.

### What the seal now enforces

**The records are validated and copied into the manifest.** Each must name its agency, carry an
ISO 8601 UTC timestamp, carry the frozen reason verbatim, and give a positive integer version for
each of the four categories and no others. A record without a timestamp or without versions
predates the exhaustion operation and is refused with that explanation rather than sealed.

**Completion is enforced**, for a real seal, against the frozen draw order read from disk:

- at the target of forty qualified pages, the agencies holding a page or an exhaustion must be
  exactly the first *n* of the draw order — nothing skipped over, nothing reached out of turn;
- below the target, every one of the forty-five must be accounted for as a page or an exhaustion,
  because fewer than forty qualifying means the scan ran out of agencies rather than stopping
  early;
- the two sets must be unique and disjoint — an agency either contributed a page or was searched
  without one — and every name must be in the frozen frame.

A **synthetic** corpus is exempt from the frame and completion rules and says so in its manifest.
It is explicitly not the study's corpus: its agencies are not frame agencies and its page count is
arbitrary.

The frozen reason, the target of forty and the four categories are restated in the sealer because
`evaluation/` must not import the capture package — that independence is what stops building
evaluation tooling from changing the instrument. Duplication is only safe if it is checked, so a
test asserts the two packages' constants are identical, and the seal is the authority: a record
whose reason differs does not seal, whatever wrote it.

Eleven tests replace the one that proved nothing, including that removing a single exhaustion from
an otherwise complete corpus breaks the seal and the refusal names the unaccounted agency; that a
one-page, zero-exhaustion corpus cannot seal; and that the records reach the manifest, survive
being written and read back, and are covered by the manifest hash a study verifies.

### A latent defect found while doing this, and fixed

The completion check compares agency names against the draw order, which meant reading that file
properly for the first time. **Two of the forty-five agencies have commas in their names, and the
frozen file quotes them** — `Ministry for Cities, Environment, Regions and Transport` at position
17 and `Ministry of Business, Innovation and Employment` at 41. `parseDrawOrder` carried a comment
asserting the file does not quote, rebuilt the name by joining the middle fields with commas, and
returned it **still wrapped in its literal quote characters**.

Nothing had noticed because the scan had not reached position 17. It would have failed there, and
quietly: the quoted name matches nothing in the frame, matches nothing an operator types, and
would key its candidate sets under a name no other artefact uses — so that agency's entire round
would have been recorded under a name that looks right in printed output and is wrong everywhere
it is compared. Both files are now parsed with a quote-aware splitter, and five tests cover it,
including that every agency in the draw order is present in the frame under exactly that name.

This is the second defect in this scan found not by a test but by needing a value to be correct
for something else. Both were in code that had passed every test written for it, because the tests
had been written from the same wrong assumption as the code.

## Amendment 11: the seal now checks evidence, not shape

**Dated 25 September 2026.** `solo-protocol-v1.0.2`. No capture-side code changed, so
`selection-v1.0.9` stands; `solo-protocol-v1.0.0` and `v1.0.1` are not moved. No discovery,
exclusion or approval is repeated.

### Three blockers in the v1.0.1 sealer

**The manifest named the wrong protocol.** `sealCorpus` defaulted to `solo-protocol-v1.0.0`, so
every manifest the v1.0.1 sealer produced declared it had been sealed under the *previous*
protocol — the one whose seal did not read the exhaustion records at all. A manifest that misnames
its own rules is worse than one that omits them: a reader checking which rules a corpus was sealed
under would be told the wrong ones, and would be told so by the artefact whose job is to be
authoritative.

**Exhaustions were validated by shape, never against evidence.** The seal checked that a record
had an agency, a timestamp, the frozen reason and four positive versions — and checked none of it
against anything. So a hand-written draft could carry forty-four perfectly well-formed exhaustion
records for agencies nobody ever searched, satisfy the forty-five-agency completion rule, and seal
a one-page corpus as a complete scan of the frame. The sealed selection ledger does not close this
hole, because it records examined URLs and outcomes and contains no candidate-set versions,
approvals, or exhaustion records.

**More than forty pages could seal.** The completion branch tested
`uniquePageAgencies.size >= MAX_QUALIFIED_AGENCIES`, which treats forty-one pages as having
reached the target and seals them against a forty-one agency prefix. Forty-one is not a corpus
that overshot; it is one whose selection did not stop where the protocol says it stops.

### What the seal does now

**The authoritative capture log is bound by hash and read.** A real seal requires
`--capture-log`, records its digest in the manifest so it cannot be swapped afterwards, and
verifies every exhaustion against it: the record must *be* in the log with the same timestamp,
reason and versions; the agency must have four candidate sets at exactly those versions, each
locked, approved and with an outcome for every locked candidate; and the agency must hold no
approved captured page. The symmetric check is made too — a sealed page must be an approved
capture in the log, attributed to the same agency.

**Forty is an upper bound as well as a target.** More than forty sealed pages is refused outright,
and the prefix rule now applies at exactly forty.

**The sealer attests itself.** A real seal requires a clean checkout tagged with the current
solo-protocol tag, and the manifest records the sealer's tag and commit alongside — not instead of
— the `evaluation-v1.1.0` analyser identity. They are different artefacts under different tags,
and the sealing rules changed materially at this version, so a manifest naming only the analyser
could not say which rules produced it. The README now states that the frozen analyser checkout is
supplied during sealing as well as analysis.

Seven further tests, the first being the fabrication itself: forty-four well-shaped but unsupported
exhaustion records with a one-page corpus, refused with one objection per record. Also a pending
candidate set in the log, a version the log disagrees with, forty-one pages, a real seal attempted
with no capture log at all, a page the log does not record as approved, and that the manifest names
this protocol, this sealer, the analyser and the bound log's hash. The solo suite has 31 tests.

### What this says about the previous two amendments

Amendment 9 claimed the exhaustion records were sealed; Amendment 10 made that true of the
manifest's *contents*. This one makes it true of their *meaning*: until now the seal could confirm
a record existed and was well formed, which is a different thing from confirming the search it
describes ever happened. The pattern across all three is the same, and worth stating once: a gate
that checks the form of a claim rather than the evidence for it is a gate that rewards a
well-formatted assertion over a true one.

## Amendment 12: the official seal could not have run

**Dated 25 September 2026.** `solo-protocol-v1.0.3`. No capture-side code changed, so
`selection-v1.0.9` stands. `solo-protocol-v1.0.0` through `v1.0.2` are not moved. No discovery,
exclusion or approval is repeated.

### The command was impossible

`cli-seal-corpus.mjs` read both identities from one directory:

```
const identity = instrumentIdentity(instrumentDir);
const sealer   = sealerIdentity(instrumentDir);
```

`instrumentDir` is the separate checkout tagged `evaluation-v1.1.0`. The solo-protocol tag points
at a different commit, so that checkout cannot carry both tags — and whichever identity was
checked second therefore always failed. The official sealing command, added one amendment earlier
to make the seal trustworthy, could not succeed at all. It was never run, because the corpus is
not finished, so nothing had surfaced it.

The sealer identity now resolves the checkout that **contains** `cli-seal-corpus.mjs`, which is
the code doing the sealing; the analyser identity still comes from
`FORMFAIR_SOLO_INSTRUMENT_DIR`. They are separate artefacts under separate tags and are resolved
separately. A real seal requires both checkouts clean, one tagged `evaluation-v1.1.0` and the
other tagged `solo-protocol-v1.0.3`.

### The capture log was named, not bound

The manifest recorded the log's digest under the **hardcoded** filename `capture-log.json`, while
the seal had read whatever `--capture-log` pointed at, anywhere on disk. So a manifest could name
one file and have been sealed against another. And `loadSealedPages` never re-read it: the one
artefact proving which searches actually happened could be edited after sealing, and no later step
would notice.

Now the log must sit inside the capture root — the directory holding `captures/` — the manifest
stores its **actual relative path** with its SHA-256 and byte count, and `loadSealedPages`
re-reads and re-verifies both. The byte count is checked as well as the digest because a
truncation is then reported as a truncation rather than as an unexplained hash difference.

Nine further tests: that `sealerIdentity` defaults to its own checkout and does not follow the
analyser directory; that the official CLI reaches the *analyser* tag check when the analyser
directory is wrong, which is only distinguishable now that the two are resolved apart; that the
manifest stores the real filename rather than a hardcoded one; a log outside the capture root; a
log tampered with after sealing, refused on both hash and byte count; a manifest naming a log that
is not there; a manifest edited to point outside the root; and that an untampered corpus loads
cleanly. The solo suite has 40 tests.

The test fixtures were also restructured to mirror the real layout — a capture root holding
`capture-log.json` beside a `captures/` directory — because the previous fixtures flattened the
two, which would have let the path checks pass without ever being exercised.

### The recurring shape

This is the fourth consecutive amendment to the same area, and each defect has been of the same
kind rather than a new one: a claim recorded but not checked (v1.0.1), a claim checked for form
but not for evidence (v1.0.2), and now a check that could not run at all plus a binding that named
its evidence without holding it (v1.0.3). The common cause is that each gate was written and
tested against the shape of the thing it guards rather than against the thing itself, and the
tests inherited the assumption from the code. Where a gate cannot be exercised end to end — as an
official seal cannot be, before the corpus exists — that inheritance goes unchallenged, so the
compensating discipline is to test the parts that *can* run against real layouts and real
artefacts, not against fixtures shaped to agree.

## Amendment 13: robots.txt was enforced in one command and trusted in another

**Dated 25 September 2026.** `selection-v1.0.10`. Moves no earlier tag. A deviation note is also
recorded beside the politeness clause itself, so a reader of the rule sees the breach without
having to reach this amendment.

### What happened

The third agency, the Ministry of Health, has thirteen frame websites. Its main site's
`robots.txt` disallows `/search?`. During the first discovery round four internal-search URLs on
that host were fetched anyway — `?query=register` and `?query=sign%20up`, both recorded, and an
earlier `?keywords=register` and `?keywords=sign+up` pair fetched while establishing which
parameter the search actually used, and never recorded at all. Six requests across four forbidden
URLs.

The review that caught it identified two; auditing every URL touched for that agency against the
project's own `isAllowed` found four. The unrecorded pair is the part worth dwelling on: they left
no trace in the log, so nothing but that audit would have surfaced them.

A separate defect in the same round: Tātai's `robots.txt` and its sitemap were both inspected, and
only the robots inspection was recorded. Two inspections, one record, which understates what was
examined.

### Why it happened

`robots.txt` was checked inside `doCapture` and nowhere else. Discovery browsing happens outside
the capture harness — that is already acknowledged in Amendment 3, which added recorded pacing for
exactly that reason — but the robots half of the same problem was left to the operator to
remember. It held for two agencies and failed on the third, on the first site large enough to
disallow its own search endpoint.

This is the same shape as the defects in the sealer: a rule stated once and enforced in one place,
with every other path trusted to comply.

### The change

**`discovery` fetches and checks `robots.txt` itself.** A path robots forbids may still be
recorded — `disallowed` is an outcome precisely because a forbidden method is a finding about the
agency — but any other outcome is refused, because `no-candidates` or `unavailable` asserts that
the page was retrieved. The refusal names the matching rule and tells the operator which outcome
to use.

An unreachable `robots.txt` is treated as absent, which is the standard reading and the behaviour
Tātai depends on: that host returns 403 to a plain request for both its robots file and its
sitemap.

Five tests: a substantive outcome on a disallowed path is refused with nothing written; a
`disallowed` outcome on the same path is recorded; an allowed path is unaffected; `robots.txt`
itself is always fetchable; and a host serving no robots file permits. The capture package has 171
tests.

### The record as it stands

Round 1 is preserved, rejected, with its reason naming all four disallowed URLs and the structural
cause. Round 2 covers the same thirteen frame websites through ten hosts in twenty-six
inspections, records internal search on `www.health.govt.nz` as `disallowed` and **not navigated**,
and records Tātai's robots file and sitemap as two separate `unavailable` inspections. The nil
conclusion is unchanged, and was never in doubt: the main site's only account registration path is
robots-disallowed, the Citizen Space hub has no such path at all, and the four Shiny dashboards
share a host that disallows everything.

The two search result counts observed in round 1 are excluded from round 2's evidence. They are
not claimed to be forgotten. The distinction matters because the nil finding does not rest on
them: it rests on the disallowed registration path and on inspections that were permitted.

## Amendment 14: a permit before the request, not a verdict after it

**Dated 25 September 2026.** `selection-v1.0.11`. Moves no earlier tag.

`selection-v1.0.10` added a robots check to `discovery`, and it was in the wrong place. Three
defects followed, and one side effect.

**The check ran when the record was written, which is after the browsing.** It could refuse the
record but not the request. It documented a breach rather than preventing one — the precise thing
Amendment 13 was written to stop. `preflight-discovery` now checks the policy *before* anything is
navigated and writes a single-use permit, which `discovery` consumes. A record without a permit is
refused. Permits are scoped to agency, category, round and URL: one page's permit cannot authorise
another, and a second record cannot ride a spent one.

For a forbidden URL no permit is issued and no request is made to the target at all; `preflight`
writes the `disallowed` record itself. A test asserts that the only request the server sees is
`robots.txt`.

**The "NOT NAVIGATED" records carried `navigatedAt` and were counted in the pacing.** The raw data
asserted a navigation the note denied. A record that performed no request now carries
`navigationPerformed: false` and a `checkedAt`, is refused if it carries a `navigatedAt` at all,
and is excluded from the five-second pacing calculation — it cannot be the "previous navigation"
for anything, because there was none.

**Every non-2xx response was treated as permission.** RFC 9309 does not say that. A 4xx means the
file is *unavailable* and access is permitted (section 2.3.1.3); a 5xx or a network failure means
it is *unreachable*, and complete disallow is to be assumed (2.3.1.4). The old code collapsed the
two, and the test written for it asserted that a refused connection permits — exactly backwards,
and it turned a server having a bad afternoon into permission to crawl it. The three cases are now
distinct, with `robots.txt` itself always retrievable even under complete disallow, or an origin
whose server failed once could never be re-checked.

Tātai's 403 is a 4xx, so it permits; that is why it is recorded as `unavailable` rather than
forbidden, and the reading is now explicit rather than incidental.

**The side effect.** Each one-shot `discovery` invocation fetched `robots.txt` into a cache that
died with the process. Round 2's twenty-six inspections therefore made twenty-six robots requests
that no record described — invisible traffic generated by the machinery meant to make traffic
accountable. The policy is now written into the capture log, reused across invocations, and
re-fetched only when asked. A test asserts three separate CLI calls produce one robots request.

Eleven tests. The capture package has 178 tests. One earlier CLI test was updated rather than the
rule relaxed: its end-to-end flow now preflights before recording, as a real round does.

## Amendment 15: unfinished discovery could disappear from the corpus gate

**Dated 25 September 2026.** `selection-v1.0.12`. Moves no earlier tag.

### The bypass, reproduced from the live ledger

Twenty-six discovery records existed for a Ministry of Health round — `d-0198` to `d-0223` — and
no candidate-set object for that round at all, because a set was created only when candidates were
first recorded. Every gate keyed off candidate sets, so all of them looked past it:

```
status -> nothing outstanding; the corpus draft is not withheld
next   -> record discovered candidates, then lock the set
draft  -> BUILT: 1 page, 1 exhaustion, 26 Ministry records ignored
```

An entire agency's round sat in the log, unlocked and unreviewed, and the corpus could have been
sealed without it. Discovery that never reached the step which creates the set was invisible to
every check meant to notice unfinished work.

### The corrections

**A round exists from its first inspection.** `preflight-discovery` opens the candidate set, so
records can no longer accumulate outside one.

**`status` and `deriveDraft` refuse** discovery rounds with no set, or with a set that is not
locked; open permits, which mean a request was authorised that nothing accounts for; and sets
that are not approved. A locked-but-unapproved set is deliberately *not* reported as an
unresolved round as well, because it is already an outstanding candidate-set approval and would
otherwise turn one outstanding item into two.

**Permit chronology and expiry.** A permit authorises a *future* request, so the navigation it
covers must fall after the permit was issued and within an hour of it. Without this a permit
could be issued now and attached to an observation made days earlier, which would make the check
look preventative when it was retrospective — the exact appearance the permit exists to deny.
This is why the plan to "redo the round with no new browsing" was wrong, and it is enforced
rather than remembered.

**Robots policies expire after 24 hours**, per RFC 9309 section 2.4. A permanently cached policy
could authorise a path that has since become disallowed.

**A single discovery record is corrected in place.** A corrected record names
`supersedesDiscoveryId`; the correction must match the original's agency, category, round, URL and
method; the original is preserved; locking binds the correction and *not* what it replaced; and
the approval packet shows both, marking the superseded one as not evidence. A round of twenty-six
inspections with one wrong record does not need twenty-five re-observations, and repeating them
would mean re-requesting pages already retrieved under permits — traffic with no evidential
purpose.

**`/robots.txt` is implicitly allowed.** RFC 9309 section 2.2.2 says so directly: "The
/robots.txt URI is implicitly allowed." Found by running a real round:
`minhealthnz.shinyapps.io` publishes `Disallow: /`, and the robots inspection recorded *itself* as
disallowed and not navigated, while carrying a note describing the file's contents that only
reading it could supply. The rule never reached that URI — the code was applying it where the RFC
does not, which is a different and smaller claim than the one first written here.

Eleven tests, including both live bypasses reproduced end to end. The capture package has 191
tests.

### Two fixtures corrected rather than rules relaxed

The end-to-end CLI fixture used fixed past timestamps for its discovery records, which the
chronology check now correctly rejects. Replacing them exposed a second fault in the fixture
itself: it read the navigation time *before* running the preflight, and since timestamps are
truncated to the second, that value could land a second earlier than the permit it was supposed to
follow. Both were the fixture being wrong about the order of events, not the rule being too
strict.

## Amendment 16: correcting the correction

**Dated 25 September 2026.** `selection-v1.0.13`. Moves no earlier tag. No full round is repeated.

### The correction was wrong about which field was wrong

`d-0222` recorded the Shiny host's robots inspection as `disallowed` with
`navigationPerformed: false`. Only the second of those was false. The inspection genuinely
established `Disallow: /`, so `disallowed` was the right substantive finding; what could not be
true was the claim that nothing had been fetched, since RFC 9309 section 2.2.2 makes `/robots.txt`
implicitly allowed and it had been retrievable all along.

`d-0224` corrected the wrong field. It recorded `no-candidates`, which made the *active* evidence
say a host that forbids every path is unrestricted, while its own note said the opposite. The
round then bound a record whose outcome contradicted its note — a worse state than the one being
repaired, and one produced by fixing a self-contradiction without checking which half was sound.

`d-0225` records `disallowed`, after a real permitted request to `/robots.txt`. `d-0222` and
`d-0224` are both preserved, both superseded, and neither is bound.

### Three durable fixes

**A locked but unapproved set can be reopened, audibly.** A correction appended after locking left
the binding pointing at the superseded record while its replacement sat outside the set — so the
set would evidence a finding that had been withdrawn. `reopen-set` requires a reason and preserves
the previous lock, its binding and its methods in `lockHistory`. An **approved** set cannot be
reopened: that judgement has been relied on, and changing it means rejecting and superseding,
which the protocol already provides.

**The approval packet counts active evidence.** It reported twenty-seven inspections for a
twenty-six record round, and raised an anomaly against a record the same packet declared was not
evidence. It now reads `26 active across 10 website(s), 2 superseded record(s) shown but not
evidence`, and builds `FOR ATTENTION` from active records only. Superseded records are still
displayed, marked with what replaced them.

**Robots policy history is append-only.** A refresh overwrote the previous policy while keeping
its id, so after the twenty-four hour expiry a permit issued under the old policy would appear to
have been authorised by the new one. Each check is now its own record with its own id, reads
return the most recent, and the evidence for a past decision remains the evidence that existed
when it was made.

### A wording correction

Amendment 15 said a `Disallow: /` file "by the letter of the rules disallows its own policy file".
That overstates it. RFC 9309 section 2.2.2 states that the `/robots.txt` URI is implicitly allowed,
so the rule never reaches it; the code was applying a restriction the specification does not make,
which is a smaller and more precise claim than deciding to override a real one.

Seven further tests, including both future holes reproduced directly. The capture package has 198
tests.

## Amendment 17: a permit names its request, and closing one accounts for it

**Dated 25 September 2026.** `selection-v1.0.14`. Moves no earlier tag.

### What went wrong

Three permits were left open after a discovery round. They were not spurious: two permits had been
issued for each of three URLs — once to inspect the page, once by the recording script — and two
real requests were made. Consumption took the *oldest* matching permit, so the second stayed open,
and there was no way to close it. The corpus draft was therefore permanently blocked by an
accurate complaint.

The word for the remainder is not "released". Calling it that would assert that no request
occurred, which is the opposite of what happened.

### The changes

**One open permit per agency, category, round and URL.** A second is refused, and the refusal
happens *before* any network request — including the robots fetch — so that declining to authorise
traffic does not itself generate traffic.

**A record names the permit that authorised it.** `discovery` requires `--permit-id` and consumes
that exact permit. Taking whichever open permit matched left the pairing between a request and its
authorisation implicit, and when two existed it was simply wrong.

**`close-permit` closes an open permit with an explicit disposition.** `unused` means no
navigation occurred. `duplicate-request` means a navigation occurred but duplicated an inspection
already recorded, and it must name that record with `--accounted-by`, which is checked for the
same agency, category, round and URL. A reason is required either way. A consumed or
already-closed permit cannot be closed again, and an `unused` closure may not name a record —
nothing was requested under it.

Open permits still withhold the corpus draft. Consumed and properly closed permits do not.

**The traffic audit is publishable.** The provenance writer now assembles permits issued,
consumed, closed unused, closed duplicate-request, and every closure's id, timestamp, reason and
associated discovery record. The committed `provenance.json` is stale — it predates the permit
model entirely — so the audit is *publishable*, not yet published, and will be regenerated and
committed at the next provenance checkpoint. A `duplicate-request` permit **is** counted as a network request, because one
was made; it is counted as no additional inspection, candidate, page or evaluation observation,
because it produced none.

Nine tests. The capture package has 207 tests.

### The three permits in this scan

`p-0031`, `p-0035` and `p-0039` are closed as `duplicate-request`, accounted for by `d-0231`,
`d-0235` and `d-0239` respectively. Their reason records that two permits and two requests
occurred for each URL, and that the oldest-permit rule made the pairing between a request and its
permit ambiguous — which is the defect this amendment removes.

### A decision that stands

HDEC applications are made through a third-party system whose **root** the agency links.
Amendment 8 states that a home page or directory index is not a direct link to a form and that
discovery does not crawl outward from one. That exclusion turns on link depth, not on third-party
ownership — external ownership alone never excludes a form — and the round's `no-candidates`
record for that page is correct and is not superseded.

## Amendment 18: the permit ledger must describe traffic that happened

**Dated 25 September 2026.** `selection-v1.0.15`. Moves no earlier tag. No round, closure or
approval is redone.

### The fabrication

`closeDiscoveryPermit` verified that the named discovery record existed and matched the permit's
agency, category, round and URL — and nothing further. So a record carrying
`navigationPerformed: false` was accepted as evidence that a request *had* been made, and the
audit then reported an authorised network request whose own named evidence said no navigation
occurred:

```
ATTACK SUCCEEDS: closed as duplicate-request; audit says networkRequestsAuthorised = 1
  ...while its named evidence says no navigation occurred.
```

The corpus gate checked only for **open** permits, so a closed-but-fabricated one escaped the
final gate as well.

### What a duplicate-request closure actually asserts

Two things: that a second request was made, and that an existing inspection accounts for it. The
evidence must therefore be a real navigation — not a record stating none occurred — recorded under
its **own consumed permit**, and that permit must be a *different* one covering the same agency,
category, round and URL. A closure evidenced by the very permit being closed duplicates nothing.

`checkPermitLedger` expresses this once and is called from three places: the closure itself, so a
bad closure cannot be written; `deriveDraft`, so one already in the log cannot be sealed; and
`publishProvenance`, so an inconsistent ledger cannot be published. A rule enforced where a value
is written but not where it is trusted is the defect this scan has rediscovered repeatedly, and
the three call sites are the answer to it rather than a precaution.

A failed closure leaves the permit untouched rather than half-written: the validator runs against
the state the closure *would* leave, and the fields are rolled back if it does not hold.

Eight tests, including the fabrication reproduced end to end and both gates refusing a ledger
written directly into the log — because the closure API is not the only way a ledger reaches the
gate. The capture package has 215 tests.

### The existing closures

`p-0031`, `p-0035` and `p-0039` were re-checked under the stronger rule and pass:

| permit | accounted by | evidence permit | consumed | navigated | distinct |
| --- | --- | --- | --- | --- | --- |
| `p-0031` | `d-0231` | `p-0028` | yes | yes | yes |
| `p-0035` | `d-0235` | `p-0026` | yes | yes | yes |
| `p-0039` | `d-0239` | `p-0027` | yes | yes | yes |

`checkPermitLedger` reports no problems against the live log. Nothing is redone.
