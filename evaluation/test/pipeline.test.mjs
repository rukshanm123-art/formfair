/**
 * The complete pipeline on synthetic HTML: inventory, annotation, seal, evaluation, join,
 * metrics. Protocol section 4 - built and tested against development material only.
 *
 * This is the suite that exercises the analyser and the harness together. It resolves
 * parse5 and the built instrument from the repository root, which is where the frozen
 * versions live; if either is absent the suite says so rather than passing quietly.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { buildInventory, matchDetected, sha256, isSupportedInput } from '../src/inventory.mjs';
import { joinPage, buildDataset } from '../src/join.mjs';
import { validateDataset } from '../src/schema.mjs';
import { report as metricsReport } from '../src/metrics.mjs';
import { verifyClosedSeal } from '../src/seal.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const require = createRequire(import.meta.url);

/** Synthetic pages. Every one is invented; none is or may become a captured page. */
const PAGES = {
  'synthetic-a': `<!doctype html><html><body>
<form>
  <label for="fn">First name</label>
  <input id="fn" name="firstName" type="text" pattern="[A-Za-z]{2,40}" minlength="2" maxlength="40">
  <label for="ln">Last name</label>
  <input id="ln" name="lastName" pattern="[\\p{L}\\p{M}\\u0027\\u2019 \\x2D]+">
  <input type="search" name="q" aria-label="Search this site">
  <input type="email" name="email">
</form>
</body></html>`,
  'synthetic-b': `<!doctype html><html><body>
<form>
  <label>Preferred name <input name="preferredName"></label>
  <input name="company_name" type="text">
</form>
</body></html>`,
};

let parse5;
let formfair;
let available = true;

before(async () => {
  try {
    parse5 = require('parse5');
    formfair = await import(join(root, 'dist', 'index.js'));
  } catch {
    available = false;
  }
});

const skipUnlessBuilt = () => {
  if (!available) {
    assert.fail(
      'parse5 or dist/index.js is missing. Run `npm ci && npm run build` at the repository ' +
        'root: the inventory must be parsed by the instrument\'s own pinned parser.'
    );
  }
};

describe('inventory', () => {
  test('lists exactly the inputs the frozen stage one considers', () => {
    skipUnlessBuilt();
    const inv = buildInventory({
      html: PAGES['synthetic-a'],
      pageId: 'synthetic-a',
      parseFragment: parse5.parseFragment,
      parserVersion: '7.3.0',
    });
    // text, missing-type and search are in; email is not.
    assert.deepEqual(inv.controls.map((c) => c.inputType), ['text', null, 'search']);
  });

  test('is neutral: it does not consult FormFair', () => {
    skipUnlessBuilt();
    const inv = buildInventory({
      html: PAGES['synthetic-b'],
      pageId: 'synthetic-b',
      parseFragment: parse5.parseFragment,
      parserVersion: '7.3.0',
    });
    // company_name is not a personal-name control, but it is a supported input, so it is
    // in the inventory and must be annotated. Omitting it would hide a false positive.
    assert.equal(inv.controls.length, 2);
  });

  test('records the page hash and a snippet hash per control', () => {
    skipUnlessBuilt();
    const inv = buildInventory({
      html: PAGES['synthetic-a'],
      pageId: 'synthetic-a',
      parseFragment: parse5.parseFragment,
      parserVersion: '7.3.0',
    });
    assert.match(inv.htmlSha256, /^[0-9a-f]{64}$/);
    for (const c of inv.controls) assert.match(c.snippetSha256, /^[0-9a-f]{64}$/);
  });

  test('is stable across rebuilds of identical bytes', () => {
    skipUnlessBuilt();
    const build = () =>
      buildInventory({
        html: PAGES['synthetic-a'],
        pageId: 'synthetic-a',
        parseFragment: parse5.parseFragment,
        parserVersion: '7.3.0',
      });
    assert.deepEqual(build(), build());
  });

  test('a control whose snippet changed no longer matches its record', () => {
    skipUnlessBuilt();
    const inv = buildInventory({
      html: PAGES['synthetic-a'],
      pageId: 'synthetic-a',
      parseFragment: parse5.parseFragment,
      parserVersion: '7.3.0',
    });
    const record = inv.controls[0];
    const wrong = matchDetected(inv, { line: record.line, column: record.column, snippet: '<input name="other">' });
    assert.ok(wrong.error);
    assert.match(wrong.error, /snippet differs/);
  });

  test('a position the inventory does not contain is an error, not a guess', () => {
    skipUnlessBuilt();
    const inv = buildInventory({
      html: PAGES['synthetic-a'],
      pageId: 'synthetic-a',
      parseFragment: parse5.parseFragment,
      parserVersion: '7.3.0',
    });
    const missing = matchDetected(inv, { line: 999, column: 1, snippet: '<input>' });
    assert.match(missing.error, /does not contain/);
  });

  test('the supported-input test agrees with the protocol', () => {
    assert.equal(isSupportedInput('input', []), true, 'missing type is supported');
    assert.equal(isSupportedInput('input', [{ name: 'type', value: 'TEXT' }]), true);
    assert.equal(isSupportedInput('input', [{ name: 'type', value: ' search ' }]), true);
    assert.equal(isSupportedInput('input', [{ name: 'type', value: 'email' }]), false);
    assert.equal(isSupportedInput('textarea', []), false);
  });
});

