# Browser differential — EXPLORATORY

**This is exploratory work. It is excluded from the formal results, is not cited in
`SOLO-PROTOCOL.md`, and no claim in the study rests on it.**

## What it is

It asks a real browser, for every benchmark control crossed with every fixture name and
character, whether the control's declared constraints reject that name — then checks each
finding FormFair reports against whether such a rejection actually occurs. Against
`evaluation-v1.0.0` it corroborated 62 of 62 non-vacuous findings, contradicted none, and
found no missed exclusions, over 828 name decisions and 972 character decisions.

## Why it is not formal evidence

Three reasons, any one of which is sufficient.

1. **It measures the superseded instrument.** `evaluation/src/instrument-ref.mjs` pins
   `evaluation-v1.0.0`, so the recorded run describes the analyser *before* the FF-02
   correction. It is therefore historical, not evidence about the active tool.
2. **Its miss detection is too weak to report.** A missed exclusion is only counted when
   FormFair reports no rule at all for a control. If one rule fires and another that should
   have fired does not, that goes unnoticed. A recall-style claim needs per-rule expected
   outcomes, which this does not have.
3. **It is not gated.** There is no npm script and no CI job, so nothing keeps it honest as
   the tool changes.

## What it would take to promote it

Point it at the solo instrument resolver rather than `instrument-ref.mjs` so it runs
against `evaluation-v1.1.0`; give every control a per-rule expected outcome so a specific
missed rule is detectable; add an npm command and a CI gate; and name it in the protocol
before the protocol is frozen. Until all four are done it stays here, and the study makes
no use of it.

The mutation study's browser confirmation in `evaluation/solo/` is the formal
browser-backed evidence, and it is separate from this.
