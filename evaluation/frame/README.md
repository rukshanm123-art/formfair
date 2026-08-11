# Sampling frame

Protocol section 1 and section 2. Frozen. Tagged `frame-v1.0.0`.

| | |
|---|---|
| Source | [CWAC Website scores](https://www.digital.govt.nz/standards-and-guidance/nz-government-web-standards/centralised-web-accessibility-checker-cwac/website-scores-cwac) |
| Retrieved | 2026-08-11T05:18:19Z |
| Scan date | 2026-06-30, from the page: *"Website scores are based on the 30 June 2026 scan."* |
| Page SHA-256 | `ac6a0c4eb5c6087c0766218808c7714974fd68220d0b02ddaaf9dbb212f2a933` |
| `frame.csv` SHA-256 | `11a0bcd30489648050dc287775d88cc4d99c54e2c9022b7226f157796df8c3ce` |
| `draw-order.csv` SHA-256 | `30dc8c27bbf601ce43da2d781c4bdff43db5dd074704268bb2532a21ce0fabf1` |
| Agencies | **45** |
| Websites | 504, of which 13 are marked "Not scanned" and are **retained** |

## The frame contains 45 agencies, not 47

The protocol anticipated approximately 47 participating agencies, taken from the CWAC
**agency leaderboard**. The **Website scores** page — which the protocol names as the
sampling frame — carries 45.

The page renders 47 `<details>` accordions, but two of them are explanatory panels rather
than agencies:

| Accordion | Title |
|---|---|
| `details-0` | How the scores are calculated |
| `details-1` | Scores are based on a random sample of web pages |

Both lack a CWAC scores table; every one of the other 45 has one and an agency-slug id.
`build-frame.mjs` selects on the presence of a `table-cwac` table for exactly this reason,
and both exclusions are recorded in `provenance.json`.

The frame is the Website scores page, so the frame is 45 agencies. The leaderboard has
not been substituted for it, and the frame has not been widened.

**Consequence for the target.** The protocol targets 40 eligible agencies from a frame of
45. At most 5 agencies may fail to yield an eligible form before the target is missed. A
shortfall was already accepted in advance; it is now more likely, and the achieved sample
is to be reported honestly either way.

## Retrieval method

The site is behind an Imperva JS challenge, so a plain HTTP client receives a 212-byte
stub rather than the page. No attempt was made to defeat that. The page was loaded in an
ordinary browser and saved as the rendered `document.documentElement.outerHTML`. The
SHA-256 computed in the page before saving matches the archived file byte for byte.

## Files

| File | |
|---|---|
| `cwac-website-scores-2026-08-11.html` | the dated copy of the page, as archived |
| `frame.csv` | agency to website mapping, one row per website |
| `provenance.json` | source, retrieval, scan date, hashes, counts, exclusions |
| `draw-order.csv` | the frozen agency order, protocol section 2 |
| `SHA256SUMS` | verify with `shasum -a 256 -c SHA256SUMS` |

## Rebuilding

```bash
cd evaluation
node src/build-frame.mjs frame/cwac-website-scores-2026-08-11.html
node src/cli-draw-order.mjs frame/frame.csv frame/draw-order.csv
```

`build-frame.mjs` asserts 45 agencies, 504 websites and 13 not-scanned entries, and
refuses to write the frame if the parse disagrees with the archived page. A silent
mis-parse would change the frame, and every draw position with it.

## Draw order

The order is SHA-256 of `evaluation-v1.0.0|<frame-sha256>|<agency-name>`, sorted by that
hash. It is a pure function of the tag, the frame's hash and the exact agency name, so
anyone holding the frame can recompute it, and any change to the frame visibly moves every
position at once.

Agency names are read with a quote-aware CSV reader. Splitting on the first comma
truncated *"Ministry of Business, Innovation and Employment"* to *"Ministry of Business"*,
which changed its draw key and moved it from position 3 to position 41. That is fixed, and
a regression test covers it.

No agency link has been followed and no candidate form has been visited.
