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

## Amendment 19: a permit and its inspection are one to one

**Dated 25 September 2026.** `selection-v1.0.16`. Moves no earlier tag. Nothing is redone.

`checkPermitLedger` validated closures and never reached consumption, so three inconsistent
ledgers passed cleanly:

- a discovery record whose URL differed from the URL of the permit it named;
- a consumed permit that no discovery record referenced;
- two discovery records naming one single-use consumed permit.

Each says the log does not describe the traffic that occurred, which is the only thing the permit
model exists to do. Validating the closure side alone checked that a *correction* was honest
while leaving the ordinary path unchecked.

The invariants now enforced:

- every consumed permit is referenced by **exactly one** discovery record;
- that record matches its permit's agency, category, round and URL;
- every record naming a permit references an existing, consumed permit;
- permit ids and closure ids are unique;
- every permit names an existing robots check **for its own origin** — the check is why the permit
  was issued at all.

Records predating the permit model carry no `permitId` and are exempt. The invariants apply to
permits and to the records that participate in the model, not retrospectively to a log written
before it existed.

Nine tests, the first three being the reproduced ledgers. The capture package has 224 tests.

### The live ledger

Unchanged and clean under the stronger audit: 51 permits, 48 consumed, 48 records naming permits,
11 robots checks, **0 problems**. Four earlier fixtures needed seeding with a robots check, having
issued permits that named one which did not exist — the fixtures were wrong in exactly the way the
new invariant describes, and were corrected rather than the rule loosened.

## Amendment 20: the gate and its report are one computation

**Dated 25 September 2026.** `selection-v1.0.17`. Moves no earlier tag. Nothing is redone.

`status` and `deriveDraft` each built their own list of unfinished work, and drifted apart twice.
The second time, with a candidate set approved and its candidates unassessed, three commands
described three different states of one log:

```
status:      nothing outstanding; the corpus draft is not withheld
next:        assess 4 locked candidates still without an outcome
deriveDraft: REFUSED - 4 locked candidates have no outcome
```

`status` was missing unassessed locked candidates and permit-ledger problems entirely. Amendment
12 had already fixed one drift of exactly this kind by adding the checks `status` lacked — which
is why adding more checks was not the remedy this time. Two lists maintained in parallel will
diverge again; one list read twice cannot.

`corpusBlockers(log)` is that list. `deriveDraft` refuses when it is non-empty; `status` prints it
and counts it. The structural checks on a finished corpus — one page per agency, the forty-page
bound, the draw-order prefix, frame membership — stay in `deriveDraft`, because they ask whether a
*complete* sample is valid rather than whether the work is finished.

Three tests, the last of which asserts the agreement itself rather than any single omission: across
a pending attempt, an unapproved set, an open permit and a clean log, the gate refuses exactly when
the report is non-empty. That is the property that was broken both times, and it is now the thing
under test.

The capture package has 227 tests. Four earlier tests asserted the previous wording or the previous
weaker notion of "all clear"; they were updated to the unified message, and one fixture now
declares a nil set rather than leaving a locked candidate unassessed — which under the corrected
rule is outstanding work, exactly as the gate always said.

## Amendment 21: the permit lifecycle is ordered and complete

**Dated 25 September 2026.** `selection-v1.0.18`. Moves no earlier tag. Nothing is redone.

The ledger checked structure and pairing but never the *sequence*, so five impossible histories
passed with zero problems:

- a record stating `navigationPerformed: false` counted as having consumed a permit;
- a navigation dated before the permit that authorised it;
- a robots check fetched **after** the permit it supposedly justified;
- a robots check more than 24 hours older than the permit resting on it;
- a navigation more than an hour after issuance, past the permit's own expiry.

The closure state machine also accepted an unknown disposition, and a closure with neither reason
nor id, when written directly into the log.

The order is the entire claim. `robots fetched ≤ permit issued ≤ navigation ≤ consumed` is what
"the request was authorised before it was made" means; without it the ledger records the right
objects in an impossible arrangement, which is exactly the shape a fabricated log takes.

Now enforced: discovery status and real navigation for any record naming a permit; the full
temporal chain; the 24-hour robots limit and the one-hour permit limit; the four valid permit
states — open, consumed, closed-unused, closed-duplicate-request — with a closure required to
carry a known disposition, an id and a reason, and a disposition or closure field refused on a
permit that is not closed.

**`checkPermitLedger` no longer takes `{ only }`.** That option skipped every general check, so a
closure was validated against its own permit while the ledger around it went unexamined — which
is how a closure could be written into an already-inconsistent ledger. Closure now validates the
whole ledger and rolls back if it does not hold.

Twelve tests, five of them the reproduced histories. The capture package has 239 tests.

### The live ledger

Passes unchanged: **0 problems**, with only the two expected corpus blockers — the pending
Ministry set and its four unassessed candidates. Three earlier fixtures mixed a live clock with
fixed past timestamps, since `issueDiscoveryPermit` stamps the present; they now pin the whole
chain to one instant. That was the fixtures being impossible in precisely the way the new rule
describes, and they were corrected rather than the rule loosened.

## Amendment 22: presence is not validity

**Dated 25 September 2026.** `selection-v1.0.19`. Moves no earlier tag. Nothing is redone.

The state machine asked whether fields were *there*, not whether they parsed, were ordered, or
were permitted in that state. Six fabricated permits passed with zero problems:

- an open permit carrying `accountedBy`;
- a closure stamped `closedAt: "not-a-date"`;
- a closure dated before its own issuance;
- an unparseable robots `fetchedAt`;
- a robots check exactly 24 hours old, which `robotsCheckIsFresh` already treated as expired
  while the ledger's strict `>` did not;
- `consumedAt` set to a string that is not a time.

A field nobody can parse is not weaker evidence than a missing one. It is worse: a missing field
fails an existence check, whereas an unparseable one satisfies every test that asks only whether
something was written down. Four of these six are of that kind, and the checks added in
Amendments 18 through 21 all read as "is it present" rather than "is it true".

One rule now covers the lifecycle: every timestamp must be a valid UTC timestamp; an open permit
carries no consumption or closure field, `accountedBy` included; a consumed permit needs a valid
`consumedAt`; a closed permit needs a valid `closedAt` not earlier than its `issuedAt`; a
closed-unused permit names no record and a closed-duplicate-request permit must name one; and
robots freshness expires at `age >= ROBOTS_MAX_AGE_MS`, matching `robotsCheckIsFresh` exactly
rather than approximately.

That last one is worth stating plainly: two functions disagreed about the same boundary by one
instant, and the disagreement was invisible because nothing compared them. A test now asserts
both at 24 hours exactly and at one second inside the window.

Ten tests, six being the reproduced states. The capture package has 249 tests.

The live ledger passes unchanged — 51 permits, **0 problems** — with only the pending Ministry set
and its four unassessed candidates outstanding.

## Amendment 23: four states, enumerated rather than sampled

**Dated 26 September 2026.** `selection-v1.0.20`. Moves no earlier tag. Nothing is redone.

Truthiness, in the last few places it survived, let three impossible permits pass:

- an open permit carrying `closureId: ''`, `closureReason: ''` and `disposition: ''`;
- a consumed permit carrying `accountedBy`;
- a `duplicate-request` closure timestamped **before** the navigation it claims to duplicate.

`navigatedAt` was also reaching the temporal checks unvalidated, so a date-only
`"2026-09-25"` was caught only incidentally, by falling outside the permit window rather than by
being the wrong shape. It is now validated through the same `stamp()` as every other timestamp,
so the reason given is the real one.

An empty string and an absent field are the same thing to `if (x)`. They are not the same thing to
a reader of the log: one says the field was set and left blank. Every closure-only field is now
tested for presence.

The state model is explicit and exclusive:

| state | fields |
| --- | --- |
| open | `issuedAt` only |
| consumed | `consumedAt`, and no closure metadata |
| closed unused | `closedAt`, `disposition`, `closureId`, `closureReason`; no `accountedBy` |
| closed duplicate-request | the same, plus `accountedBy` |

Open and consumed both reject *all* closure metadata, `accountedBy` included. A
`duplicate-request` closure must not predate its evidence navigation or that evidence permit's
consumption.

### Why this is a table and not four more tests

This was the fifth consecutive amendment to the permit ledger, and the previous four were each one
field at a time: a missing check, then an unvalidated timestamp, then a truthiness test. Testing
one field per defect is what let the cycle continue, because the property being defended was never
written down — only its latest counterexample.

So it is written down. A table enumerates every combination of consumption, closure, disposition,
id, reason and `accountedBy` — 360 of them — removes the four canonical states, and asserts that
none of the rest is accepted. The next gap of this shape fails there rather than in a live ledger.

The table was checked for vacuity: reverting `present` to truthiness makes it fail with the
accepted states named, which is the regression that produced this amendment.

Six tests, one of them the table. The capture package has 255 tests. The live ledger passes
unchanged — 51 permits, **0 problems** — with only the pending Ministry set and its four
unassessed candidates outstanding.

## Amendment 24: a challenge is not a locked door

**Dated 26 September 2026.** `capture-v1.0.5`. Moves no earlier tag.

**Triggered by a held-out observation, and written before it was assessed or captured.** While
recording `enquiry-or-contact` discovery for the Ministry of Health, `www.health.govt.nz`'s
feedback page turned out to carry an ordinary HTML form with a required text input named `name`,
labelled "Name", `maxlength="255"`, no `pattern` and no `minlength` — readable on load without
interacting with anything. The page also loads Google reCAPTCHA, and `detectBlocking` would have
returned `captcha`, which the CLI turned into *"not publicly reachable"*.

The same flat list treated **any password field** as blocking. That would have excluded every
public registration form — account registration being the first category in the frozen priority
order, and so the one most likely to contribute pages.

### What the frozen criteria actually require

Criterion one asks that the form be publicly reachable **without signing in**; criterion four that
the name field be visible **without entering data or submitting**. Both hold for that page: it was
read without authenticating and without answering a challenge, and the name field is rendered on
load. The reCAPTCHA guards *submission*, which this protocol never performs — no code path types
or submits, and a test asserts it from the captured markup.

So the interpretation is fixed, before any assessment:

- **CAPTCHA and password signals are not automatic access barriers.**
- **reCAPTCHA, hCaptcha and Turnstile are recorded as submission-protection properties** of the
  captured form.
- **A page is excluded only when the intended form or name field cannot be viewed** without
  authenticating or interacting with a challenge.
- **A visible form protected only at submission remains eligible.**

### The three signals

`detectBlocking` returned one list in which everything meant exclusion. It now returns three,
because they mean different things, and all three are carried through the capture record, the
corpus draft, the seal and the published provenance:

| field | meaning | effect |
| --- | --- | --- |
| `accessBarriers` | the form cannot be read — 401, 403, a challenge interstitial, a sign-in wall | excluded |
| `submissionProtection` | a challenge guarding submission of a readable form | recorded |
| `authenticationSignals` | password fields present on the page | recorded |

Two judgements inside that deserve stating. A login form's username box is part of the barrier
rather than the form under study, so readable content is counted *outside* any form carrying a
password field. That alone would classify a registration form as a wall, since its name field sits
beside the password — so the discriminator is whether the password-bearing form exposes a
personal-name field, which is this study's own subject.

**A password-bearing form that exposes a personal-name field is not automatically classified as a
sign-in wall; it proceeds to researcher assessment under the frozen eligibility criteria.** The
rule is deliberately conservative in one direction only: it prevents automatic *exclusion* without
producing automatic *inclusion*. A name field does not prove the form is a registration — it means
the detector must not decide, and the candidate-set approval and attempt-approval gates continue to
control what enters the corpus. This is what stops a stray "already have an account? Log in" link
discarding the highest-priority category unseen.

Eight tests: a visible contact form with reCAPTCHA captured with the protection recorded and its
`name` field intact in the saved markup; a public registration form with two password fields not
blocked; a challenge interstitial excluded; a real sign-in wall excluded; 401 and 403 excluded;
nothing typed or submitted on a form the harness now keeps; a registration form beside a sign-in
invitation not excluded; and a login form with no name field excluded. The capture package has 263
tests.

### Scope

**No previous CAPTCHA or password exclusion needs reassessing: the log contains none.** The only
`publiclyReachableWithoutSigningIn: false` exclusion recorded so far is Te Haeata's, which was a
robots disallow, not a challenge. **No FormFair analysis and no capture occurred before this
interpretation was fixed** — the Health feedback page is recorded as a discovery candidate and has
not been captured.

### An interim descriptive observation

Bounded discovery across the first three agencies identified **13 document-based
service-application candidate URLs: nine PDFs and four DOCX files** — five PDFs for Te Puni Kōkiri
via `www.tupu.nz`, four DOCX for the Family Violence and Sexual Violence Executive Board, and four
PDFs for the Ministry of Health. No eligible HTML service-application form has yet been identified.

That is an interim descriptive observation about three agencies, not a prevalence estimate, and the
study has measured nothing about how commonly government contact forms carry bot protection.

## Amendment 25: automated retrievability is not public eligibility

**Dated 26 September 2026.** `capture-v1.0.6`. Moves no earlier tag.

**Triggered by the first held-out automated-retrieval block, before any FormFair analysis and
before the attempt was approved.** The Ministry of Health feedback page — the first eligible-looking
HTML form with a personal-name field in this scan — was served HTTP 403 and a Cloudflare
interstitial when the capture harness requested it. The CLI recorded
`publiclyReachableWithoutSigningIn: false`.

That claim is not supported by the evidence. Probed afterwards in a **fresh context with no stored
site data**, the two modes differ:

```
headless: 403  "Just a moment..."               nameField: false  interstitial: true
headed:   200  "Feedback | Ministry of Health"   nameField: true   maxlength: "255"
```

Changing the user-agent string alone does not resolve the 403 — a plain `curl` and a `curl` sending
a headed-Chrome agent both receive it — so the block is not user-agent matching. That is as much as
the experiment establishes; it does not show what Cloudflare actually detected.

### Three faults behind one record

1. **An unsupported eligibility claim.** An automated client receiving a 403 shows the harness
   could not retrieve the page. It does not show the public cannot reach it.
2. **A stated-versus-actual mismatch.** The politeness policy says "the normal Chromium user agent,
   unmodified and recorded", and the implementation launched default **headless** Chromium, whose
   unmodified agent reads `HeadlessChrome/153`. The recorded agent is what exposed it.
3. **An orphaned capture file.** `capturePage` wrote the rendered document *before* the CLI decided
   whether to exclude, so the interstitial was written to
   `captures/health-govt-nz-feedback.html` — 28,754 bytes titled "Just a moment...", SHA-256
   `c6ad4b95…` — owned by no attempt record. The seal hashes only files the draft names, so it
   would not have been sealed; but a file that looks like corpus material and is not must not sit
   beside the real captures.

### The corrections

**`capture-blocked` is its own outcome.** It states that the harness could not retrieve the page and
makes no claim about public access: every eligibility criterion must be left `null`, which is
enforced, and the attempt must record which browser modes were tried.

**A sign-in wall remains an exclusion.** The two kinds of barrier are now distinguished, because
they mean different things: credentials required is a genuine failure of criterion one, while a
challenge or a 4xx may be bot management. Collapsing them is what produced the unsupported claim.

**One fixed headed fallback.** If headless Chromium is access-barred, the page is attempted once
more with headed Chromium in a fresh context: no persistent profile, no imported cookies, no custom
user agent, no stealth or fingerprint modification, no interaction with any challenge, and nothing
typed or submitted. This is not a bypass — a challenge that never appears is not a challenge that
was answered. If headed is barred too, the outcome is `capture-blocked` and **no further workaround
is attempted**. `browserMode`, the real user agent and both attempts are recorded.

**Markup is written only for a page that is not access-barred**, and a gate requires official
`.html` files and logged `captured` attempts to correspond **one to one** — in both directions. An
orphan makes draft generation fail outright rather than merely withholding the draft.

### The record as it stands

`c-0291` is **rejected and preserved unchanged**, its reason stating that automated retrievability
and public eligibility are different facts. The interstitial is **quarantined**, not deleted, at
`quarantine/health-govt-nz-feedback.cloudflare-interstitial.html` with its original path, hash, byte
count and relationship to `c-0291` recorded beside it. Any replacement attempt must name `c-0291`
via `supersedesAttemptId`.

### The fallback needs a display

Headed Chromium cannot start without one. On a headless CI runner the launch throws, the fallback
degrades to `capture-blocked`, and a page a headed browser could read is recorded as unretrievable —
a property of the environment, not of the page. So a failed launch is recorded in `attemptedModes`
with its error rather than as an access barrier, keeping "barred by the site" and "could not launch"
distinguishable, and CI now runs the capture suite under `xvfb` so the fallback is exercised for
real. A capture recording `browserMode: headed` could not have been produced without a display.