/** Runs the whole pipeline for one page and returns everything it produced. */
function runPipeline(pageId, truth) {
  const html = PAGES[pageId];
  const inventory = buildInventory({
    html,
    pageId,
    parseFragment: parse5.parseFragment,
    parserVersion: '7.3.0',
  });
  const detected = formfair.findNameControls(html);
  const report = formfair.toJson(formfair.analyse(html));
  return { inventory, detected, report, joined: joinPage({ inventory, truth, detected, report }) };
}

/** Ground truth for the synthetic pages, as an adjudicated file would supply it. */
function truthFor(inventory, nameControlOrdinals, rules) {
  const truth = {};
  for (const c of inventory.controls) {
    truth[c.controlId] = nameControlOrdinals.includes(c.ordinal)
      ? { isNameControl: true, rules }
      : { isNameControl: false };
  }
  return truth;
}

describe('join', () => {
  const ALL_POSITIVE = { 'FF-01': 'positive', 'FF-02': 'negative', 'FF-03': 'negative', 'FF-04': 'positive', 'FF-05': 'positive' };

  test('matches every detected control to exactly one inventory record', () => {
    skipUnlessBuilt();
    const inv = buildInventory({ html: PAGES['synthetic-a'], pageId: 'synthetic-a', parseFragment: parse5.parseFragment, parserVersion: '7.3.0' });
    const { joined } = runPipeline('synthetic-a', truthFor(inv, [0, 1], ALL_POSITIVE));
    assert.deepEqual(joined.problems, []);
  });

  test('gives every detected name control exactly one outcome per rule', () => {
    skipUnlessBuilt();
    const inv = buildInventory({ html: PAGES['synthetic-a'], pageId: 'synthetic-a', parseFragment: parse5.parseFragment, parserVersion: '7.3.0' });
    const { joined } = runPipeline('synthetic-a', truthFor(inv, [0, 1], ALL_POSITIVE));
    for (const c of joined.page.controls) {
      if (!c.isNameControl || !c.detected) continue;
      assert.deepEqual(Object.keys(c.outcomes).sort(), ['FF-01', 'FF-02', 'FF-03', 'FF-04', 'FF-05']);
      for (const o of Object.values(c.outcomes)) {
        assert.ok(['finding', 'clean', 'declined'].includes(o));
      }
    }
  });

  test('an undetected control carries no outcomes', () => {
    skipUnlessBuilt();
    const inv = buildInventory({ html: PAGES['synthetic-b'], pageId: 'synthetic-b', parseFragment: parse5.parseFragment, parserVersion: '7.3.0' });
    // Claim the non-name control is a name control the tool should have found.
    const { joined } = runPipeline('synthetic-b', truthFor(inv, [0, 1], ALL_POSITIVE));
    const missed = joined.page.controls.find((c) => !c.detected);
    assert.ok(missed, 'the fixture must contain a control the tool does not detect');
    assert.equal(missed.outcomes, undefined);
  });

  test('objects when the report and findNameControls disagree on the count', () => {
    skipUnlessBuilt();
    const inv = buildInventory({ html: PAGES['synthetic-a'], pageId: 'synthetic-a', parseFragment: parse5.parseFragment, parserVersion: '7.3.0' });
    const detected = formfair.findNameControls(PAGES['synthetic-a']);
    const report = formfair.toJson(formfair.analyse(PAGES['synthetic-a']));
    report.summary = { ...report.summary, controls: report.summary.controls + 1 };
    const { problems } = joinPage({ inventory: inv, truth: truthFor(inv, [0, 1], ALL_POSITIVE), detected, report });
    assert.match(problems.join(' '), /two views of one run disagree/);
  });

  test('objects when a finding maps to no detected control', () => {
    skipUnlessBuilt();
    const inv = buildInventory({ html: PAGES['synthetic-a'], pageId: 'synthetic-a', parseFragment: parse5.parseFragment, parserVersion: '7.3.0' });
    const detected = formfair.findNameControls(PAGES['synthetic-a']);
    const report = formfair.toJson(formfair.analyse(PAGES['synthetic-a']));
    report.findings = [...report.findings, { rule: 'FF-01', line: 999, column: 1 }];
    const { problems } = joinPage({ inventory: inv, truth: truthFor(inv, [0, 1], ALL_POSITIVE), detected, report });
    assert.match(problems.join(' '), /maps to no detected control/);
  });

  test('objects when a control has no adjudicated ground truth', () => {
    skipUnlessBuilt();
    const inv = buildInventory({ html: PAGES['synthetic-a'], pageId: 'synthetic-a', parseFragment: parse5.parseFragment, parserVersion: '7.3.0' });
    const truth = truthFor(inv, [0, 1], ALL_POSITIVE);
    delete truth[inv.controls[2].controlId];
    const { problems } = joinPage({ inventory: inv, truth, detected: formfair.findNameControls(PAGES['synthetic-a']), report: formfair.toJson(formfair.analyse(PAGES['synthetic-a'])) });
    assert.match(problems.join(' '), /no adjudicated ground truth/);
  });

  test('objects when the analysed bytes are not the captured bytes', () => {
    skipUnlessBuilt();
    // An inventory built from one page, joined against a run over a different one.
    const inv = buildInventory({ html: PAGES['synthetic-b'], pageId: 'synthetic-b', parseFragment: parse5.parseFragment, parserVersion: '7.3.0' });
    const { problems } = joinPage({
      inventory: inv,
      truth: truthFor(inv, [0], ALL_POSITIVE),
      detected: formfair.findNameControls(PAGES['synthetic-a']),
      report: formfair.toJson(formfair.analyse(PAGES['synthetic-a'])),
    });
    assert.ok(problems.length > 0, 'a mismatched page must not join cleanly');
  });
});

