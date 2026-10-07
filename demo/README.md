# FormFair — demonstration interface

A single self-contained page that runs the FormFair analyser on markup you supply, so the
rules can be seen working.

**This is not part of the study.** It is not the evaluation instrument, it contributes to no
accuracy figure, and it is not run by any evaluation command. It consumes the library's
public entry point and contains no analysis logic of its own: if a finding looks wrong in
this page, it is wrong in the library.

## Using it

Open `formfair-demo.html` in a browser. Nothing else is required — no install, no server,
no network. The file carries the analyser and parse5 inside it.

Pick one of the synthetic examples, or paste your own form markup, and press **Analyse**.
Findings are grouped by rule and ordered by severity, each showing the field it concerns,
its position in the markup, the evidence the rule rested on, the markup it matched and the
remediation the catalogue gives. Advisories and declines are shown separately, below the
findings, because neither is scored.

**Export JSON** writes the analyser's own JSON report, produced by `toJsonString` from the
library, so what you export is what the study's own reports contain.

## What it does with your markup

Nothing leaves the page. The markup is parsed in the browser by the parse5 copy compiled
into the file. There is no upload, no storage, no telemetry and no analytics; the build
script fails loudly if a network API appears in the bundle. Closing the tab discards
everything.

## The examples

The examples in `src/examples.ts` are **synthetic** — written for this page to illustrate
constraint shapes. None is captured from a real website and none comes from the evaluation
corpus. That corpus is held out, and previewing it through a demonstration page is exactly
the early look the protocol's seal exists to prevent.

Two are worth looking at together. *Unicode-aware, but one character short* uses a careful
pattern that still rejects O’Brien, because that name is normally written with U+2019 rather
than the ASCII apostrophe. *Unicode-aware pattern (no findings)* admits U+2019 as well and
reports nothing. The difference between them is the kind of fault the catalogue exists to
find.

## Building

```
npm run build        # vite build, then inline into formfair-demo.html
npm run typecheck
```

`vite.config.ts` bundles parse5 and the analyser into the page, and leaves `jsdom` and
`axe-core` external: the library reaches those only through `await import(...)` in the
delegated accessibility provider, which this page never calls.

`inline.mjs` writes the bundle into the HTML so the result opens from a `file://` URL.
It passes a replacer **function** to `String.replace`, not a replacement string — a
replacement string expands `$&` and `` $` ``, which a minified bundle is full of, and doing
so silently produced a corrupt file larger than the bundle it inlined.

## Relationship to the rest of the repository

| Directory | What it is |
|---|---|
| `src/` | The analyser. Frozen at `evaluation-v1.1.0` for the study. |
| `evaluation/` | The evaluation harness and the solo descriptive protocol. |
| `capture/` | The capture instrument used for the descriptive scan. |
| `demo/` | This page. Consumes `src/`, changes nothing, and is read by no evaluation command. |