Seventeen tests: headless blocked with headed succeeding yields exactly one official capture recording
both modes; both modes blocked yields `capture-blocked` with eligibility unknown; a blocked response
leaves no file; an orphan is detected in both directions and fails draft generation; a
`capture-blocked` attempt asserting eligibility is refused, as is one not naming its modes; a
rejected attempt is preserved and its replacement must name it; and the capture path is asserted
against its own source to use no stored state, no invented user agent, no stealth plugin, no init
script, no typing and no clicking — because that distinction lives in what the code does *not* do,
which no behavioural test can observe. The capture package has 280 tests.

## Amendment 26: a 200 is not a robots file

**Dated 27 September 2026.** `selection-v1.0.21` and `capture-v1.0.7`. Moves no earlier tag.

**Triggered before any New Zealand Security Intelligence Service discovery record was written, and
before any candidate set was locked.** Agency 4 in the frozen draw order has three frame websites.
All three sit behind Imperva/Incapsula, and two of them answer `/robots.txt` with **HTTP 200 and a
212-byte HTML challenge page**:

```
r-0012  https://www.nzsis.govt.nz/robots.txt               200  text/html  212 bytes
r-0013  https://www.protectivesecurity.govt.nz/robots.txt  200  text/html  212 bytes
r-0014  https://providinginformation.nzsis.govt.nz/robots.txt  404         0 bytes
```

Both 200 bodies are byte-identical, SHA-256 `d0203228…`, and open:

```html
<html><head><META NAME="robots" CONTENT="noindex,nofollow">
<script src="/_Incapsula_Resource?SWJIYLWA=…"></script><body></body></html>
```

`fetchRobotsPolicy` classified them on the status code alone, so both were recorded as disposition
`rules`. `parseRobots` finds no directives in HTML and returns `[]`; `isAllowed` then answers:

```
isAllowed('/user/register') -> { allowed: true, reason: "no applicable rule" }
```

So the log recorded that robots permitted the path, on the evidence of a document that is not a
robots file and says nothing whatever about crawling. **Nine permits were issued on that basis and
all nine requests were made.** Every one returned a challenge page or, on the third host, a 404 or a
client-rendered shell; none returned agency content.

### Why neither existing disposition fits

RFC 9309 §2.3 requires the `/robots.txt` representation to be UTF-8 `text/plain`. A 2xx that is not
one establishes **no policy at all**, and that is a third state:

- not `rules`, because nothing was parsed;
- not `allow-all`, because the host *did* serve something and we cannot read it — and reading a
  challenge page as permission is the defect itself;
- not `disallow-all`, because the host has refused nothing. Recording a refusal the server never
  made would attribute to the agency a decision it did not take.

### `unestablished`

A fourth disposition. It means the host returned something other than a valid robots
representation. It is **not** `allow-all`, **not** `disallow-all`, and **not** an eligibility
finding. Automated discovery is withheld for **every path on that origin except a later
`/robots.txt` recheck** — which stays retrievable under RFC 9309 §2.2.2, or an origin that answered
with a challenge once could never be re-checked. The limitation is reported as **technical discovery
attrition**, and it is cached for no more than 24 hours like any other policy.

A 2xx is classified `rules` only when all three hold:

1. the media type is `text/plain`, parameters such as `charset=utf-8` permitted;
2. the bytes are valid UTF-8;
3. the body is not HTML and not a recognised challenge document.

**An empty `text/plain` robots file is valid and means no rules.** At least one directive is *not*
required: a server may legitimately publish an empty policy, and demanding a directive would turn a
real permissive policy into an unreadable one. The media type is also a claim by the server, so
markup labelled `text/plain` is still `unestablished`; vendor detection names what was served
(Imperva/Incapsula, Cloudflare, Akamai, AWS WAF) but the decision does not rest on it, because HTML
disqualifies a robots representation whether or not the vendor is recognised.

### Three attrition outcomes, because `no-candidates` would have been a false statement

`no-candidates` asserts that a page was read and contained nothing. Said of a page nobody could
read, it converts a failure of the method into a fact about the ministry, and the prevalence
denominator then counts an agency as searched when it was not.

| outcome | request made? | what it means |
| --- | --- | --- |
| `robots-unestablished` | no | no policy could be read, so discovery was withheld. Not a refusal by the host. |
| `retrieval-blocked` | yes | answered with a challenge or refusal. No agency content and no candidate judgement obtained. |
| `retrieval-inconclusive` | yes, successfully | nothing arrived on which a candidate judgement could rest — a client-rendered shell, for instance. The page is neither absent nor empty; this method could not read it. |

`preflight-discovery` now records `robots-unestablished` rather than `disallowed` when no policy
could be established, for the same reason: the two are different findings.

### The nine permits, accounted for and not closed as unused

All nine authorised real requests, so none is `unused` and none is `duplicate-request`. Each is
consumed by a discovery record carrying its **real** navigation timestamp, taken from the retained
response files rather than invented:

- **`p-0084`–`p-0089`** (`www.nzsis.govt.nz` and `www.protectivesecurity.govt.nz`, robots, sitemap
  and home page): `retrieval-blocked`, each recording HTTP status, content type, byte count,
  SHA-256 and the Incapsula signature, and each stating that no agency content and no candidate
  judgement was obtained.
- **`p-0090`–`p-0091`** (`providinginformation.nzsis.govt.nz/robots.txt` and `/sitemap.xml`):
  `unavailable`. Both genuinely returned 404. The robots distinction is kept — RFC 9309 §2.3.1.3
  permits subsequent requests — but those two resources were themselves unavailable.
- **`p-0092`** (`providinginformation.nzsis.govt.nz/`): **`retrieval-inconclusive`, not
  `unavailable`.** The retained response is HTTP **200** with a genuine client-rendered application
  shell — `<script src="static/main.min.js">`, a websocket parameter block, release `v1.2.0-rc1` —
  and no Incapsula markup. The assumption that all three of this host's requests returned 404 does
  not hold for the home page, so recording it as `unavailable` would have been false.

### Recording a real past navigation

The previous rule refused to consume a permit issued more than an hour earlier, whatever the
navigation time said. That conflated two different things: the permit's life governs the **request**,
while writing the record down later is a **disclosure** problem. Under the old rule these nine
navigations — each made seconds after its own permit — became impossible to record once an hour had
passed, and would have stayed permanently unaccounted for.

So a navigation is accepted when `issued ≤ navigatedAt ≤ issued + 1h`, whenever the record is
written, and the delay is **disclosed**: `permitAudit` reports `recordedLate` and the affected
records, **derived** from consumption time against the recorded navigation time rather than stored,
so it cannot be omitted by a writer. Consuming a stale permit with **no** navigation time remains
refused — with nothing saying when the request happened, consumption time is the only evidence of it.

### Structured deviations

The earlier robots breach was disclosed in a dated note beside the politeness clause. That is
honest but not checkable: nothing verified that the record identifiers it cited existed, and nothing
would notice if a later correction made it false. A deviation is now **data**: append-only, naming
its robots checks, permits and attempts, validated against the log at write time *and* at every
gate, published with the provenance. A deviation naming a permit that does not exist is refused, and
one asserting that no candidate evidence was obtained while naming a record that reports
`candidates-found` is refused. A disclosure nobody can check is worth less than none, because it
also buys credit.

`v-0001` records this one: robots checks `r-0012` and `r-0013`, permits `p-0084`–`p-0089`, the six
requests made under the invalid permissive interpretation, and that none yielded candidate evidence.
The historical records are **not rewritten**.

### Capture integrity (`capture-v1.0.7`)

Four items identified with Amendment 25 and not closed by it. Only the weak assertion was fixed
then, in `4835aed`.

**The result is reclassified after the fallback.** The CLI decided what the barriers meant from the
*headless* attempt and then ran the headed retry, never revisiting the decision. A headed attempt
that got past a challenge and revealed a **sign-in wall** therefore matched no branch at all — the
sign-in test was already behind it, `capture-blocked` tests for a non-auth barrier and none was
left — and execution reached the adoption branch with a record carrying a barrier, no file and no
hash, where it died inside validation. A page whose ineligibility the harness had in fact
established could not be written down, and the failure looked like a bug in the log. The decision is
now one function of the final record, so it cannot drift out of order, and that combination is a row
in a table rather than a path nobody could reach.

**Every capture file is hashed against its logged digest.** Correspondence by filename established
that a file with the right name existed and nothing about its contents, so a capture edited,
truncated or replaced afterwards passed every gate and would have been sealed under a hash it no
longer had.

**No refusal after the write leaves an orphan.** `capturePage` writes the markup as soon as the page
is readable, and HTTP 429 then stopped the run with `die()` — leaving the file in the captures
directory, owned by nothing, which blocked every later build with a complaint about an orphan whose
origin nothing recorded. A 429 is now recorded as a `failed` attempt making no judgement about the
page, and the file is **quarantined** — preserved, because it is evidence of the response — as is
any file whose adoption is refused for any other reason.

**`capture-blocked` is counted.** It appeared in neither `status` nor the published provenance, so
the printed columns did not sum to the total above them and a page the harness could not retrieve
appeared nowhere in the audit. `status` now also prints `discovery`, so the lines add up.

**And the capture path now reads the *recorded* robots policy.** It kept a per-process `robotsFor`
of its own, which re-requested `robots.txt` on every invocation without recording it, treated an
unreachable file as absent and therefore permissive, and read a 200 as a policy whatever it
contained. Discovery had all three defects fixed in turn while capture still had every one — the
same rule enforced in one place and not the other, which is how this scan keeps rediscovering one
class of hole.

### What this does not establish

Nothing here says anything about whether NZSIS publishes forms with name-field constraints, or
whether a member of the public can reach them. Two of its three origins could not be searched by
this method at all, and the third's home page could not be read without executing its application.
That is attrition in the instrument, and it is reported as attrition.

## Amendment 27: attempted is not searched

**Dated 27 September 2026.** `selection-v1.0.23` and `solo-protocol-v1.0.4`. Moves no earlier tag;
`capture-v1.0.7` is unchanged.

**Recorded before the first agency could reach exhaustion under it.** Amendment 26 gave individual
discovery records three attrition outcomes, because `no-candidates` would have said a page was read
and empty when nobody could read it. The same collapse sat one level up, in the agency-level
outcome, and it was still there:

```
EXHAUSTION_REASON =
  'all four categories in the frozen priority order were searched and none yielded an eligible form'
```

One frozen string, asserting a completed search. For the New Zealand Security Intelligence Service
that is false. Two of its three frame websites answer every request with an Imperva/Incapsula
challenge; those categories were **attempted**, not searched. Filing the agency under that reason
would have put a completed search into the denominator of every prevalence figure in the study, on
the strength of requests that returned no agency content — and the exhaustion record is precisely
what makes the denominator "agencies searched" rather than "agencies with a form".

### Two frozen resolutions

> **Superseded by Amendment 28 (27 September 2026).** The resolution named here was
> `searched-in-full`, carrying the reason "all four categories in the frozen priority order were
> searched and none yielded an eligible form". That was itself an overclaim and has been renamed to
> `bounded-discovery-complete` with new wording; see Amendment 28. The paragraph below also said of
> a 404 and a `Disallow` that "both were read", which is true only of the 404 — where a `Disallow`
> was honoured, what was read is the robots **policy**, not the target page. The reasoning about
> *why* two resolutions are needed stands; the names and the wording do not.

| resolution | reason |
| --- | --- |
| `bounded-discovery-complete` | the frozen bounded discovery procedure was completed for all four categories in the priority order, and no eligible form was located |
| `technical-discovery-attrition` | technical retrieval barriers prevented the frozen bounded discovery procedure from completing, and no eligible form was located |

The completed resolution is the narrower claim it always purported to be: it may be used **only**
where the frozen procedure ran to completion for every category.

### Derived, never typed

The resolution is computed from the discovery records **bound to the agency's four locked sets**,
excluding superseded ones. A withdrawn finding is not evidence; a record no set claims is not part
of the round the exhaustion rests on. If one bound active record carries `robots-unestablished`,
`retrieval-blocked` or `retrieval-inconclusive`, the resolution is `technical-discovery-attrition`.
One is enough: an agency whose discovery was blocked anywhere was not searched in full, and where
the two readings differ the honest one is the weaker.

`unavailable` and `disallowed` are **not** attrition. A 404 says the resource is not there; a
`Disallow` says the host forbids it, and honouring it is part of the planned boundary rather than a
barrier that defeated the method. In the first case the resource was read; in the second the **robots
policy** was read and the target page deliberately was not. Both are findings, and neither is a
failure of the instrument.

`exhaustAgency` takes no reason and no resolution from its caller, and `exhaust` **refuses**
`--reason` and `--resolution` outright rather than merely not offering them. A reason an operator
can choose is a reason an operator can choose wrongly, and this one decides what an agency's
absence from the corpus means. A `technical-discovery-attrition` record must name the supporting
records; a completed-procedure record must name none.

### Checked where it is written and where it is trusted

Four gates, because the failure this guards against is not a bad write — `exhaustAgency` derives,
so it cannot write a wrong resolution — but a **round corrected after the exhaustion**, which can
turn a true record false:

1. `corpusBlockers` reports any exhaustion whose stored resolution its bound evidence no longer
   supports, and withholds the draft.
2. `deriveDraft` normalises a legacy record with no `resolution` to the completed resolution, which is
   exactly what it asserted — and gate 1 refuses the draft if that claim is now untrue, so the
   normalisation cannot quietly promote an attrition round into a completed search.
3. The seal validates the resolution, requires the frozen reason **for that resolution**, and
   requires attrition evidence for the weaker one.
4. The seal then **re-derives** the resolution from the capture log's own bound records and refuses
   a mismatch. Matching the log's exhaustion entry is not enough: a record can agree with the log
   and still be false about the world.

### Counted apart

`status`, `next`, the corpus draft, the sealed manifest and the published provenance all report the
two separately. Nothing sums them into one "agencies searched" figure, because they are not the same
kind of fact: one is evidence about an agency, the other is evidence about the instrument.

`next` also states which resolution *will* be recorded before `exhaust` is run, rather than after.

### Two duplications, both checked

`evaluation/` is dependency-free by design, so the reason strings, the resolutions and the attrition
outcomes are restated there and a test asserts the two packages' constants are identical. The same
test now also asserts `SOLO_PROTOCOL_TAG` equals `SOLO_SEALER_TAG`, which is how the sealer came to
declare a protocol version it did not implement once before.

### One wording fix in the packet

The approval packet's heading read "9 inspections". Six of those nine records inspected no agency
content — they record that a request was refused. It now reads "discovery records", and where any
yielded nothing to judge it says so per outcome. The count excludes `unavailable`: that resource was
read, and was simply not there.

### What this does not establish

NZSIS has not yet reached exhaustion; only its `account-registration` round is settled, approved
with zero candidates under a technically incomplete search. When and if it does reach exhaustion, it
will resolve as `technical-discovery-attrition` and will sit outside the searched denominator. That
is a limitation of the instrument against bot-managed hosts, not a finding about the agency.

## Amendment 28: what completed, and what the evidence is

**Dated 27 September 2026.** `selection-v1.0.24` and `solo-protocol-v1.0.5`. Moves no earlier tag.
No new capture tag: shared browser-capture behaviour is unchanged, and `capture-v1.0.7` stands.

Two corrections, both to claims this protocol was making about its own thoroughness.

### 1. `searched-in-full` → `bounded-discovery-complete`

Amendment 27 replaced one overclaiming reason with two, and one of the two overclaimed in the same
way. The procedure is **bounded** by design: five candidates per category, twenty per agency, four
methods, a frozen term list, and a robots-disallowed URL that is **deliberately never retrieved**.
"Searched in full" says an agency's web presence was exhaustively examined. What actually ran to
completion is a fixed procedure.

| resolution | reason |
| --- | --- |
| `bounded-discovery-complete` | the frozen bounded discovery procedure was completed for all four categories in the priority order, and no eligible form was located |
| `technical-discovery-attrition` | technical retrieval barriers prevented the frozen bounded discovery procedure from completing, and no eligible form was located |

A robots-disallowed URL remains **non-attrition**, because honouring the `Disallow` is part of the
planned boundary rather than a barrier that defeated the method. But Amendment 27's defence of that
said "both were read" of a 404 and a `Disallow`, and only the first is true: where a `Disallow` was
honoured, what was read is the **robots policy**, not the target page. Both amendments are corrected
in place, with the superseded wording quoted rather than deleted.

