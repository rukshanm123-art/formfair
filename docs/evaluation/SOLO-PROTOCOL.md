# FormFair Solo Evaluation Protocol

**Version 1.0 candidate. Dated 22 September 2026, before any government form was
captured or analysed.** Freeze this document as `solo-protocol-v1.0.0` together with the
new analyser as `evaluation-v1.1.0` before real-form capture begins. Existing catalogue,
frame, draw-order and historical harness tags are not moved.

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

1. Resolve the FF-02 catalogue/implementation conflict and pass all tests.
2. Freeze the analyser as `evaluation-v1.1.0` and record its commit and lockfile hash.
3. Freeze this protocol and the files under `evaluation/solo/` as
   `solo-protocol-v1.0.0`.
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
