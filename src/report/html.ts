import type { AnalysisResult, Severity } from '../types.js';
import { sortFindings, summarise } from './summary.js';

const COLOUR: Readonly<Record<Severity, string>> = {
  critical: '#b3261e',
  high: '#8a5a00',
  medium: '#3b5d78',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
:root { color-scheme: light dark; }
body { font: 15px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; padding: 2rem;
       max-width: 60rem; background: Canvas; color: CanvasText; }
h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
.meta { color: GrayText; font-size: .85rem; margin-bottom: 1.75rem; }
.tally { display: flex; gap: 1.5rem; flex-wrap: wrap; padding: .9rem 1.1rem; margin-bottom: 2rem;
         border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 6px; }
.tally div { font-size: .85rem; color: GrayText; }
.tally strong { display: block; font-size: 1.4rem; color: CanvasText; font-weight: 600; }
.finding { border-left: 3px solid var(--c); padding: .1rem 0 .1rem 1rem; margin-bottom: 1.75rem; }
.head { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
.sev { color: var(--c); font-weight: 600; font-size: .78rem; letter-spacing: .06em; }
.rule { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; color: GrayText; }
.msg { margin: .35rem 0 .6rem; font-weight: 500; }
dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: .3rem .9rem; font-size: .9rem; }
dt { color: GrayText; }
dd { margin: 0; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; }
pre { overflow-x: auto; padding: .55rem .7rem; border-radius: 4px;
      background: color-mix(in srgb, CanvasText 6%, transparent); margin: .3rem 0 0; }
table { border-collapse: collapse; font-size: .88rem; margin-top: .5rem; }
th, td { text-align: left; padding: .35rem 1.2rem .35rem 0; }
th { font-weight: 600; color: GrayText; font-size: .8rem; }
h2 { font-size: .95rem; margin: 2.5rem 0 .3rem; }
.note { color: GrayText; font-size: .85rem; }
`;

/**
 * Standalone HTML report. Self-contained so it can be saved or attached to a
 * ticket without a build step or network access.
 */
export function toHtml(result: AnalysisResult): string {
  const s = summarise(result);
  const findings = sortFindings(result.findings);

  const cards = findings
    .map(
      (f) => `<div class="finding" style="--c:${COLOUR[f.severity]}">
  <div class="head">
    <span class="sev">${f.severity.toUpperCase()}</span>
    <span class="rule">${f.rule}</span>
    <span class="rule">line ${f.source.line}</span>
  </div>
  <p class="msg">${escapeHtml(f.message)}</p>
  <dl>
    <dt>Evidence</dt><dd>${escapeHtml(f.evidence)}</dd>
    <dt>Remediation</dt><dd>${escapeHtml(f.remediation)}</dd>
  </dl>
  ${f.source.snippet ? `<pre>${escapeHtml(f.source.snippet)}</pre>` : ''}
</div>`
    )
    .join('\n');

  const coverage = s.byRule
    .map(
      (r) =>
        `<tr><td><code>${r.rule}</code></td><td>${Math.round(r.decisionCoverage * 100)}%</td>` +
        `<td>${r.findings}</td><td>${r.declined || ''}</td></tr>`
    )
    .join('\n');

  const body =
    s.controls === 0
      ? '<p class="note">No personal-name controls identified in this markup.</p>'
      : `<div class="tally">
  <div><strong>${s.controls}</strong>name controls</div>
  <div><strong>${s.totalFindings}</strong>findings</div>
  <div><strong>${s.bySeverity.critical}</strong>critical</div>
  <div><strong>${s.bySeverity.high}</strong>high</div>
  <div><strong>${s.bySeverity.medium}</strong>medium</div>
</div>
${cards}
<h2>Decision coverage</h2>
<p class="note">The proportion of controls each rule reached a decision on. A declined control was not analysed, which is not the same as clean.</p>
<table>
  <tr><th>Rule</th><th>Coverage</th><th>Findings</th><th>Declined</th></tr>
  ${coverage}
</table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FormFair report</title>
<style>${STYLE}</style>
</head>
<body>
<h1>FormFair report</h1>
<p class="meta">Rule catalogue ${escapeHtml(s.catalogueVersion)}</p>
${body}
</body>
</html>`;
}