**Renaming a frozen reason strands every exhaustion already recorded.** The Family Violence and
Sexual Violence Executive Board was exhausted on 25 September under the withdrawn wording, and the
seal requires the reason frozen for the resolution — so that record simply stops sealing. Editing it
would rewrite what was decided; accepting the old wording as equivalent would make the correction
cosmetic. So `re-resolve` archives the prior record with the reason it was superseded for and writes
a freshly **derived** replacement. `exhaustedAt` is preserved and `reResolvedAt` recorded separately,
so the manifest still says when the agency was searched rather than when its record was rephrased. A
record carrying superseded wording is reported by the corpus gate and refused by the seal; it cannot
reach a manifest.

### 2. The rendered DOM is the authoritative discovery evidence

Every discovery inspection in this scan until now was a plain HTTP fetch, while the capture step
drives Chromium and executes JavaScript. That asymmetry is a **selection bias**, not a detail: a form
inserted by script is invisible to discovery and perfectly capturable, so a client-rendered
service-application form would have been recorded as `no-candidates` — the same false statement
`no-candidates` would have made about an Incapsula challenge page.

**The rejected alternative.** The first proposal was to render only where a plain fetch returned
something "script-driven with no form". That trigger does not hold. A raw page can carry a search
box, a cookie banner or a login form while script inserts the personal-name form later, and such a
page escapes the trigger entirely — so the bias would survive inside the rule meant to remove it.

**The rule is therefore unconditional.** For a permitted HTML **navigation** or **internal-search**
page, the rendered DOM is the authoritative discovery evidence. Plain retrieval remains the right
evidence for `robots.txt`, sitemaps, status codes and non-HTML files: there is no DOM behind a 404,
and a `Disallow` means there must not be one.

Renders run under the same discipline as captures: a fresh single-use permit, five seconds between
navigations, a fresh context with no persistent profile and no imported cookies, the unmodified
Chromium user agent, 1280×800, `en-NZ`, a 2000 ms settle — and **nothing typed, clicked or
submitted, and no challenge answered**. A render that meets an access barrier must be recorded
`retrieval-blocked`; the harness decides that mechanically rather than accepting a label for it.

**The rendered bytes are private.** They are third-party markup and stay in the ignored data tree,
beside the captures rather than among them. Only the hash, the byte count, the DOM-node count, the
link and form counts and the browser provenance are published.

**Originals are preserved.** A rendered inspection names the plain-retrieval record it answers
through `rendersDiscoveryId`, and that record stays exactly as written — it was true about the method
it used. This is deliberately *not* `supersedesDiscoveryId`, which requires the same category: the
first real use is a **service-application** render of a page first inspected under
**account-registration**, so the link must cross categories, and it is not a correction. If a render
changes a candidate set, the set is **rejected and superseded**, never edited.

### The retrospective backlog, derived rather than counted

The obligation is computed from the log, because a list counted by hand goes stale the moment a
record is added. `renderBacklog` returns the active navigation/internal-search records whose outcome
is a judgement about page **content** (`candidates-found`, `no-candidates`,
`retrieval-inconclusive`), that navigated, that are HTML, and that the robots policy in force does
not forbid. It withholds the corpus draft.

**As at this amendment: 99 records across 59 unique URLs** — Te Puni Kōkiri 43, Family Violence and
Sexual Violence Executive Board 24, Ministry of Health 31, NZSIS 1. One render answers every record
naming that page, so the work is 59 renders, not 99.

Two figures quoted when this correction was requested do not reproduce: the review pool was given as
74 active navigation/internal-search records with 66 conclusive. **74 is the `sitemap` method count**
in the published provenance, not a navigation figure. The actual counts are above.

Two exclusions were added after the first version of the backlog demanded work it should not have:

- **A robots-forbidden page is not in the backlog.** Six `disallowed` and two Incapsula-blocked
  records were in the first list, and a gate demanding those renders could only have been satisfied
  by ignoring robots — worse than the bias it was added to remove.
- **An origin with no recorded policy, or a policy over 24 hours old, stays in the backlog** with a
  stated prerequisite. Treating a missing policy as an exemption shrank the obligation from 99
  records to 32, by quietly losing exactly the ones nobody had checked.

### What this does not establish

No page has been re-inspected yet. Until the backlog is worked, every `no-candidates` record for the
first three agencies rests on plain retrieval, and any script-inserted form on those pages is still
undiscovered. That limitation is in the record and in the gate, not only in this paragraph.

## Amendment 29: the evidence, then the judgement

**Dated 27 September 2026.** `selection-v1.0.25` and `solo-protocol-v1.0.6`. Moves no earlier tag.
No new capture tag: shared browser-capture behaviour is unchanged.

Amendment 28 made the rendered DOM the authoritative discovery evidence. The workflow around it had
four defects, and the first one had already caused a false record.

### 1. Rendering and judgement are separate steps

`render-discovery` required `--outcome` **before the page was rendered**. So the judgement was typed
first and the evidence read afterwards — and that is exactly how `d-0306` came to record
`no-candidates` about a page carrying First, Middle and Last name inputs.

- **`render-discovery`** performs and records an **observation**. It concludes nothing, and
  `--outcome` is now *refused* with the reason.
- **`classify-render`** records a category-specific judgement afterwards, making no request.

An observation may record only `rendered` or `retrieval-blocked` — the latter decided mechanically
from the access barriers, never accepted as a label. A judgement may record only `candidates-found`
or `no-candidates`, must state `navigationPerformed: false`, and **must not name a permit**: naming
one would claim a second retrieval that did not happen.

### 2. One render, several judgements

Rendered evidence lived on the discovery record that produced it, so one render answered exactly one
record. A page is routinely `no-candidates` for account registration and `candidates-found` for
service application, and that was inexpressible.

Observations now go into an append-only **render registry** (`log.renders`, `g-NNNN`), and judgements
cite a render by id. The evidence is recorded once; as many category-specific judgements as the page
supports rest on it.

**A related defect, worse than the first.** The backlog cleared a record the moment any later record
*named* it. That is why `d-0301` left the backlog while still reading `retrieval-inconclusive`, with
no account-registration judgement ever made about it. **Naming is not answering.** A record is
answered only by a judgement, for its own category, resting on a render of its page. The test that
existed merely confirmed the grouping; it never proved one render cleared two records, and it now
does — in both directions, including the case where it must *not*.

### 3. `correct-discovery` was an integrity bypass

It could mint a modern record with **no permit**, which the ledger read as a pre-permit legacy
record, and it copied whatever evidence fields the target happened to carry — including none. A
correction resting on nothing is not a correction; it is a fresh assertion wearing the target's
provenance.

A correction now requires all of: `supersedesDiscoveryId`; `evidenceFromDiscoveryId`; a registered
render whose file is on disk with the recorded length **and** digest; that render's URL canonically
equal to the target's; a target not already superseded; a category-specific outcome; and the explicit
record type `judgement-only`.

And the ledger no longer treats every permitless record as legacy. A record claiming a navigation
with no permit is exempt **only if it predates the permit model** — which a new record cannot fake,
because the five-second pacing check compares it against the latest navigation in the log.

### 4. Render digests were written and never read

Nothing re-hashed anything under `rendered/`. A file edited, truncated or deleted would leave a
convincing hash-shaped claim in the log and every gate would pass — the same defect the corpus
captures had before their bytes were compared, in the directory that had just become load-bearing for
discovery.

One shared validator, called from four places: classification and correction (before anything is
concluded), `corpusBlockers`, provenance publication, and the seal. It verifies the file exists, its
length matches, its digest matches, that no judgement rests on a challenge document, and that every
citation names a registered render of the page it judges. Records written *before* the registry carry
the file and digest on themselves and are checked the same way, because a hash nobody re-reads is
decoration whether or not a registry holds it.

**Fail-closed.** If renders exist and no capture root was supplied, the gate reports that the
evidence *could not be verified* rather than passing. "Could not check" must not read as "checked and
fine".

### Also: the permit is checked before the browser opens

`render-discovery` consumed its permit *after* the render, so an expired, closed or mismatched permit
was discovered only once the request had been made. `assertPermitUsable` runs the same checks —
existence, not consumed, not closed, scope, TTL, and a robots policy under 24 hours old — before
`page.goto`. A permit is a precondition of traffic, not a comment on it.

### The extractor

Controls are counted across the whole document, because the NZSIS portal has no `<form>` element at
all. Two further corrections: `type="hidden"` is compared **case-insensitively** (`type="HIDDEN"`
would have been counted as a field a person fills in), and each control now carries its
**accessible name** — `aria-label`, `aria-labelledby`, `<label for>`, a wrapping `<label>`, or, marked
`nearby:`, the closest preceding text. Counts and ids alone showed `q7`, `q8`, `q9` without saying
they mean First, Middle and Last name, which is the whole point of looking at a name field. No rule is
applied to the text; it is recorded so a reader of the log can see what was asked for.

### The NZSIS record as it stands

