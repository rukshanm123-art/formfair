/**
 * FormFair demonstration interface.
 *
 * This page exists to SHOW what the analyser reports. It is not part of the evaluation
 * instrument, it contributes nothing to any accuracy figure, and it contains no analysis
 * logic of its own: it calls `analyse()` from the published entry point and renders what
 * comes back. If a finding looks wrong here, it is wrong in the library.
 *
 * Everything runs in the page. The markup is parsed by parse5 compiled into this file,
 * nothing is uploaded, nothing is stored, and the page works with no network at all.
 */

import { analyse, CATALOGUE_VERSION, RULES, toJsonString } from '../../src/index.js';
import type { AnalysisResult, Finding, Severity } from '../../src/types.js';
import { EXAMPLES } from './examples.js';

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const escape = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** Findings grouped by rule, each group ordered by severity then position. */
function byRule(findings: readonly Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = groups.get(f.rule) ?? [];
    list.push(f);
    groups.set(f.rule, list);
  }
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.source.line - b.source.line ||
        a.source.column - b.source.column
    );
  }
  return new Map([...groups].sort((a, b) => a[0].localeCompare(b[0])));
}

/** The field a finding is about, named the way a developer would recognise it. */
function fieldLabel(f: Finding): string {
  const snippet = f.source.snippet;
  const name = /\bname\s*=\s*"([^"]*)"/.exec(snippet)?.[1];
  const id = /\bid\s*=\s*"([^"]*)"/.exec(snippet)?.[1];
  if (name) return `name="${name}"`;
  if (id) return `id="${id}"`;
  return `line ${f.source.line}`;
}

function renderSummary(result: AnalysisResult): string {
  const counts = { critical: 0, high: 0, medium: 0 } as Record<Severity, number>;
  for (const f of result.findings) counts[f.severity] += 1;
  const chip = (label: string, n: number, cls: string) =>
    `<span class="chip ${cls}"><b>${n}</b> ${escape(label)}</span>`;
  return `
    <div class="chips">
      ${chip('name controls', result.controls, 'neutral')}
      ${chip('findings', result.findings.length, result.findings.length ? 'bad' : 'good')}
      ${chip('critical', counts.critical, counts.critical ? 'critical' : 'neutral')}
      ${chip('high', counts.high, counts.high ? 'high' : 'neutral')}
      ${chip('medium', counts.medium, counts.medium ? 'medium' : 'neutral')}
      ${chip('advisories', result.advisories.length, 'neutral')}
      ${chip('declined', result.declined.length, 'neutral')}
    </div>`;
}

function renderFindings(result: AnalysisResult): string {
  if (result.controls === 0) {
    return `<p class="empty">No personal-name control was detected in this markup. FormFair only
      reports on controls it identifies as asking for a person's name.</p>`;
  }
  if (result.findings.length === 0) {
    return `<p class="empty good-text">No findings. ${result.controls} name control${
      result.controls === 1 ? '' : 's'
    } examined, and no rule reported an exclusionary constraint.</p>`;
  }
  const groups = byRule(result.findings);
  let html = '';
  for (const [ruleId, findings] of groups) {
    const basis = findings[0]?.basis ?? '';
    html += `<section class="rule">
      <h3><span class="rid">${escape(ruleId)}</span> ${findings.length} finding${
        findings.length === 1 ? '' : 's'
      }</h3>
      <p class="basis"><span class="k">Basis</span> ${escape(basis)}</p>`;
    for (const f of findings) {
      html += `<article class="finding sev-${f.severity}">
        <header>
          <span class="sev">${escape(f.severity)}</span>
          <span class="field">${escape(fieldLabel(f))}</span>
          <span class="loc">line ${f.source.line}, col ${f.source.column}</span>
        </header>
        <p class="msg">${escape(f.message)}</p>
        <p class="k">Evidence</p>
        <pre class="evidence">${escape(f.evidence)}</pre>
        <p class="k">Markup</p>
        <pre class="snippet">${escape(f.source.snippet)}</pre>
        <p class="k">Remediation</p>
        <p class="remediation">${escape(f.remediation)}</p>
      </article>`;
    }
    html += `</section>`;
  }
  return html;
}