describe('the joined dataset feeds the metrics', () => {
  test('passes the frozen schema and scores', () => {
    skipUnlessBuilt();
    const ALL = { 'FF-01': 'positive', 'FF-02': 'negative', 'FF-03': 'negative', 'FF-04': 'positive', 'FF-05': 'positive' };
    const pages = Object.keys(PAGES).map((pageId) => {
      const inventory = buildInventory({ html: PAGES[pageId], pageId, parseFragment: parse5.parseFragment, parserVersion: '7.3.0' });
      return {
        inventory,
        truth: truthFor(inventory, [0], ALL),
        detected: formfair.findNameControls(PAGES[pageId]),
        report: formfair.toJson(formfair.analyse(PAGES[pageId])),
      };
    });

    const { dataset, problems, datasetSha256 } = buildDataset({
      pages,
      hashes: { inventory: sha256('inv'), annotation: sha256('ann'), adjudication: sha256('adj'), reports: sha256('rep') },
    });
    assert.deepEqual(problems, []);

    const { valid, problems: schemaProblems } = validateDataset(dataset);
    assert.equal(valid, true, schemaProblems.join('; '));

    assert.match(datasetSha256, /^[0-9a-f]{64}$/);
    for (const key of ['inventorySha256', 'annotationSha256', 'adjudicationSha256', 'reportsSha256']) {
      assert.match(dataset.builtFrom[key], /^[0-9a-f]{64}$/, `${key} must be recorded`);
    }
    assert.equal(Object.keys(dataset.builtFrom.htmlSha256ByPage).length, 2);

    const result = metricsReport(dataset.pages);
    assert.ok(result.stageOne.counts.tp >= 1, 'the pipeline detects at least one true name control');
    assert.equal(result.unscored.scored, false);
  });
});

describe('the seal must be closed before official metrics', () => {
  test('a pre-run seal is refused', () => {
    const manifest = {
      instrument: 'evaluation-v1.0.0',
      files: {
        annotatorA: { path: 'a', sha256: 'x' },
        annotatorB: { path: 'b', sha256: 'x' },
        kappa: { path: 'k', sha256: 'x' },
        adjudication: { path: 'j', sha256: 'x' },
      },
    };
    const { sealed, failures } = verifyClosedSeal(manifest, () => '/does/not/exist');
    assert.equal(sealed, false);
    assert.match(failures.join(' '), /has not been closed/);
  });

  test('a closed seal must name the run and what it produced', () => {
    const manifest = {
      instrument: 'evaluation-v1.0.0',
      files: {},
      formfairRun: { runAt: '2026-09-01T00:00:00Z', instrument: 'evaluation-v1.0.0' },
    };
    const { failures } = verifyClosedSeal(manifest, () => '/does/not/exist');
    assert.match(failures.join(' '), /reportsSha256/);
    assert.match(failures.join(' '), /datasetSha256/);
    assert.match(failures.join(' '), /inventorySha256/);
  });
});