`d-0306` and `d-0307` predate the registry. The render they carry is verified against disk and
adopted as **`g-0001`** (`efe26268…`, 15,971 bytes, 224 DOM nodes, *"Reporting a national security
concern"*), and both remain readable exactly as written.

| record | category | outcome | evidence |
| --- | --- | --- | --- |
| `d-0301` | account-registration | `retrieval-inconclusive` | plain fetch; **preserved** |
| `d-0308` | account-registration | `no-candidates` | `g-0001`, supersedes `d-0301` |
| `d-0306` | service-application | `no-candidates` | **preserved**, superseded |
| `d-0307` | service-application | `candidates-found` | supersedes `d-0306` |

One render, two categories, opposite judgements — which is the case Amendment 28 could not express.
The page is not an account registration: no sign-up, no credential field, no account, and the
personal-information section is optional. It **is** a service-application candidate.

The retrospective backlog is now **98 records across 58 URLs**.

### What this does not establish

Nothing about the NZSIS form's constraints. The `maxlength="100"` on its name fields is visible in the
rendered evidence and is not a finding: it has not been captured, sealed or analysed, and the
candidate set is not yet approved.

## Amendment 30: what the obligation actually is, and who may discharge it

**Dated 27 September 2026.** `selection-v1.0.26` and `solo-protocol-v1.0.7`. Moves no earlier tag.
No new capture tag.

Four defects that only the live data exposed.

### 1. The backlog counted withdrawn work

Reported as 98 records across 58 URLs. **Thirty-four of those records belong to superseded candidate
sets** — rounds that were rejected and redone, whose evidence the corpus no longer rests on.
Re-rendering them would be traffic spent confirming findings already withdrawn.

`renderBacklog` now counts only records bound to a **current** candidate set. The obligation is:

| | |
| --- | --- |
| active records | **66** |
| unique URLs to render | **57** |
| distinct origins | **12** |
| origins needing a robots check or refresh | **12** |

All three of the reviewer's figures reproduce exactly. One correction to the review: **34** records
belong only to superseded sets, not 32 — 66 + 34 = 100 records in scope. The earlier total of 98 was
taken before `d-0301` and `d-0306` were superseded, which moved the in-scope count.

So the retrospective work is 57 renders and 12 robots requests, not 57 robots requests.

### 2. An approved set was resting on withdrawn evidence

The approved NZSIS `account-registration` set still bound `d-0301` after `d-0308` superseded it, and
the replacement was bound to nothing. **The corpus gate said nothing**, because `supportingRecords`
checks that every bound id *exists* — and a superseded record still exists.

`staleSetBindings` now reports any set binding a superseded record, and withholds the draft.
`re-resolve-set` repairs one: append-only, archiving the previous binding with its approval, its
reason and the time, substituting the record at the **end** of the supersession chain, refusing a
binding that would still contain a superseded record, and returning the set to **pending**. An
approval is a judgement about particular records, and these are not those records, so it must be
given again.

**And `d-0308` cited the wrong evidence source.** It named `d-0301` — the *plain fetch* — as where its
rendered evidence came from. The cause: `correct-discovery` fell back to the correction target when a
pre-registry render had no observation record. `g-0001` was adopted from `d-0306`, and `adoptedFrom`
says so, so it is now asked rather than guessed. `d-0309` corrects the citation with the judgement
unchanged; `d-0308` is preserved. A correction may now correct either the judgement or the citation,
but must change one of them.

### 3. A judgement could clear another agency's backlog

`renderedJudgements` keyed answers by **canonical URL and category only**. A third-party form linked
by two agencies is genuine evidence for both, and each agency's round is separate work with separate
provenance — so a judgement recorded under agency A cleared agency B's entry for the same page.

A judgement now carries an explicit **`answersDiscoveryId`**, and clears that record only if it names
it *and* matches its agency, category, round and canonical URL, *and* cites valid rendered evidence.
Checked at write time and again at the gate. One render still supports several judgements; each
judgement answers its own record.

### 4. Trust-time validation was incomplete, and duplicated rather than shared

The protocol claimed one shared validator. It was two, and the sealer's was the weaker: it verified
bytes and URLs and **none of the semantics**, so a judgement resting on a challenge document, naming
the wrong evidence source, or answering another agency's record sealed cleanly.

One rule set now covers: path confinement; bytes and length; observation-versus-judgement record
types; `evidenceFromDiscoveryId` naming the record that actually introduced the render; exactly one
active observation per render (and none orphaned); the exact answered record with agency, category,
round and page agreement; and no judgement resting on an access-barred render.

Because `evaluation/` must not import `capture/`, the rules still exist twice — but a **conformance
test drives both implementations over one table of 24 adversarial ledgers [**25** — see the Count
erratum of 27 September 2026] and requires identical
verdicts**. Verdicts are compared, not wording: two packages phrasing a problem differently is fine,
two disagreeing about whether it *is* a problem is the defect the test exists to catch.

**Both implementations allowed `../` escape.** A render file named
`../captures/health-govt-nz-feedback.html` read a corpus capture and **verified happily against its
own digest** — which is precisely why a hash check alone confines nothing. A render file must now be a
plain basename resolving inside `rendered/`; absolute paths, traversals and nested paths are all
refused, in both packages, for registry entries and for pre-registry records alike.

### Also: the permit is checked against the page it authorises

`assertPermitUsable` verified that *a* policy existed and was fresh. It now also requires that the
policy belongs to the **request's own origin**, that it still permits **that exact path** — a path
disallowed by a policy re-read since would otherwise have been fetched — and that neither the permit
nor the robots check is stamped in the **future**.

### The NZSIS record as it stands

| record | category | outcome | evidence |
| --- | --- | --- | --- |
| `d-0301` | account-registration | `retrieval-inconclusive` | plain fetch; preserved |
| `d-0308` | account-registration | `no-candidates` | `g-0001`, cites `d-0301` as source — **wrong**, preserved |
| `d-0309` | account-registration | `no-candidates` | `g-0001` from `d-0306`; citation corrected |
| `d-0306` | service-application | `no-candidates` | preserved, superseded |
| `d-0307` | service-application | `candidates-found` | supersedes `d-0306` |

The `account-registration` set is re-bound from `d-0301` to `d-0309` and is **pending approval again**.
The `service-application` set remains approved with one candidate.

### What this does not establish

Nothing about the NZSIS form. It has not been captured, sealed or analysed, and 66 records across 57
URLs still rest on plain retrieval.

## Amendment 31: a recognised word is not a shape

**Dated 27 September 2026.** `selection-v1.0.27` and `solo-protocol-v1.0.8`. Moves no earlier tag.
No new capture tag.

Amendment 30 put one render-ledger rule set behind both packages and proved they agreed. **They
agreed on an incomplete rule**, which is the one failure a conformance test cannot find by itself: two
implementations enforcing the same gap enforce it perfectly.

The ledger checked that `recordType` held a **recognised word**, and nothing about whether the record
was shaped like one. Three states passed both validators with zero problems:

**An active judgement relabelled as an observation, with its evidence source deleted.** `d-0309` was
changed to `recordType: 'observation'` and its `evidenceFromDiscoveryId` removed. It still reported
`no-candidates`, still claimed no navigation occurred, still answered `d-0301`, still cleared that
item from the backlog — and both validators reported nothing. Five checks now refuse it.

**A render naming the wrong permit.** `g-0001` was changed to name `p-0001` instead of `p-0093`.
Accepted by both. The traffic behind the evidence was therefore unaccounted while the evidence itself
verified perfectly.

**A record carrying a digest that disagrees with the registry.** Two claims about the same bytes, with
nothing saying which governs.

### What each record type may contain

**An observation** records only `rendered` or `retrieval-blocked`; performed a real navigation, with a
timestamp; names a permit that exists and is **consumed**; names **no** evidence source, because it
*is* the evidence; and answers nothing, because it concludes nothing.

**A judgement** records only `candidates-found` or `no-candidates`; names **no** permit, because it
makes no request; states `navigationPerformed: false`; cites valid rendered evidence; and where it
resolves a prior record, resolves exactly one — answering one record while superseding another leaves
it unclear which was resolved.

**A registry render** names a permit that exists, is consumed, and authorised **that page** — and it
must be the permit the record that introduced it actually used, not merely some consumed permit.

**One authority for the bytes.** A record may repeat the registry's file name, digest and size for
readability, but a copy that *disagrees* must be refused or removed. Two claims about one file with no
stated precedence is not redundancy; it is ambiguity.

All of it is enforced in **both** implementations and at trust time, not only where the values are
written. This is the fourth time in this scan that the defect has been precisely "the rule is checked
where it is written and not where it is trusted", and it is now the fourth place it has been closed.

### The conformance table

Nineteen further cases, bringing it to **44** — the figures first published here were "twenty-one"
and "47" and were both wrong; see the Count erratum of 27 September 2026. The new cases are the
relabelling attack itself, each observation constraint, each judgement constraint, the three permit
cases, and the three disagreeing-copy cases plus a matching copy that must be *accepted*. The floor
assertion rises from 15 refusals to 35, so the table cannot quietly become permissive.

### What this does not establish

Nothing has been captured. The retrospective backlog stands at **66 records across 57 URLs on 12
origins**, and none of it is done: the 12 robots checks only unlock the work. A capture taken now could
preserve a page that the retrospective renders later show should not have been selected, so the order
is robots checks, then all 57 renders, then the 66 category judgements, then re-binding and
re-approving affected sets, then re-confirming the selected page and category ordering for agencies
1–4 — and only then the NZSIS capture.

## Count erratum, 27 September 2026

**`solo-protocol-v1.0.9`.** Moves no earlier tag. No selection or capture tag: nothing about the
scan's behaviour changes, and no evidence was collected under the wrong figures.

Four published counts of the render-ledger conformance table were wrong. The table is checked by
machine; the *number* of cases in it was not, so it was repeatedly asserted from memory.

**The table as it actually stands:**

| | |
| --- | --- |
| cases | **44** |
| of which acceptable | 5 |
| of which refused | **39** |
| tests Node reports | **45** — the 44 cases plus the non-vacuity test |

**And as it stood at Amendment 30 (`8b263c1`):** 25 cases, 21 refused. So Amendment 31 added
**19** cases, not twenty-one.

**Every wrong figure, and where it is:**

| where | said | actual |
| --- | --- | --- |
| Amendment 30, in this document | 24 adversarial ledgers | 25 |
| commit `8b263c1` message | 26 adversarial ledgers | 25 |
| Amendment 31, in this document | twenty-one further cases | 19 |
| Amendment 31, in this document | bringing it to 47 | 44 |
| tag message `solo-protocol-v1.0.8` | 47 conformance cases | 44 |

The two figures in this document are corrected in place with the superseded values quoted. **The
commit message and the tag message are not rewritten and the tags are not moved** — they are the
record of what was said at the time, and correcting them by force would defeat the point of freezing
them. This table is where a reader finds the true counts.

Nothing else in Amendments 30 or 31 is affected: the rules, the attacks and the verdicts are
unchanged, and the floor assertion of 35 refusals still holds with room to spare at 39.

**The guard that was missing.** A count printed in prose and checked by nobody is decoration, which
is the same objection this protocol has made to unread hashes and unread digests. The conformance
suite now asserts its own size — the number of cases, the number of refusals, and that the two halves
sum to the whole — so a future miscount fails a test instead of reaching a tag message.

## Amendment 32: the permit boundary was one hop deep

**Dated 27 September 2026.** `selection-v1.0.28`, `capture-v1.0.8` and `solo-protocol-v1.0.10`.
Moves no earlier tag.

**Recorded before the fifty-seven retrospective renders, not after.** `page.goto` follows redirects
itself, so a permit and a policy check covering the requested URL covered nothing beyond it.
Reproduced against `selection-v1.0.27`:

```
requested   /allowed          (permitted by robots)
server hits ["/allowed", "/forbidden"]
finalUrl    /forbidden        (Disallow: /forbidden)
httpStatus  200
controls    1                 the disallowed page rendered, name field and all
```

None of the sixty-six historical backlog records carries a `finalUrl`, so nothing proved the
fifty-seven pages about to be rendered would not do exactly this.

### Two obvious fixes that do not work

**`page.route` is not called for a redirected request.** Playwright invokes the handler for the
request it intercepts and then follows redirects internally. Measured: the handler saw `/allowed` and
never `/forbidden`, which reached the server anyway.

**Fulfilling the 3xx is worse.** Chromium follows a fulfilled redirect *without* interception, so the
destination is requested and the handler is not consulted. Both were built and both leaked. Checking
the chain after `goto` returns is later still: by then the forbidden page has been served.

So the check sits where the decision actually is — the **response stage of the document request**,
through CDP `Fetch`. Chromium hands over the 3xx before acting on it; a refusal fails the request and
the target is never asked for. Measured with the guard in place: `server hits ["/allowed"]`.

### The rule

Every **top-level** redirect target is checked against the **recorded** policy before it is
requested. The guard never fetches: a render is authorised by a permit issued in advance, so reaching
for a fresh policy mid-navigation would be traffic no permit covers. A target is refused when its
policy is missing, stale beyond 24 hours, `unestablished`, or disallows the path — and when no policy
source was supplied at all, which is the fail-closed default.

Scope is the main frame. An iframe is a subresource the page fetches, and failing a render because an
embedded third party redirects to an origin whose policy we have not recorded would refuse pages for
a reason that has nothing to do with the page.

The chain is recorded per hop — `from`, `to`, status, the verdict and **the identity of the robots
check that decided it** — so a reader can re-verify the decision. Full target URLs are recorded rather
than sanitised to origin-plus-path, unlike outstanding subresource requests: a redirect target is a
URL the server chose, and stripping the query would make the robots decision impossible to check.

**The same rule in the capture path.** A capture that followed a redirect to a disallowed path would
put a page in the *corpus* that robots forbade — worse than a discovery inspection doing it, because
the corpus is what gets analysed and published. A refused capture writes no file, claims no
eligibility, and is recorded `excluded` with the chain.

### Two flaws found while building it

**The hop counter was bypassed.** A redirect back to the authorised URL needs no second *policy*
decision, and the first version skipped the counter for that case too — so a loop between the
original URL and another path was never bounded here. Chromium hit its own redirect limit instead,
which means the refusal came from the browser and the log carried no reason for it. Every hop is now
counted; only the policy decision is skipped.

**A refusal could not be recorded.** The duplicate-URL rule refuses a second record for a page
already inspected in that round — which is every URL in the retrospective backlog. A refused
retrieval is an **attempt**, not a finding, so it now shares the observation side of that split. The
rule exists to stop one page being recorded twice as two findings.

### An unreachable page discharges its obligation as attrition

A page that redirects to a disallowed target can never be rendered, so demanding its render would
withhold the corpus draft for ever. A recorded refusal — keyed on an explicit `renderRefused` flag, so
an ordinary `disallowed` record cannot quietly excuse a page nobody tried to render — discharges that
URL's backlog entry as **technical attrition**, and only that URL's.

### Tests

Nine, and in every one the assertion that matters is the **destination server's request log**: a
refusal that still lets the request leave is not a refusal, and that is exactly where the two earlier
designs failed. A disallowed same-origin target, an origin with no recorded policy (which is never
contacted at all, not even for its robots file), a permitted redirect that must still work, a page
that does not redirect, the fail-closed default, a redirect loop, and both capture paths.

### What this does not establish

Nothing is rendered or captured yet. The backlog stands at **66 records across 57 URLs on 12 origins**,
all twelve policies fresh and valid, and how many of the fifty-seven redirect is still unknown — which
is the point of fixing this first.

## Amendment 33: a discharge must carry the evidence that discharged it

**Dated 28 September 2026.** `selection-v1.0.29`, `capture-v1.0.9` and `solo-protocol-v1.0.11`.
Moves no earlier tag. Still before any render.

Amendment 32's guard works. The gate it added to stop the guard creating an unsatisfiable obligation
did not, in two ways.

### 1. The boolean was trusted

Adding `renderRefused: true` to `d-0018` — one line, no redirect chain, no permit, no navigation —
removed it from the backlog. **Both ledgers reported zero problems.** A boolean that discharges an
obligation is a way of saying "skip this" unless it carries the evidence that the obligation was
discharged.

`renderRefused` is now validated wherever it is trusted, in both packages. It requires: a **consumed**
permit covering the same agency, category, round **and URL**; a real navigation timestamp;
`navigationPerformed` not false; and a **continuous** redirect chain — first hop leaving the record's
own URL, each later hop leaving where the previous arrived — whose **last** hop was refused and whose
earlier hops were all allowed, because a chain that was refused in the middle should have stopped
there. `renderRefused: false` is refused outright: it is `true` or absent.

An unevidenced flag now discharges nothing, and is reported.

### 2. A temporary prerequisite was treated as permanent attrition

A refusal caused by a **missing** destination policy discharged the URL for good. Recording a fresh
policy that *permitted* the destination did not bring it back.

Missing, stale and `unestablished` are not terminal — they are reasons to fetch a policy and try
again. So the final refused hop is re-evaluated against the policy in force **now**:

| destination policy now says | discharges? |
| --- | --- |
| no recorded policy | **no** — unchecked is not unreachable |
| policy older than 24 hours | **no** |
| `unestablished` | **no** — we could not read a policy, the host did not refuse us |
| permits the target | **no** — the render should be retried |
| disallows the target | **yes** |

A redirect **loop** and an **unusable target** are terminal whatever any policy later says, because
they are properties of the redirect rather than of a policy.

So a URL retired as attrition returns to the backlog the moment a policy says it may be read, and the
only permanent discharges are a confirmed disallow under a fresh policy, a loop, or a target that is
not a URL.

### And the chain contradiction

Amendment 32 said every hop is recorded. A redirect back to the originally authorised URL was
**counted but left out of the chain** — so the claim was false, and the continuity check above would
have been unsatisfiable for any page that bounces through its own URL. Every hop is now recorded,
with the returning one marked as already covered by the permit; only the policy *decision* is skipped
for it.

### Tests

Both attacks are now tests, the first stated at the length it was exploited — one line. Plus a
well-formed refusal that must be **accepted**; stale and `unestablished` destinations; loops and
unusable targets as terminal; four broken-chain shapes; a missing permit, a permit for another page,
an unconsumed permit; `renderRefused: false`; and the returning-hop chain. Seven further conformance
cases bring that table to **51**, of which 45 are refusals.

### What this does not establish

Still nothing rendered or captured. The backlog stands at **66 records across 57 URLs on 12 origins**.
The twelve policies were fetched on 27 September and must be re-checked where they have crossed the
24-hour boundary before the render pass begins.

## Amendment 34: the two pages the corpus rests on were the two it could not re-examine

**Dated 28 September 2026.** `selection-v1.0.31`, `capture-v1.0.10` and `solo-protocol-v1.0.12`.
Moves no earlier tag.

The retrospective render pass ran: **56 URLs attempted, 54 recorded, 0 redirect refusals.** With the
pilot that is 55 observations across 56 registered renders. Exactly one render's final URL differed
from what was requested, and not by a redirect — `?q=whakapā` → `?q=whakap%C4%81`, percent-encoding
normalisation. So no page in the backlog redirected anywhere, and the Amendment 32 guard never had to
refuse. That is only knowable now.

The twelve policies had 7½ hours of freshness left and were reused from cache throughout: **zero extra
robots requests** for a twenty-minute pass.

### Two URLs were refused, and they were the only two that matter

`www.tkm.govt.nz/contact/` and `www.health.govt.nz/about-this-site/feedback` — the approved captures
`c-0070` and `c-0292`, which are the entire corpus. `appendAttempt` refuses a discovery record for a
URL that already carries a candidate assessment.

That branch exists to refuse a second **judgement** on one page. A discovery record is not a judgement
on a page, so the rule was reaching further than its reason — and it reached exactly the two pages
whose evidence most needed re-examining, because they are the two the selection actually uses. Only a
candidate assessment is now blocked by a prior candidate assessment.

### Both failures left bytes nothing accounted for

The render retrieved its page and wrote the bytes; `appendAttempt` then threw, so `writeLog` never
ran. The permit stayed open, the file stayed in `rendered/`, and **both ledgers reported zero
problems**: `checkRenderLedger` validated the files the log named and never asked what else was in the
directory. `captures/` has had that check since `capture-v1.0.6`.

So `rendered/` gets the same orphan check, mirrored in the sealer, and every step after the bytes are
written now runs inside one guard that quarantines them on failure — as the capture path does.

### Accounting for the two requests

The requests happened. `unused` would assert none was made and `duplicate-request` would assert
another record accounts for one; both are false. A third closure disposition,
**`recording-failed-after-request`**, says what occurred: real authorised traffic that produced no
observation. It must name the quarantined bytes, may not name a discovery record, and counts in
`networkRequestsAuthorised` while counting as no observation.

**The exact navigation time is not reconstructed.** It was lost with the record that failed to be
written. What is known is a **window** — the permit's issuance to the moment the bytes reached the
disk — and both ends are observations, so the window is recorded and no instant is invented.

| permit | page | window | quarantined |
| --- | --- | --- | --- |
| `p-0106` | `www.tkm.govt.nz/contact/` | 01:12:38Z – 01:12:55Z | 18,410 bytes, `5bafc32f…`, "TKM \| Contact Us" |
| `p-0143` | `www.health.govt.nz/about-this-site/feedback` | 01:21:02Z – 01:21:05Z | 28,754 bytes, `de02dbdd…`, "Just a moment…" |

**The bytes are preserved and deliberately not adopted as evidence.** The orphan HTML holds the markup
and nothing else: the failed write lost the HTTP status, the load state, the final URL, the browser
identity, the blocking classification and the navigation time. Reconstructing those would make the
corpus's two selected pages rest on inferred evidence, so the pages are re-rendered cleanly instead —
two further requests, which is a small price for complete, tagged evidence on the only two pages the
corpus uses.

### And the second orphan is not the page

`p-0143`'s 28,754 bytes are titled **"Just a moment…"** — a Cloudflare interstitial, the same barrier
headless Chromium met at `c-0291` and the reason Amendment 25 added a headed fallback to the capture
path. `renderDiscoveryPage` has no such fallback, so a clean headless re-render of that page will be
access-barred too. That is recorded here as a finding and is **not** resolved by this amendment.

### What this does not establish

No judgement has been recorded. The backlog stands at **66 records across 57 URLs**; zero open permits,
zero ledger problems, zero unaccounted files in `rendered/`, and the first 54 observations untouched.

## Amendment 35: discovery and capture must agree on what a page is

**Dated 28 September 2026.** `selection-v1.0.32`, `capture-v1.0.11` and `solo-protocol-v1.0.13`.
Moves no earlier tag.

Amendment 25 gave the capture path one fixed headed attempt for a page that bars automated retrieval.
Discovery now drives a browser too, and had no such attempt — so the two paths could disagree about
whether a page is readable, and on the Health feedback page they did. A headless render of `c-0292`'s
own page returned a **28,754-byte Cloudflare interstitial titled "Just a moment…"**, while that page is
in the corpus precisely because a **headed capture read it**, name field and all.

Recording that as attrition would have said "blocked" about a page this protocol has already
established is publicly readable: the same page, the same protocol, opposite statements, differing
only by a browser mode one path had and the other did not. So rendered discovery gets the same fallback
on the same terms.

### Two navigations, not one retried

| | |
| --- | --- |
| decision | `needsHeadedFallback()`, **shared** with the capture path so the two cannot drift |
| trigger | an **automation barrier** only — never a sign-in wall, which is a finding about what the public can read, and never a redirect refusal or a rate limit, which never reached the page |
| permits | **one each**. The headless attempt is consumed and recorded *before* the headed permit is issued, and a permit is never reused |
| pacing | the five-second minimum applies between them, honestly waited |
| evidence | both observations preserved: headless `retrieval-blocked` with its challenge bytes retained privately, headed authoritative if it succeeds |
| judgements | may cite **only** the successful, non-barred render — the barred one is already refused by `assertRenderEvidenceUsable` |

A headed fallback is therefore a **second observation of the same page in the same round**, which the
duplicate rule refused. It is now permitted only when it says so, by naming the barred observation it
follows through `followsDiscoveryId`; that link is validated at write time — same agency, category,
round and page, target an observation that was actually barred, and a permit of its own. An *unlinked*
second observation is still refused, because that is one page requested twice for no stated reason.

### Both modes barred

A terminal `renderBarred` record: this page cannot be read by this instrument, so no judgement will
ever rest on it and its render obligation is discharged as attrition — **for that URL only**. It is the
second flag able to retire a backlog entry, and the lesson from the first is applied before it is used
rather than after: it requires the outcome `retrieval-blocked`, both modes recorded and **both barred**,
and the headless observation it follows, of the same page, each with its **own consumed permit**. One
permit cannot evidence two requests. Validated in both packages, and the run stops.

### A headed browser that cannot start is not a blocked website

If headed Chromium fails to launch, the permit closes `unused` with the reason stated, **no terminal
record is written**, and the URL's render obligation stays outstanding. Blaming a government website
for a missing display would be the easiest possible way to make attrition look like evidence.

### Tests

Nine: headless blocked with headed succeeding — asserting two observations, two distinct consumed
permits, five seconds of real pacing between them, two renders, and that only the unbarred one is
usable as evidence; both modes barred; a headed launch failure leaving the obligation outstanding; a
sign-in wall causing no fallback and no second permit; and no challenge interaction.

The **no-stealth source guards now cover the discovery path too** — `render-discovery.mjs` and
`redirect-guard.mjs` alongside `capture.mjs` and `cli-capture.mjs`. A prohibition asserted of one path
and not the other is a prohibition the other path does not have. The file may now contain exactly two
headed launches, one per path, and no more.

### What this does not establish

Nothing is judged. The backlog stands at **66 records across 57 URLs**, with the two corpus pages still
to be re-rendered — TKM headlessly, Health through the fallback.

## Amendment 36: a successful fallback was the one nobody checked

**Dated 28 September 2026.** `selection-v1.0.33`, `capture-v1.0.12` and `solo-protocol-v1.0.14`.
Moves no earlier tag.

### The claim that did not reproduce

"All 57 URLs now have a usable render" was wrong. **52 had one; five had only a Cloudflare
interstitial** — rendered during the 56-URL pass under `selection-v1.0.30`, before the headed fallback
existed, and correctly refused as a basis for judgement by the same rule that refuses `g-0058`.

| barred render / observation | URL | awaiting |
| --- | --- | --- |
| `g-0042` / `d-0350` | `health.govt.nz/` | `d-0202`, `d-0256` |
| `g-0043` / `d-0351` | …`/register-for-an-assisted-dying-practitioner-list` | `d-0203`, `d-0232` |
| `g-0044` / `d-0352` | …`/register-radiation-sources` | `d-0204`, `d-0231` |
| `g-0049` / `d-0357` | …`/about-us/contact-us` | `d-0257` |
| `g-0050` / `d-0358` | …`/about-us/contact-us/oia-requests` | `d-0259` |

### The frozen path could not reach them

Measured, not assumed. `render-discovery` begins with a headless attempt, and a second headless
observation of one page in one round names no barred predecessor — so Amendment 35's duplicate rule
refused it before the fallback was reached. The attempt under `p-0154` was refused, its bytes
auto-quarantined by the `selection-v1.0.31` guard, and the permit closed
`recording-failed-after-request`. One attempt only; no further headless retries.

So a continuation is **explicit**: `continue-headed --from d-0350` names the barred observation it
continues rather than a command silently choosing one. It requires an active observation recording
`retrieval-blocked`, verifies that render's bytes, requires an **automation** barrier (never a sign-in
wall, a rate limit or a redirect refusal), matches agency, category, round and canonical URL, refuses
a second follower or a page that already has an unbarred render, and issues **one** new permit,
durably recorded before the request. It skips the redundant headless attempt: seven observations
already show that host bars headless, and re-proving it five more times would be traffic spent on a
question already answered. **Five headed requests, not ten.**