function renderAside(result: AnalysisResult): string {
  let html = '';
  if (result.advisories.length) {
    html += `<section class="aside"><h3>Advisories <span class="muted">reported, never scored</span></h3>
      <p class="muted">An advisory records a constraint that <em>could</em> exclude a name without
      witnessing that it does. These are excluded from every accuracy figure.</p>`;
    for (const a of result.advisories) {
      html += `<article class="advisory">
        <header><span class="rid">${escape(a.code)}</span>
        <span class="loc">line ${a.source.line}, col ${a.source.column}</span></header>
        <p class="msg">${escape(a.message)}</p>
        <p class="basis"><span class="k">Basis</span> ${escape(a.basis)}</p>
      </article>`;
    }
    html += `</section>`;
  }
  if (result.declined.length) {
    html += `<section class="aside"><h3>Declined <span class="muted">outside the decidable subset</span></h3>
      <p class="muted">A decline is not silence. The rule reports that it could not decide, so decision
      coverage can be stated alongside accuracy.</p>`;
    for (const d of result.declined) {
      html += `<article class="advisory">
        <header><span class="rid">${escape(d.rule)}</span>
        <span class="loc">line ${d.source.line}, col ${d.source.column}</span></header>
        <p class="msg">${escape(d.reason)}</p>
      </article>`;
    }
    html += `</section>`;
  }
  return html;
}

let lastResult: AnalysisResult | null = null;

function run(): void {
  const html = $<HTMLTextAreaElement>('input').value;
  const started = performance.now();
  let result: AnalysisResult;
  try {
    result = analyse(html);
  } catch (error) {
    $('summary').innerHTML = '';
    $('findings').innerHTML = `<p class="empty bad-text">The analyser could not parse that markup: ${escape(
      error instanceof Error ? error.message : String(error)
    )}</p>`;
    $('aside').innerHTML = '';
    lastResult = null;
    return;
  }
  const ms = performance.now() - started;
  lastResult = result;
  $('summary').innerHTML = renderSummary(result);
  $('findings').innerHTML = renderFindings(result);
  $('aside').innerHTML = renderAside(result);
  $('timing').textContent = `analysed in ${ms.toFixed(1)} ms, entirely in this page`;
  $<HTMLButtonElement>('export').disabled = false;
}

function exportJson(): void {
  if (!lastResult) return;
  const blob = new Blob([toJsonString(lastResult)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'formfair-demo-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

function mount(): void {
  const picker = $<HTMLSelectElement>('examples');
  for (const ex of EXAMPLES) {
    const opt = document.createElement('option');
    opt.value = ex.id;
    opt.textContent = ex.title;
    picker.append(opt);
  }
  picker.addEventListener('change', () => {
    const ex = EXAMPLES.find((e) => e.id === picker.value);
    if (!ex) return;
    $<HTMLTextAreaElement>('input').value = ex.html;
    $('note').textContent = ex.note;
    run();
  });

  $('run').addEventListener('click', run);
  $('export').addEventListener('click', exportJson);
  $('clear').addEventListener('click', () => {
    $<HTMLTextAreaElement>('input').value = '';
    $('note').textContent = '';
    $('summary').innerHTML = '';
    $('findings').innerHTML = '';
    $('aside').innerHTML = '';
    $('timing').textContent = '';
    lastResult = null;
    $<HTMLButtonElement>('export').disabled = true;
  });

  $('catalogue').textContent = `rule catalogue ${CATALOGUE_VERSION} — ${RULES.map((r) => r.id).join(', ')}`;

  // Open on the first example so the page shows something immediately.
  picker.value = EXAMPLES[0]?.id ?? '';
  picker.dispatchEvent(new Event('change'));
}

mount();