### And the gap that mattered more

Three attacks against the *successful* fallback `d-0367` left **both validators reporting zero
problems**: deleting `followsDiscoveryId`, pointing it at `d-0350` — a different page, category and
round — and deleting `attemptedModes`. The relationship was checked where it was **written**, and once
more when `renderBarred` made it **terminal**. A successful headed render was simply trusted.

Every headed observation now needs, at trust time and in both packages: exactly **one** valid headless
predecessor, active and recording `retrieval-blocked`; matching agency, category, round and canonical
URL; the predecessor's render in **headless** mode carrying an automation barrier, and its own in
**headed**; **distinct consumed permits**; and chronology — the headed permit issued no earlier than
the headless attempt was recorded, and its navigation after the one it follows. A **headless**
observation claiming to follow anything is refused.

`attemptedModes` is now **derived** from the two registered renders and required to match, because a
summary that can disagree with what it summarises is a second source of truth. For the same reason
`renderBarred`'s both-barred decision no longer reads the summary at all: it reads the two renders.

### Tests

Thirteen further conformance cases bring that table to **64**, of which 57 are refusals: the three
attacks, a summary disagreeing with its renders, two active followers, a headless observation claiming
to follow, the wrong browser mode on either side, following an unbarred attempt, a sign-in wall, a
shared permit, and both chronology violations — plus a clean pair that must be **accepted**.

The conformance directory now follows the ledger rather than being fixed in advance, so a case that
does not use the fallback pair does not inherit its bytes as orphans.

### The five continuations

All five read on the first headed attempt.

| observation | render | HTTP | title |
| --- | --- | --- | --- |
| `d-0368` | `g-0060` | 200 | Ministry of Health NZ |
| `d-0369` | `g-0061` | 200 | Register for an assisted dying practitioner list |
| `d-0370` | `g-0062` | 200 | Register radiation sources |
| `d-0371` | `g-0063` | 200 | Contact us |
| `d-0372` | `g-0064` | 200 | Official Information Act requests |

**57 of 57 URLs now have an unbarred usable render.** Zero open permits, zero ledger problems, zero
orphans, 63 observations across 64 renders, and every earlier observation untouched.

### What this does not establish

No judgement has been recorded, and none of these pages has been assessed. The barred renders are
preserved and remain refused as evidence.

## Amendment 37: the answer link belongs to the chain

**Dated 29 September 2026.** `selection-v1.0.35` and `solo-protocol-v1.0.15`. Moves no earlier tag.
No capture tag: browser behaviour is unchanged.

### The checkpoint that failed

After the first three judgements the backlog should have fallen from 66 to 63. It fell to **64**.

`d-0019` and `d-0020` were answered; `d-0018` was not. Its chain read:

```
d-0373  answers=d-0018   superseded   ← a probe record
d-0374  answers=—        supersedes d-0373
```

`correct-discovery` carried nothing across, so superseding the probe to give it a proper note dropped
the link saying which obligation the judgement discharged, and `d-0018` returned to the backlog. It
**failed safe** — the obligation reopened rather than appearing discharged — and the ledgers stayed
clean because nothing was internally inconsistent. Across sixty-six records the only symptom would
have been a backlog that did not fall as far as it should.

Two errors of mine sit behind it. I probed the mechanism **against the live log** instead of a copy,
which is how `d-0373` came to exist with a placeholder note under untagged code. And I stated the
expected arithmetic without checking that the mechanism carried the link.

### The rule is not "copy from the target"

That would still lose the link at the **second** correction of a three-link chain, because the middle
link carries it only by inheritance. So the link is a property of the **chain**: recovered by walking
every supersession backwards, and the active record must carry exactly the one the chain established.

- A correction that **drops** the link is refused, at write time and at trust time.
- A correction that **changes** it is refused: a chain resolves one obligation.
- A chain whose links **disagree** is refused.
- **At most one active judgement** may answer each obligation. Two were accepted before this, and
  they were free to contradict each other with nothing saying which one answered the record.
- A **legacy** chain that never carried a link stays valid — the NZSIS `d-0301` → `d-0308` → `d-0309`
  chain predates judgements carrying answers, so there is nothing for it to have lost.

All of it in both packages, at both times.

### And a rule of mine that was wrong

`selection-v1.0.27` required `answersDiscoveryId` to equal `supersedesDiscoveryId` when both were
present, on the grounds that otherwise it was unclear which record had been resolved. That was written
before a judgement carrying an answer could be corrected, and it **refused the repair** — the two
links name different roles, and in a correction chain they necessarily differ:

| link | names |
| --- | --- |
| `answersDiscoveryId` | the plain-retrieval **obligation** being discharged |
| `supersedesDiscoveryId` | the prior **judgement** being corrected |

Ambiguity arises only where the superseded record is itself an obligation rather than a judgement, and
that is what is now checked.

### The repair

`d-0377` supersedes `d-0374`, answers `d-0018`, on the same render `g-0002` from observation `d-0310`
with the same digest and the same outcome. It states that it restores the answer link lost during
correction and claims no change to the evidence citation, because none occurred. `d-0373` and `d-0374`
are preserved.

### Checkpoint, after repair

| | |
| --- | --- |
| backlog | **63 records across 54 URLs** |
| active judgements for `d-0018`, `d-0019`, `d-0020` | **one each** |
| render-ledger, permit-ledger, stale bindings, orphans, open permits | **0** |
| permits | 159, unchanged — no new permit, no network request |

### Tests

Ten adversarial tests: the lost link refused at write time and reported at trust time, a three-link
chain, a changed answer, a chain disagreeing with itself, duplicate active answers with both outcomes
named in the complaint, a superseded judgement not counting as a duplicate, a valid legacy chain, and
the two links differing by role. Six further conformance cases bring that table to **70**, of which 60
are refusals.

### The first three judgements

All three are `no-candidates` for `account-registration`, confirming what the plain fetches recorded.

- `https://www.tpk.govt.nz/en` — two site-search forms, sole control a text input named `q`. No
  registration, no credential field, no personal-name field.
- `…/search?q=register` — renders "About 80 results", ten listed: proactively released information,
  the Māori Development Fund, housing support, careers. None is a registration.
- `…/search?q=sign+up` — renders "About 600 results", ten listed, all news items under
  `our-stories-and-media`. The phrase matches editorial prose, not a form.

The rendered DOM did show results the plain fetch did not, which is the point of rendering; it did not
change the finding.

## Amendment 38 — the publication carries the reasoning, and the permissions it rests on

*Frozen as `selection-v1.0.36` and `solo-protocol-v1.0.16`, 29 September 2026.*

A publication-only correction. No request was made, nothing was recaptured, no outcome, candidate
set, category or selected page changed, and FormFair was not run.

### What was wrong

The omission only became visible once the third corpus page was approved, because it took an
approved capture to expose it.

`c-0441` — the NZSIS national-security reporting form — was captured with inclusion evidence that
flagged a category question for review: the page is a form for reporting information to the agency
rather than applying for a service, and `d-0307` had asserted the service-application
classification without arguing it. That flag was published in the tracked ledger. The note that
**resolved** it was not. `approvalNote` and `approvedAt` were recorded in the log, which is
untracked research data, and the published audit therefore carried the doubt without its answer —
a worse state than either alone, because a reader could see the objection and nothing addressing
it. The resolution was already decisive and already frozen: Amendment 29 classified this exact
page as a service-application candidate and argued it, two days before the capture.

The same gap ran in the other direction for permissions. Every request in this scan is authorised
by a robots observation, and none of those observations was published. `r-0029` — the HTTP 404 that
permitted the NZSIS capture under RFC 9309 section 2.3.1.3 — appeared in the tracked files only as
prose inside another record's evidence text, where it happened to be mentioned. A permission a
reader cannot look up is a permission they have to take on trust, which is the thing this audit
exists to avoid.

Active candidate sets were the third case. A superseded set published its `approvalNote` from the
start; an active one did not. The reasoning behind a set **still in force** was the only version a
reader could not see.

### The rule

1. `selection-ledger.csv` carries `approvedAt` and `approvalNote` as the two columns after
   `approval`. Every row has both fields, empty where there is no approval note, so the row shape
   does not shift with the prose.
2. `provenance.json` carries a `robotsChecks` record for every check: `id`, `origin`, `url`,
   `fetchedAt`, `httpStatus`, `disposition`, `contentType`, `bytes`, `sha256`, and the
   representation classification (`valid`, `reason`, `mediaType`, `charset`, `challenge`).
3. **The response body is never published.** Neither `body`, nor the copy of that same body that
   `classifyRepresentation` returns as `representation.text` for a valid robots file. The
   representation is rebuilt field by field rather than spread, so a field added to the classifier
   later cannot silently begin publishing content.
4. Active `candidateSets` publish `approvalNote`, as superseded ones already did.

### What holds it

Seven cases in `capture/test/provenance.test.mjs`: the `c-0441` case, that an approved capture
publishes its approval time and its resolution in full rather than truncated; that a row with no
note still carries both columns; the `r-0029` case, that a referenced 404 is published as an
`allow-all` observation with its digest and byte count; that no robots body reaches either file,
including `representation.text` for a valid file and a challenge document for an invalid one, while
the `Imperva/Incapsula` classification itself still does; that an approval note containing commas,
double quotes and newlines survives as one field and does not become a second record; that an
active set publishes its note; and that captured markup remains absent from both files.

No capture tag accompanies this. Browser behaviour, retrieval, pacing and the permit boundary are
untouched; only what is written into the two tracked files changes.

## Amendment 39 — a rendered observation must be read before its round is locked

*Frozen as `selection-v1.0.37` and `solo-protocol-v1.0.17`, 29 September 2026.*

No request, no recapture, no outcome or category change, and no change to any locked set. Browser
behaviour is untouched, so no capture tag accompanies this.

### What was wrong

`render-discovery` writes an observation whose outcome is `rendered`, and that record concludes
nothing by design — the conclusion is a separate `classify-render` record. **Nothing required the
second record to exist.**

`renderBacklog` did not cover it. That function computes the *retrospective* obligation: active
plain-retrieval records whose outcome is a content judgement, awaiting a render. A freshly rendered
observation is not in that set, so the backlog read zero while sixteen rendered observations sat
unjudged in the New Zealand Defence Force account-registration round, and `status` reported the
unlocked candidate set as the only outstanding work. A set could therefore be locked and approved
over evidence that had been retrieved and never read — which is what `d-0306` is remembered for,
except that this version leaves no trace in the packet.

### The rule

Every active observation with outcome `rendered` must be answered by **exactly one** active
`judgement-only` record for that observation's own category and round, and that judgement must
name the same render, URL and agency.

Three qualifications, each of which the first implementation got wrong and each now held by a test:

1. **Linked by either role.** A judgement is bound to an observation by `answersDiscoveryId` *or*
   `evidenceFromDiscoveryId`. A fresh render answers its own observation, so both point at it; a
   retrospective judgement answers the original plain-retrieval record — `d-0377` answers `d-0018`
   — and merely cites the observation as evidence. Testing the answer link alone reported all 57
   retrospective observations as unread, the opposite of what the log shows.
2. **Uniqueness is per category, not per observation.** One render legitimately supports a
   judgement in every category it was examined under; `d-0315` carries three. What is forbidden is
   two live judgements for the *same* category about one retrieval, because the round then has two
   answers and no way to say which it acted on. A superseded judgement does not count.
3. **Attrition needs no judgement.** `retrieval-blocked`, `robots-unestablished` and `disallowed`
   read nothing, so there is nothing to conclude. A **successful headed fallback** is not attrition:
   it records `rendered` like any other retrieval and is held to the rule. CadetNet is that case —
   `g-0074` was barred and needs nothing, `g-0075` read the page and needs a judgement.

### Where it is enforced

At `lockCandidateSet`, at `approveCandidateSet`, in `corpusBlockers`, and independently in the
sealer as `unjudgedRenderProblems`. Approval is checked separately from locking for the reason the
round-agreement check already is: a set reaching approval by a route that never passed through
`lockCandidateSet` would otherwise be approved unchecked. **Rejection stays ungated**, so a round
whose evidence contradicts itself remains resolvable.

### What holds it

Nineteen cases in `capture/test/unjudged-renders.test.mjs`, every one driving **both**
implementations over the same log and requiring them to agree: a missing judgement; a deleted one;
mismatched render, URL and round; two active judgements for one category; a superseded duplicate
that is not a duplicate; three categories off one render; the retrospective shape; a superseded
observation; each attrition outcome; a successful headed fallback, which must be flagged while the
barred attempt beside it is not; and the two refusals at lock and approval.

### The NZDF round

All 16 rendered observations in that round already carried matching judgements, and the live log
reports zero unread renders across all 121 of them. The gate was added because the round *could*
have been locked without them, not because it was.

## Amendment 40 — the bound counts candidates, and a retrieval may conclude nothing

*Frozen as `selection-v1.0.38`, `capture-v1.0.13` and `solo-protocol-v1.0.18`, 30 September 2026.*

### The state of the scan when this was written

Recorded precisely, because this correction was made in the middle of an agency's assessment and
the reader is entitled to know exactly what had and had not happened to it.

- **The five locked URLs for New Zealand Defence Force / account-registration, and their order,
  are unchanged.** Nothing here reopens discovery, alters a candidate, or re-runs a round.
- **`https://www.cadetnet.org.nz/wp-login.php` remains beyond the bound.** It is the sixth
  distinct URL by canonical sort and is not assessed. That is `droppedBeyondBound` working, and it
  is untouched by this amendment.
- **Three of the five candidates had already been retrieved** — `cadet-join.html`, and the Military
  and Civilian Portal sign-in pages — and their bytes are held.
- **`https://nzdf.bravosolution.com/web/login.shtml` and `https://www.cadetnet.org.nz/complete-signup/`
  had not been visited at all.** No request of any kind had been made to either.
- **No FormFair analysis had been run**, against these pages or any other.

### What was wrong

**The bound counted records, not candidates.** `remainingBudget` counted every non-discovery
attempt for the agency and category. A candidate that was retrieved, found ineligible, rejected and
superseded therefore spent three of the five slots by itself, and after two and a half candidates
the round was stuck: `c-0498` could not even record the exclusion that resolved it. The frozen rule
requires all five locked candidates to be examined, so a bound that halts the third is not
enforcing the protocol — it is breaking it. `EFFORT_EXHAUSTED` applies once the five have outcomes,
not before.

**Obtaining a page meant asserting it qualified.** The capture path writes eligibility on its
captured branch with criteria three and four set to `true` unconditionally, and it was the only way
to retrieve a candidate. So reading a page in order to decide whether it qualified required first
recording that it did. `c-0494` recorded `cadet-join.html` — a page with zero form elements and
zero controls — as satisfying all five criteria, and had to be rejected and superseded. That is
also *why* each candidate cost three records: the two defects compounded.

### The rule

1. The effort bound counts **distinct canonical candidate URLs** per agency and category. Further
   records about a URL already counted — a retrieval, its exclusion, a correction, a supersession —
   consume no additional slot and are preserved in the log as they always were. **A sixth distinct
   URL is still refused**, which is what the bound is for.
2. **Assessment-only retrieval.** `capture --retrieve-only` fetches a candidate under the same
   robots, redirect, pacing and headed-fallback rules as a capture, and records `status: retrieved`
   with the file, its digest, the browser provenance and **every eligibility criterion null**. It
   may not carry `inclusionEvidence`. The researcher reads the markup and then either excludes from
   that evidence, or promotes it.
3. **Promotion does not re-request the page.** `promote --id <retrieval>` re-hashes the file on disk
   against the digest the retrieval recorded, refuses if they differ, and writes the capture from
   those same bytes. A promotion shares its retrieval's `pageId` and file by design; two *captured*
   records naming one file remains an error.
4. A retrieval is not a decision, so it need not be rejected before it is superseded — requiring
   that would mean recording a verdict on the page in order to be allowed to record the verdict.

### Criterion numbering

Two exclusions were written with the wrong numbers and are corrected in the same change. The frozen
order is: **1** publicly reachable without signing in, **2** reached from a frame website for that
agency, **3** asks for the name of a natural person, **4** name field visible without entering data
or submitting, **5** normal HTML or browser-rendered, not PDF or native.

- `cadet-join.html` was written as failing criterion two. It does not: it was reached from an NZDF
  frame website. It fails **three and four** — it asks for nothing and shows no name field.
- The Military Portal sign-in page was written as failing criterion five. It does not: it is normal
  HTML. It fails **three and four** — it asks for an email address and a password.

The structural `--fails` keys were right in both records; the prose numbering was not, and prose is
what a reader of the ledger sees.

### What holds it

Eleven cases in `capture/test/assessment-budget.test.mjs`: one candidate examined three times
spending one slot; five distinct candidates filling the bound; a sixth refused; a further record
about one of the five always allowed; the bound enforced against a real log; a retrieval recording
bytes without a claim; a retrieval refused for asserting any criterion, for carrying inclusion
evidence, or for missing its file, digest or page id; a retrieval needing no `exclusionReason`
where every other non-capture does; and a promoted capture sharing its retrieval's file without
reading as an orphan or a double-count.

## Amendment 41 — evidence does not settle a candidate

*Frozen as `selection-v1.0.39`, `capture-v1.0.14` and `solo-protocol-v1.0.19`, 30 September 2026.*

### The attack

Amendment 40 added `retrieved` for a sound reason: obtaining a page should not assert that it
qualifies. But `status !== 'discovery'` was the de facto test for *"this candidate has been
decided"*, used in `nextWork`, in `corpusBlockers`, in the draft derivation and in the exhaustion
logic — correct while every non-discovery record was a decision, and silently satisfied by the new
status everywhere.

Reproduced on a copy of the live log, three steps:

1. delete the exclusion `c-0504`;
2. mark the retrieval `c-0503` approved;
3. approve the other four exclusions.

`nextWork` advanced to NZDF service-application and `corpusBlockers` reported **nothing**, while
`https://www.cadetnet.org.nz/complete-signup/` had never been decided at all. An evidence-only
retrieval counted as a completed decision, so **a candidate could be settled by the act of
retrieving it** — the opposite of the guarantee Amendment 40 was added to provide.

### The rule

1. **A retrieval carries `approval: not-applicable`.** Not pending, not approved, not rejected:
   there is no decision to approve. Leaving it `pending` made it unfinished business that approving
   would "resolve", and no other status may borrow the state.
2. **Only a terminal decision settles a candidate.** `TERMINAL_STATUSES` is `captured`, `excluded`,
   `failed`, `capture-blocked`. A retrieval is not among them and **never qualifies, settles or
   exhausts** anything.
3. **Every locked candidate requires exactly one active terminal decision.** Not at least one: two
   live decisions leave the category with two answers and no way to say which it acted on.
4. **One shared function, not four opinions.** `TERMINAL_STATUSES`, `isTerminalDecision`,
   `isEvidenceOnly` and `terminalDecisionsFor` are defined once in `selection.mjs` and used by
   `nextWork`, `status`, `corpusBlockers`, the draft and the resolution logic; the sealer carries an
   independent implementation, `terminalDecisionProblems`, so a state reaching the seal by a route
   that never touched the capture CLI still fails.
5. **Status reports retrievals separately**, on their own line and outside the decision counts. The
   printed statuses are checked against the attempt total, because the same omission had already
   happened once: with `retrieved` added the lines again failed to sum, and the missing record was
   the one that decides nothing.
6. **An exclusion written from a retrieval cites it structurally**, through
   `evidenceFromAttemptId`, verified at write time against the retrieval's agency, category,
   canonical URL, digest and byte length. It **must not supersede the retrieval it cites**:
   superseding the evidence withdraws it from the active record, leaving the finding resting on
   nothing checkable. A supersession claim from a record that has itself been superseded does not
   keep evidence withdrawn, which is what makes the repair below expressible in one record.

### The two repairs to the live log

**`c-0504` superseded its own evidence.** It has been rejected and superseded by **`c-0505`**,
which cites `c-0503` instead and carries its digest. No request was made; the finding about the page
is unchanged.

**`c-0503` carried `approval: pending`,** written by `capture-v1.0.13` before the
`not-applicable` state existed. That field is migrated in place, with the reason recorded on the
record itself as `approvalMigrationNote`. This is a **field migration, not a correction of a
finding**: a retrieval decides nothing, so `pending` was never a fact about the world, and no
outcome, digest, byte, eligibility value or retrieved byte changed. It is disclosed here rather
than done quietly because editing any recorded field is otherwise outside what this protocol
permits.

### What holds it

Thirteen cases in `capture/test/terminal-decision.test.mjs`, including **the exact three-step attack
above** as a regression test, run against both the capture package and the sealer: a retrieval alone
leaving the candidate undecided in `corpusBlockers`, in the sealer and in `nextWork`; the approval
refused at write time for all three decision states; no decision permitted to borrow
`not-applicable`; the exclusion settling it and work then advancing; two live decisions refused
rather than silently preferred; a citation refused for superseding its own evidence, for mismatched
agency, category or URL, for a mismatched digest or byte length, and for naming something that is
not a retrieval; a retrieval withdrawn by a live supersession refused as evidence, and citable again
once that record is itself superseded; and the shared predicates agreeing on what settles a
candidate.

### A development note, not part of the evidence chain

While resolving a tag-name collision, `capture-v1.0.8` was deleted locally in error and restored
from the remote; the annotated tag object hash was verified identical and the remote reference never
moved. No protocol deviation is recorded, because nothing in the research evidence chain was
affected.

## Amendment 42 — free text may not restate what the fields carry

*Frozen as `selection-v1.0.40`, `capture-v1.0.15` and `solo-protocol-v1.0.20`, 30 September 2026.*

### What was wrong

`c-0576` reached the approval gate with a **fabricated digest**. Its reason read *"sha256
0e7b3cb3ee1b"*; the file hashes to `fa4c2f68…` at 106,370 bytes, and the retrieval it cited,
`c-0575`, recorded that same correct digest. The record's own `htmlSha256` was right, and Amendment
41's citation check had verified it against the retrieval. The invented string lived in the
free-text reason, where nothing checks anything.

Every gate in this package compares **fields to fields**, so not one of them could have caught it.
It was found by a reader comparing the prose to the file. The lesson is not that a sixth gate is
needed but that **prose should not be a second source of truth** for a fact the structured fields
already carry and the machinery already verifies.

### The rule

1. A free-text field — `exclusionReason`, `inclusionEvidence`, `note`, `approvalNote` — may not
   contain a **digest-shaped token** (12 or more hex characters). Cite the evidence record by id.
   A *correct* digest is refused for the same reason as a wrong one: prose that happens to agree
   today can disagree tomorrow.
2. A free-text field may not restate a **byte length** the record itself carries in `htmlBytes`.
   Describing some other artefact's length remains legitimate — the 212-byte challenge document
   served in place of a robots file is not this record's evidence.
3. The **selection ledger renders the provenance instead**, from the verified fields: `htmlBytes`,
   `evidenceFromAttemptId`, `promotedFrom` and `supersedesAttemptId` join the existing
   `htmlSha256`. A reader gets the digest, the length and every evidence link without the prose
   asserting any of them.

Enforced in `appendAttempt`, so it binds every write path. History is untouched: the guard runs at
append time and does not rewrite or invalidate a recorded note.

### The audit of every prose digest already in the log

Because one fabrication was found, all of them were checked rather than assumed. The log contains
**114 digest claims in prose**, across 112 records.

- **107 match a digest the log verifies** somewhere — a render's `renderedSha256`, a robots check's
  `sha256`, or an attempt's `htmlSha256`.
- **2 are the one fabrication**, `c-0576`'s reason and its rejection note, already superseded by
  `c-0578`.
- **5 describe retained response bodies from the NZSIS rounds** — `d-0295`, `d-0298`, `d-0299`,
  `d-0300`, `d-0301` — and those bodies are no longer among the retained files, so **nothing now
  verifies them**. Their notes describe specific contents (`_Incapsula_Resource` and an Incapsula
  incident id, the host's own "page is not found" document, a client-rendered shell with a single
  `static/main.min.js` and release `v1.2.0-rc1`), and their outcomes —
  `retrieval-blocked`, `unavailable`, `retrieval-inconclusive` — rest on those contents rather than
  on the digests. They are recorded here as **unverifiable rather than wrong**, and they are left
  exactly as written.

A first pass of this audit also flagged `c-0499`. That was the audit's own false positive: the
digest `b35b127a9a51` is correct for the captured `cadet-join.html` file and for `c-0494`, and
`c-0499` was flagged only because, predating `--evidence-from`, it carries no digest field of its
own for the check to reach through. Counting it as a third fabrication would have been an error of
the same kind as the one being fixed.

### What holds it

Ten cases in `capture/test/restated-evidence.test.mjs`: the exact `c-0576` shape refused; a correct
digest refused too; all four free-text fields covered; a citing note accepted; a byte count about
another artefact allowed; a byte count refused only when the record carries the length; short hex
such as record ids, dates and `HTTP 403` left alone; the guard firing inside `appendAttempt`; and
the ledger rendering digest, length and every evidence link as columns with a stable row shape.

Two Amendment 38 tests located the approval columns by tail offset and broke when these columns
were appended; they now locate them by name, since a test that assumes a column is last breaks
every time the schema grows.

## Amendment 43 — a promotion makes no request, so pacing does not apply to it

*Frozen as `selection-v1.0.41`, `capture-v1.0.16` and `solo-protocol-v1.0.21`, 30 September 2026.*

### Chronology, recorded because it is a departure from how this protocol is meant to change

This change **shipped before it was frozen**. Commit `ee1e511` altered capture behaviour, and the
amendment existed only in a code comment, a test and the commit message: nothing in this document,
and the newest tags still pointed at `476722b`. That is the wrong order — the rule is written and
tagged, then the behaviour follows — and it is recorded here rather than tidied away. No page was
requested again to correct it; the fix is documentary.

### What was wrong

`promote` re-hashes bytes already held and writes the decision about them. It makes **no request**.
It also inherits the retrieval's `navigatedAt`, which is when those bytes were actually fetched, so
as soon as any later page is retrieved the interval to "the previous navigation" goes **negative**.

Promoting `c-0643` — the Air Force Museum contact page, the alphabetically first of five eligible
candidates — was refused with *"only -52000 ms since the previous navigation"*, because the other
four had been retrieved after it. Held to the pacing rule, the frozen tie-break becomes
**unexecutable whenever the selected page is not the last one fetched**: four times in five here,
and more often as a set grows.

### The rule

A record carrying `promotedFrom` is exempt from the five-second minimum between top-level
navigations. Pacing is an obligation on **traffic**, and a record that generates none cannot breach
it. The exemption is scoped to that field alone: a real navigation inside the minimum is still
refused, and a test asserts both halves.

## Amendment 44 — "eligible but not selected" is a disposition, not a sentence

*Frozen as `selection-v1.0.41`, `capture-v1.0.16` and `solo-protocol-v1.0.21`, 30 September 2026.*

### What was wrong

NZDF's enquiry-or-contact round produced **five eligible candidates**, so the frozen tie-break alone
decided which entered the corpus. The four that lost were recorded as `excluded` with every
eligibility criterion `null` — which means *not established* — while their reasons stated in prose
that all five criteria were satisfied.

Two things were therefore unverifiable. The log could not report **how many candidates were
eligible**, which is the numerator of any eligibility rate this study reports. And the tie-break
claim rested on nothing a gate could check: no record named the capture that won, so nothing would
have caught a selection the rule did not make. `doExclude`'s own reasoning about criterion-five
counts applies here with equal force.

### The rule

A new terminal disposition, `eligible-not-selected`, which requires:

1. **Every one of the five eligibility criteria recorded as `true`.** It is not an exclusion on
   eligibility, and no criterion may be recorded as failed.
2. **A citation of the assessment-only retrieval** it was judged from, in `evidenceFromAttemptId`,
   so the eligibility claim rests on named evidence rather than on the record's own assertion.
3. **The selected capture named** in `notSelectedInFavourOf`, which must be a `captured` attempt in
   the **same locked set** — same agency, category and round — with both URLs in that set.
4. **The selection sorting before this candidate** by canonical URL, since the frozen tie-break
   takes the alphabetically first eligible canonical URL and a candidate sorting earlier cannot have
   lost to a later one.
5. It **settles** a candidate, so it joins `TERMINAL_STATUSES`, and it **never qualifies** an agency
   — only an approved capture does.

Validated at write time in `appendAttempt`, again at the corpus gate — where a **rejected**
selection re-opens the tie-break rather than leaving it standing — and independently in the sealer.
Published in the selection ledger, which gains a `notSelectedInFavourOf` column beside the status.

### The four records

`c-0649` to `c-0652` were **rejected and superseded append-only** by `c-0653` to `c-0656`, each
citing the retrieval it was already judged from and naming `c-0648` as the selection. No page was
requested again. The rejection reasons say plainly that the outcome was structurally wrong rather
than substantively wrong: the finding was right, and only prose carried it.

### What holds it

Eleven cases in `capture/test/eligible-not-selected.test.mjs`: the disposition settling a candidate;
all five criteria required true, with both an all-null and a single-false fixture refused; the
retrieval citation required; the selection required; a non-capture refused as a selection; a
different round refused; a category mismatch refused earlier still by the citation check, which is
its own guard; a selection that does not sort first refused; a rejected selection re-opening the
tie-break at the corpus gate; the sealer refusing a tampered sort order independently; and the
ledger publishing the status and the selection with a stable row shape.

## Amendment 45 — a new state must reach every reader of the log

*Frozen as `selection-v1.0.42`, `capture-v1.0.17` and `solo-protocol-v1.0.22`, 30 September 2026.*

Code only. No page was requested again, and `c-0648` and `c-0653`–`c-0656` are unchanged: the five
outcome records were substantively correct, and all three faults were in what read them.

### The three faults

**1. The status report omitted the new disposition.** `eligible-not-selected` was added to the model
in Amendment 44 and not to the printed totals, so four records fell into `UNACCOUNTED` — a count
printed by the very guard added in Amendment 41 to catch exactly this. The guard worked and nobody
re-ran `status` to read it. **This is the third occurrence of the same omission**: `capture-blocked`
in `capture-v1.0.7`, `retrieved` in Amendment 41, and now this. The printed statuses are therefore
no longer retyped; they are derived from `TERMINAL_STATUSES` plus `retrieved` and `discovery`, so a
status added to the model cannot be forgotten in the report.

**2. The sealer accepted a rejected selection.** Setting `c-0648.approval = "rejected"` raised the
capture package's `tie-break-unsound` blocker and produced **zero** sealer problems. A rejected
capture decides nothing, so a record resting on it rests on nothing. An independent implementation
that agrees only on the happy path is not an independent check — it is a second chance to pass.

**3. The sealer's byte-length check could never fire.** It compared `a.bytes` with `src.bytes`, and
**no record has ever carried a field called `bytes`** — the length lives in `htmlBytes`. Both sides
were `undefined`, so tampering with `c-0653.htmlBytes` produced zero problems while a digest change
was correctly caught. A check that cannot fail is worse than no check, because a seal that passes it
is read as verification. The check now names both values, so a reader can see which one is wrong.

### How they were found

By driving the **live log** — reproducing each tampered state against the real records — rather than
by running the fixtures, all of which passed. Faults 2 and 3 are both of a kind the fixtures could
not reach: one is a divergence between two implementations that agree on valid input, and the other
is a comparison of two absent fields, which is vacuously true on every well-formed log.

### What holds it

Four cases appended to `capture/test/eligible-not-selected.test.mjs`: every status the model allows
is a status the report prints, asserted against the frozen list rather than a copy; a rejected
selection failing the seal as well as the corpus gate; a tampered `htmlBytes` failing the seal as a
tampered digest already did; and the length problem naming both values.

## Amendment 46 — a visible way to register means the page is not a sign-in wall

*Frozen as `selection-v1.0.43`, `capture-v1.0.18` and `solo-protocol-v1.0.23`, 1 October 2026.*

### When this was triggered

By a **held-out observation**, and the timing matters: the candidate set for Health New Zealand's
account-registration round was **not yet locked**, **no candidate had been assessed**, and
**FormFair had not been run** — against this page or any other. The correction therefore changed
what discovery could see, not what an analysis had already reported.

### What was wrong

`jobs.tewhatuora.govt.nz`, the agency's own jobs website, returned **HTTP 200** and rendered 213
nodes in 32,339 bytes: a login form, a password-retrieval form, a job-search form, and **three
visible "Register" anchors**. It was recorded `retrieval-blocked` on a `sign-in wall` — a record
asserting that *nothing was read* about a page that was read in full.

The logic was working exactly as written. `looksLikeSearch` excluded the job-search inputs because
their form's action matches `/search/`, so `readableOutsideCredentials` computed **0**; the page says
"Sign In"; and the discriminator asked only whether the **password-bearing** form carried a
personal-name field, which it does not. A registration route sitting *beside* the login form — this
exact layout — was invisible to the test.

That contradicts the interpretation already fixed in this document: *a page is excluded only when
the intended form or name field cannot be viewed without authenticating.* The `Register` control was
plainly viewable. Three consequences followed: the record stated something false, it suppressed the
agency's strongest account-registration lead, and it inflated technical attrition with a record that
is not attrition.

### The rule

A **visible registration affordance** is detected and recorded, and a sign-in wall is now declared
only in its absence.

1. Affordances are sought in `a`, `button`, `[role="button"]` and submit/button inputs **only**,
   **only when visible**, and matched on the element's own label text, value or `aria-label`.
   Hidden elements, scripts, comments and incidental body prose do **not** count — any of them can
   say "register" about something that is not there.
2. `sign-in wall` requires **all five**: sign-in language, a password form, no readable form content
   outside it, no personal-name field in it, **and no visible registration affordance**.
3. The affordance's label, element and target are recorded structurally on the render as
   `registrationAffordances`, so the decision not to call a page a sign-in wall is auditable rather
   than implicit in a barrier's absence.
4. **Clearing the barrier permits researcher judgement; it does not declare the page eligible.**

### The correction to the live evidence

`d-0676` and `g-0158` are **preserved**. `correct-barriers` re-hashed the retained 32,339 bytes
against the digest `g-0158` recorded, reloaded them into a browser page from memory with the network
aborted, and ran **the same `detectBlocking`** over them — not a second implementation, which would
be free to disagree with the one that classifies every future capture. It then appended render
`g-0163` with the corrected metadata and observation `d-0684`, outcome `rendered`, superseding
`d-0676`.

The correction **replaces the active barrier metadata** rather than adding a judgement that cites a
barred render: `assertRenderEvidenceUsable` refuses a barred render as a basis for judgement and
goes on refusing `g-0158`, which is the point. A re-classification makes no request, so it carries
**no permit and no `navigatedAt`** — and must not borrow the permit its predecessor consumed, which
is checked.

`d-0685` then judged it `candidates-found`, admitting
`…JobSeekerToolBoxAction?in_organId=19739&in_create_account_button=Register` as a candidate. It
enters the locked set in normal canonical order and is assessed later like any other.

**One limitation, recorded on the render rather than left implicit:** the page is reloaded from its
markup without its external stylesheets, so visibility is computed from the DOM and inline styles
alone. For an anchor carrying a registration label that is the same answer; for an element hidden
only by an external rule it need not be.

### What this does not justify

Nothing else is reopened. The two reCAPTCHA-blocked records on `depression.org.nz` and
`smallsteps.org.nz` were barred in **both** browser modes and remain technical attrition; the
blanket exclusion on `www.healthnz.govt.nz` and the path-specific exclusions on Safer Gambling,
Smokefree, HealthEd and the resource store remain **stated policy**, honoured as written. Active
technical attrition falls by exactly one, from 58 to 57.

### What holds it

Thirteen cases in `capture/test/registration-affordance.test.mjs`, eight of them driving the real
`detectBlocking` over built markup: the exact separate-login-plus-visible-register layout; a genuine
login-only wall still blocked; the affordance found on a button, a `role="button"` and a submit
input; hidden registration controls — `display:none`, a hidden ancestor, the `hidden` attribute —
leaving the barrier in place; "Register" in a script or a comment not counting; incidental prose not
counting; a cleared barrier asserting nothing about eligibility; and an HTTP 403 remaining a barrier
whatever the page offers. Five more cover the append-only correction: the corrected record no longer
counting as attrition while the original is preserved, a re-classification refused for naming a
permit, the corrected observation outstanding until explicitly judged, the barred render still
unusable as evidence, and both packages agreeing the corrected log is clean.

## Amendment 47 — three published tags are revoked, not corrected

*Frozen as `selection-v1.0.44`, `capture-v1.0.19` and `solo-protocol-v1.0.24`, 1 October 2026.*

Amendment 46 is **not rewritten**. Its rule, its implementation and the live correction it
authorised are all sound; what was wrong was the attestation that froze them.

### What happened

Three tags were created and pushed against `60038c0`, a commit that contains **no Amendment 46
implementation**. The commit carrying it was never made: the heredoc supplying its message was
consumed by an earlier command in the same shell chain, so `git commit` produced nothing, `HEAD`
never moved, and the `git tag` commands ran against the previous commit and were pushed. It was
caught only because a trailing `echo` printed the unchanged hash.

The amendment's own text, written before the tagging, states that it was frozen under those three
names. That sentence is now wrong, and it is left standing — the record of a mistake belongs in the
record.

### Why they are revoked rather than fixed

Once a tag name has been published, deleting or moving it can leave different clones resolving the
same version to different objects: a reader who fetched earlier keeps the old object, a reader who
clones later gets the new one, and neither can tell. Preserving the mistake and issuing a corrected
version is the stronger audit trail. **They are never deleted, moved or recreated.**

| revoked tag | annotated tag object | peels to | replaced by |
| --- | --- | --- | --- |
| `selection-v1.0.43` | `8d2c496bd9ff46942f5c7e8c83d4d5dfa56b1c21` | `60038c0` | `selection-v1.0.44` |
| `capture-v1.0.18` | `1788be428fe8469ba0f31c1cd1a72c54c89dcc36` | `60038c0` | `capture-v1.0.19` |
| `solo-protocol-v1.0.23` | `c384b5e88d570acff8958f715ea196cd58b635a5` | `60038c0` | `solo-protocol-v1.0.24` |

`solo-protocol-v1.0.23` was the worst of the three, because it was not merely published: it was
**named by the running code**. `SOLO_PROTOCOL_TAG` and `SOLO_SEALER_TAG` both declared it as the
version in force, so the sealer asserted conformance to a tag that attested to nothing. Both now
name `solo-protocol-v1.0.24`.

### The rule

1. A revoked tag is recorded in `evaluation/provenance/revoked-tags.json`, tracked in the
   repository, with its **annotated tag object id**, its **peeled commit**, the date, the reason and
   its replacement.
2. **Nothing may name a revoked tag as the version in force.** A test asserts that neither
   `SOLO_PROTOCOL_TAG` nor `SOLO_SEALER_TAG` appears in the revocation record, that the two agree so
   one cannot be corrected without the other, and that no entry is replaced by another revoked tag.
3. A replacement tag's message **states which invalid tag it replaces**, so the relationship is
   legible from `git tag -n` without reading this document.

### What is not reopened

`d-0684`, `d-0685` and `g-0163` stand, and no page was requested again. The evidence and the
substantive correction were never in question — only the freeze attestation was. Six cases in
`evaluation/solo/test/revoked-tags.test.mjs` hold the rule, including one that proves the guard
fires on the specific name that was revoked rather than passing vacuously.

## Amendment 48 — a re-reading of retained bytes is its own kind of record

*Frozen as `selection-v1.0.45`, `capture-v1.0.20` and `solo-protocol-v1.0.25`, 1 October 2026.*

### What was wrong

Amendment 46 wrote its correction as an **observation**, and an observation means a retrieval: it
must name the permit that authorised the request, carry the time of that request, and declare that
navigation occurred. `d-0684` could satisfy none of those honestly, because no request was made. The
live gates reported four problems at once — `g-0158` orphaned, because its only observation had been
superseded and the ownership test demanded an *active* one; and `d-0684` claiming no navigation, no
timestamp and no permit while typed as a retrieval. The corpus draft was withheld.

Status compounded it by reporting **59** technical-attrition records where **57** were active: a
record corrected by a reclassification is no longer an account of a failed retrieval, and leaving it
in the headline figure overstated attrition by exactly the corrections made to it.

The tempting repair — copying `p-0285` and its navigation time onto a second record — is forbidden.
It would make two records claim one retrieval and dress a metadata correction as network traffic.

### The rule

A third record type, **`reclassification`**: a re-reading of bytes already retrieved, under a
corrected classifier.

1. It makes **no request**, so it carries **no permit** and **no `navigatedAt`**, and records
   `navigationPerformed: false`. Naming the permit its predecessor consumed is refused.
2. It must **supersede** the record whose classification it corrects, and cite the render carrying
   the corrected metadata for the **same retained bytes**.
3. Like an observation it may record `rendered` or `retrieval-blocked`, and concludes nothing about
   candidates.
4. **Render ownership** has two further legitimate forms: a reclassification owns the render carrying
   its corrected metadata, and a render whose observation was superseded along a chain ending in an
   active reclassification keeps that observation as its **historical owner**. `g-0158` was retrieved
   under `p-0285` by `d-0676`, and that remains the true account of how those bytes arrived. The
   chain is followed to its end, not one link: a one-link test orphans the render again at the next
   correction.
5. **Active attrition is derived**, with withdrawn records shown separately and the two reconciled,
   so `total ever = active + superseded` is visible rather than assumed.
6. An inherited **answer link may be resolved forward** through supersession, and forward only. A
   judgement may both answer and supersede one plain record — the role distinction drawn in
   selection-v1.0.27 — so the lineage follows **evidence successors only**, an observation or a
   reclassification, never a judgement. Walking forward indiscriminately reported that a chain
   answered its own conclusion, which broke two existing tests and is the subtlest part of this
   change.

### The repair to the live evidence

Append-only throughout, and no page was requested again. `d-0676` is preserved as the historical
owner of `g-0158` and of permit `p-0285`. `d-0684` is superseded by **`d-0686`**, a reclassification
citing the existing `g-0163` — the same file, re-hashed before the record was written, so no third
render of one retrieval was produced. `d-0685` is superseded through `d-0687` by **`d-0688`**, whose
answer link resolves forward to `d-0686`. The candidate is unchanged, and the judgement's outcome
and reasoning were never in question.

Active technical attrition is now **57**, reconciling as 59 ever = 57 active + 2 superseded
(`d-0301` and `d-0676`).

### What holds it

Twelve cases in `capture/test/reclassification.test.mjs`, built as the live shape: one retrieval,
one permit, one consumption, with the reclassification carrying neither permit nor navigation time;
the original render keeping its superseded owner, verified by both packages; the corrected metadata
accepted and the judgement on it valid; every ledger, the backlog and the stale bindings zero;
active attrition derived and reconciled; each of the five refusals the record type makes, including
the forbidden permit copy; two links in one lineage treated as one obligation; and an answer in a
genuinely different lineage still a conflict.

Two existing tests encoded the superseded rules and were updated rather than worked around: one
asserted the old message for `rendered`, and one failed because the lineage walk initially followed
judgements.

## Amendment 49 — the test script must run every test file

*Frozen as `selection-v1.0.46`, `capture-v1.0.21` and `solo-protocol-v1.0.26`, 1 October 2026.*

No live record changes and no page is requested again. The implementations frozen by the earlier tags
were **correct**; what was wrong is how much their CI job proved.

### What was wrong

`capture/package.json` named its ten test files explicitly, and the CI capture job runs that script
under Xvfb. Seven newer files were never added to it:

```
assessment-budget  eligible-not-selected  reclassification  registration-affordance
restated-evidence  terminal-decision      unjudged-renders
```

So CI executed **445** tests while the suite contained **540**. The 95 omitted tests all pass when
run directly — there was no functional failure — but a green badge proved 445 and was read as proving
the whole suite. Among the omissions was the Amendment 48 regression suite, written specifically to
hold the repair that the same tags were created to freeze. The tags contained the right code; their
CI job did not demonstrate it.

### The pattern this belongs to

This is the **third** hand-maintained list in this project to drift from the thing it enumerates:
`capture-blocked` missing from the status totals in `capture-v1.0.7`, `retrieved` missing in
Amendment 41, `eligible-not-selected` missing in Amendment 45. Each time the fix was to derive the
list rather than retype it. The same fix applies here.

### The rule

1. `capture/package.json`'s test script is `node --test test/*.test.mjs`. A glob cannot fall behind
   the directory; a list can, and did.
2. A test asserts it: the script must match that pattern, must name no file individually, and the
   suite it would run must cover every `*.test.mjs` present. The guard is itself one of those files,
   so it cannot be skipped by the mechanism it guards against.

The suite is now **543** tests — the 540 that existed plus three in the guard.

### What this does not change

`selection-v1.0.43`–`45`, `capture-v1.0.18`–`20` and `solo-protocol-v1.0.23`–`25` are all preserved
and unmoved, including the three revoked under Amendment 47. Nothing is deleted or recreated; this is
a forward-only correction, like every other in this sequence.

## Amendment 50 — a barrier the headed fallback cleared cost no coverage

*Frozen as `selection-v1.0.47`, `capture-v1.0.22` and `solo-protocol-v1.0.27`, 2 October 2026.*

No live record changes, no record is deleted, and no page is requested again. Every figure below is
re-derived from retained records.

### What was wrong

The Ministry for Culture and Heritage account-registration round reported **24 technical-attrition
records** over a category whose pages had in fact been read. Every origin in that estate bars
headless Chromium; the frozen headed fallback then read sixteen of those pages successfully. The
packet, the status totals, the published provenance, the agency resolution and the independent
sealer's resolution validation all counted the barred attempt and reported that coverage had been
lost.

The round's true accounting is:

| figure | count |
| --- | --- |
| barrier attempts recorded | 24 |
| recovered by the headed fallback | 16 |
| unresolved blocked records | 8 |
| distinct URLs those 8 represent | 7 |
| content URLs read and judged | 16, across 5 of 6 origins |

Study-wide: **80** active `retrieval-blocked` records comprise **40** recovered attempts and **40**
unresolved records, the unresolved 40 representing **30** distinct scoped URLs; with **10**
`robots-unestablished` records, **90** active technical-attrition records in all.

The distortion was not confined to a headline. Treating a recovered barrier as lost coverage makes
`agencyResolution` return `technical-discovery-attrition` for an agency whose every page was read —
and that resolution asserts the agency's discovery was **incomplete**. It is a claim about the
sample, and it was false. Had the Ministry for Culture and Heritage been exhausted under the earlier
reading, five fully-read origins would have been published as an incomplete search.

### Why a count of records was the wrong unit

A barrier attempt is an event in the harness. Lost coverage is a property of the sample. The two
differ in both directions: the harness retries, so eight unresolved records can represent seven
URLs; and the fallback succeeds, so sixteen barrier records can represent nothing lost at all. An
attrition figure is only interpretable if it says which it is counting.

### The rule

1. A barrier is **recovered** only when an explicit `followsDiscoveryId` chain ends in an unbarred
   `rendered` observation for the **same agency, category, round and canonical URL**, and that
   observation **itself carries a judgement**. An unjudged render establishes retrieval, not
   reading. An unrelated later render of the same URL recovers nothing: no record claims it
   followed from the barrier, and accepting it would let the harness excuse its own gaps.
2. A withdrawn recovery reopens the barrier; a withdrawn barrier is not attrition at all.
3. `robots-unestablished` and `retrieval-inconclusive` are never recoverable. No permission was
   established, so nothing was read under one.
4. Four figures are reported **separately**, never collapsed: barrier attempts recorded; attempts
   recovered by the headed fallback; unresolved blocked records **and** the distinct URLs they
   represent; `robots-unestablished` records.
5. Only **unresolved** attrition downgrades an agency's resolution.
6. The count beside a packet's `read` line is **content URLs**. A robots-policy record fetches no
   content, so it is not one — this is the correction that makes the Ministry for Culture and
   Heritage round 16 content URLs rather than 17 records.

### Where it is implemented

`barrierAccounting` in `capture/run.mjs` is the single derivation for the capture package, read by
the packet, the status totals, the published provenance and `agencyResolution`. The sealer carries
its own, `unresolvedAttrition` in `evaluation/solo/descriptive.mjs`, because `evaluation/` may not
import `capture/`. The sealer's is deliberately **stricter**: it matches URLs exactly where capture
canonicalises, so a difference it cannot resolve leaves the barrier unresolved and it reports the
weaker resolution rather than assuming the stronger one. All 50 follow-up links in the live log
carry byte-identical URLs, so the two do not diverge in practice; the asymmetry is recorded, with a
test, against the possibility that they ever do.

Adversarial tests in both packages — `capture/test/barrier-accounting.test.mjs` (22) and
`evaluation/solo/test/barrier-recovery.test.mjs` (14) — assert the near misses rather than the happy
path, assert that the two implementations agree on which barriers are unresolved over every fixture,
and assert that the two published blocks reconcile: `technicalAttrition.records` is a census of
records (92 ever, 90 active, 2 withdrawn) and `barriers` is the coverage reading (80 blocked
attempts = 40 recovered + 40 unresolved over 30 URLs). The published provenance previously carried
only the census, under a name a reader would quote as a coverage figure.

The capture suite is now **582** tests and the solo suite **152**.

### A fourth drifted list, found while freezing this

`evaluation/package.json` still named its test files individually, which is the defect Amendment 49
repaired in the capture package and whose guard checked that package alone. `test:solo` named three
files while five were on disk. The two omitted were the Amendment 50 suite above and
`revoked-tags.test.mjs` — the guard Amendment 47 added so that a revoked tag could never be
re-published, which had therefore **never run in CI**. Both evaluation scripts are now globs, and
`evaluation/solo/test/ci-covers-every-test.test.mjs` guards both of its test directories. Amendment
49's reasoning was right; only its scope was too narrow.

### A second omission in the same freeze

`solo-protocol-v1.0.26` was created, pushed and declared in Amendment 49, but the commit it points
at never bumped `SOLO_PROTOCOL_TAG` or `SOLO_SEALER_TAG`: both still read `solo-protocol-v1.0.25`.
For the whole of that freeze the sealer identified itself as a version behind the tag containing it.
Every freeze before it had bumped the constants in the same commit as the change; Amendment 49
touched only a test script and a guard, and the step was missed. Nothing failed, which is why it
went unnoticed — the sealer's identity is what a reader uses to tell which implementation produced a
seal, and no test compared it with anything.

The constants now read `solo-protocol-v1.0.27`, and no commit will ever have reported `v1.0.26`.
`evaluation/solo/test/frozen-tag.test.mjs` closes it: the analyser and the sealer must report the
same tag, that tag must be the latest version this document declares frozen, and it must not be a
revoked one. It is checked against this document rather than against git, so it holds in a shallow
CI clone with no tags fetched. Reintroducing the omission fails it with the version it expected.

### What this does not change

The frozen method, the frozen criteria, the priority order and the robots procedure are untouched.
No candidate selection and no agency qualification changes: the single exhausted agency, the Family
Violence and Sexual Violence Executive Board, has no attrition records of any kind, so its published
resolution stands unaltered. All earlier tags are preserved and unmoved, including the three revoked
under Amendment 47.

## Amendment 51 — a personal-name field that is a search key does not satisfy criterion 3

*Frozen as `selection-v1.0.47`, `capture-v1.0.22` and `solo-protocol-v1.0.27`, 2 October 2026.*

### What prompted it

Two Ministry for Culture and Heritage pages carry record-search forms whose controls are
`field_surname_value` labelled "Surname" and `field_forename_value` labelled "Forename(s)":
`28maoribattalion.org.nz` (record `d-0736`) and `vietnamwar.govt.nz` (record `d-0741`). Read
literally, criterion 3 — *asks for the name of a natural person* — is satisfied.

### The interpretation

It is not. These are **finding aids**: the name is a query against existing records, not something
the form collects, and the frozen annotation definition already excludes search boxes. Admitting
them would place a finding aid in a corpus of name-entry forms and measure the length limit of a
search key as though it constrained somebody's name. Both pages are also outside all four form
categories, so neither was a candidate on any other ground either.

Two boundaries follow, and they are independent:

1. **Collection versus querying.** The question is what the form does with the name: collects it as
   part of its own transaction, or uses it to query records that already exist. Only the first
   satisfies criterion 3.
2. **Not first-party versus third-party identity.** The rule is **not** limited to the submitter's
   own name. A service form asking for a child's, a dependent's, a representative's or any other
   natural person's name collects the name of a natural person and does satisfy criterion 3. Whose
   name it is does not matter; what the form does with it does.

### How it is applied

`classifyNameField` in `capture/capture.mjs` is pure and takes only the structural facts the page
yielded — field name, id, label, aria-label, the containing form's action, role, id and class, and
the labels of its visible submit controls. A name field reads as a **query** when it names itself a
search key, when the containing form's action or identity does, when the form carries
`role="search"`, or when **every** visible submit control in it is labelled as a query. Unanimity is
required for that last signal: a "Search" button beside "Apply" is a facility within a collection
form, not its purpose, and treating one such control as decisive would reclassify ordinary
application forms.

The classification is **reported, never decisive**. It bars nothing, excludes nothing, and does not
touch barrier detection — a mistake there would keep a page out of assessment altogether. The
researcher still asserts criterion 3 at the approval gate; this is the structural evidence that
assertion must be consistent with, exactly as Amendment 46 reports registration affordances without
declaring a page eligible.

`capture/test/criterion-three.test.mjs` (17 tests) fixes both boundaries against the two pages that
prompted them, against the name fields of captures already approved — which must keep them — and
against the near misses: a deceased person's name on an order form is collected, the same name on a
record search is not.

## Amendment 52 — a missing capture log is refused, never invented

*Frozen as `selection-v1.0.48`, `capture-v1.0.23` and `solo-protocol-v1.0.28`, 2 October 2026.*

No live record changes and no page is requested again. The capture log's SHA-256 is
`152d0d177ee1deb610a28339ef7b69b1d2d22fe6c680f8e123ea182624887744` before and after this
amendment.

### What was wrong

`readLog` returned `emptyLog()` for a path that did not exist. A mistyped `--out` therefore did not
fail — it answered, about a scan that had not happened.

It was found by running an approval exactly as written:

```
npm --prefix capture run approve-set -- --out evaluation/data/capture ...
```

which reads correctly from the repository root and is wrong. `npm run` executes with the **package**
directory as its cwd, so the path resolved to `capture/evaluation/data/capture`. The approval
reported `no candidate set for Ministry for Culture and Heritage / account-registration`. The same
slip on a read-only command reported:

```
agency:   Te Puni Kōkiri
category: account-registration
next:     record discovered candidates, then lock the set
```

That is agency 1 of the frozen draw order, completed five agencies earlier, presented as current
work — with a clean exit status.

### Why this is not a usability complaint

Nothing was written that time, but only because the command happened to be read-only. The same
mistake on a write command would have begun a **second log** in the wrong place. On a discovery
command it would have fetched `robots.txt` and issued permits against a log that believes no
politeness has yet been spent — so the pacing floor, the one-retry rule and the 24-hour robots
freshness window would all have been computed from an empty history while the real history sat in
another directory. An audit trail whose completeness is the whole claim cannot have a second copy
that nobody knows about.

This is the same defect family as the drifted lists of Amendments 41, 45, 49 and 50: a default that
makes a wrong input look like a valid state.

### The rule

1. `readLog` refuses a missing log. It never returns `emptyLog()` implicitly, and the default is
   removed rather than guarded at each of its thirty call sites.
2. `init --out <dir>` is the one way to start a scan. It is a **command**, not a flag: a general
   `--init` could accompany any other operation and create the very log that operation was supposed
   to find, which is this defect reintroduced one layer up.
3. `init` refuses a directory that already holds a log, and refuses one that holds capture
   artefacts (`captures/`, `rendered/`, `quarantine/`, the ledger, the provenance) beside no log —
   that state means a log was lost or the path is wrong, and a fresh log written there would
   disclaim the evidence next to it. It writes through a temporary file and renames, so no reader
   sees a partial log.
4. Every other command — `status`, `next`, `packet`, `budget`, discovery and capture alike —
   refuses before creating any directory, fetching `robots.txt`, issuing a permit or making any
   request. The refusal is first because `readLog` is first; a structural test holds that ordering.
5. The error prints the **resolved** path, because the difficulty is precisely that the operator
   cannot see the resolution in the command they typed, and it names `init`.

### Tests

`capture/test/fail-closed-log.test.mjs` (18) reproduces the original mistake rather than an
abstraction of it: it runs the CLI from the `capture/` directory — which is where
`npm --prefix capture run` puts the cwd — with the repository-root-relative path that looked right,
and asserts a non-zero exit, the resolved path in the message, no mention of agency 1, and that no
shadow directory is created. Read-only commands must fail rather than describe an empty scan.
Write and network commands must leave the temporary directory completely empty, which is how the
test establishes that no permit was issued and no `robots.txt` fetched. Explicit `init` is then
followed by normal operation. One test is structural, in the spirit of Amendment 49: it parses
`cli-capture.mjs` and asserts that no `do*` function creates a directory, writes a file, launches a
browser or fetches anything before it has reached `readLog`. That test passed before the fix — the
ordering was already right — and it is there so it stays right.

Fourteen of the first fifteen failed before the change and pass after it. Seven existing end-to-end
tests also failed, because they relied on the first command creating the log: `inTemp` now begins
with `init`, so the end-to-end path starts the way the operator's does.

`discovery`, `render-discovery` and `recheck-robots` are covered by name as well, since those are
the paths that would otherwise spend politeness against a log holding no record of what has already
been spent. They were added immediately after `selection-v1.0.48`, `capture-v1.0.23` and
`solo-protocol-v1.0.28` were pushed and CI passed: those tags are accurate for the commit they
point at, where the suite was 597, and the figures here describe the current head — 600 in the
capture suite and 152 in the solo suite. No tag is moved to accommodate the difference.

### The operating convention

Prefer running from the repository root with an absolute output path, which cannot be re-resolved
by whatever launches the command:

```
node capture/cli-capture.mjs status --out "$PWD/evaluation/data/capture"
```

### What this does not change

The frozen method, the frozen criteria, the priority order and the robots procedure are untouched.
The Ministry for Culture and Heritage account-registration set remains approved as recorded, with
`approvalNote: null` — the approval timestamp, the locked set, the packet and this protocol are the
audit trail, and a null note honestly records that none accompanied the decision rather than one
retrofitted afterwards. All earlier tags are preserved and unmoved, including the three revoked
under Amendment 47.

## Amendment 53 — one retrieval may settle two locked candidates, when a recorded redirect proves they are one page

*Frozen as `selection-v1.0.49`, `capture-v1.0.24` and `solo-protocol-v1.0.29`, 2 October 2026.*

No live record changes and no page is requested again. The rule is frozen before it is used.

### What happened

The Ministry for Culture and Heritage enquiry-or-contact round locked both
`https://teara.govt.nz/contact-us` and `https://teara.govt.nz/en/contact-us`. It had to: the frozen
canonicaliser keeps them distinct, and the bound is applied to URLs nobody has requested yet. An
earlier attempt to deduplicate them was **refused**, correctly — the judgements recording them
stated in terms that their identity had **not** been established, and a premise cannot be
disclaimed in one sentence and relied on in the next.

Requesting the first established it. `c-0950` recorded HTTP **301** to the second, with the hop
evaluated against the recorded robots policy (`r-0081`, no matching rule, allowed), a final URL of
`/en/contact-us`, and a served page carrying `<link rel="canonical" href="https://teara.govt.nz/en/contact-us">`.
Under this protocol's canonicalisation rule the page's own canonical link governs, so the two locked
URLs name one page — on evidence this time.

The evidence guard could not express that. It required a citation's URL to equal the retrieval's
requested URL, so the second candidate could be settled only by requesting a page already in hand.
A second request would have produced no new evidence and spent politeness to learn nothing.

### The rule

A citation whose URL differs from its retrieval's requested URL is permitted **only** when all of
the following hold. Each is read from what the retrieval recorded; nothing is inferred from how the
URLs look, because that inference is the one already rejected above.

1. The evidence source is an **active** `retrieved` attempt of the same **agency**, **category** and
   **set version**.
2. **Both** the source's requested URL and the decision URL are **locked candidates of that set**.
   So the rule can settle a duplicate the bound admitted, and can never reach a page the set never
   undertook to assess.
3. The source's recorded redirect chain is **continuous**, **starts** at the source URL and **ends**
   at the decision URL.
4. **Every** hop is recorded as `allowed: true`. An absent verdict is not a permission.
5. The source's `finalUrl` canonicalises **exactly** to the decision URL.
6. The existing file, digest and byte-length verification is unchanged and still mandatory.
7. **No permit and no navigation timestamp is copied.** The citation points at the retrieval, which
   keeps its own. Two decisions resting on one retrieval of one page is the intended outcome; two
   records claiming one *request* of two pages remains impossible.

### Enforced in three places

At **write time**, in `appendAttempt`, so a citation the redirects do not support cannot be recorded
at all. At the **corpus gate**, as `redirectEquivalenceAudit` — because a set can be reopened and
relocked *after* a decision is written, and an equivalence that rested on both URLs being locked
would then be resting on nothing. And **independently in the sealer**, which may not import the
capture package and re-derives the permission rather than trusting that the write-time check ran.

`capture/test/redirect-equivalence.test.mjs` (25) is mostly the refusals: an invented `finalUrl`, no
`finalUrl`, no chain, an empty chain, a chain starting or ending elsewhere, a chain broken between
hops, a hop refused by robots, a hop with no recorded verdict, evidence from another round,
category or agency, a decision URL the set never locked, a source URL the set never locked, an
unrelated target, and a source that is not an assessment-only retrieval. Every fixture is asserted
to produce the same verdict in both implementations, and the write-time guard is tested through
`appendAttempt` rather than through the rule alone. The capture suite is **625** tests and the solo
suite **152**.

### The bound operates on pre-request canonical URLs

This is the limitation the episode exposes, and it is a property of the frozen method rather than an
error in this round. Canonicalisation depends on a page's own `<link rel="canonical">`, which cannot
be known until the page is requested; the five-candidate bound is therefore applied to **URLs as
discovered**. Two discovered URLs that redirect to one page consume **two** of the five slots, so a
round may assess fewer distinct served pages than its bound suggests. This round locked five URLs
and reached **four** distinct pages.

Neither URL that fell beyond the bound is promoted to fill the gap. Promoting one would be
post-outcome selection: the slot became free only because assessment revealed the duplicate, and
reshaping a locked set in response to assessment evidence is what the locked-set rule exists to
prevent. The round reports four distinct pages and says why.

### What this does not change

The frozen method, the frozen criteria, the priority order, the canonicalisation rule and the robots
procedure are untouched. No candidate set is superseded and no record is deleted. All earlier tags
are preserved and unmoved, including the three revoked under Amendment 47.
