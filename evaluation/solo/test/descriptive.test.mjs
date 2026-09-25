import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  analyseDescriptively,
  loadSealedPages,
  sealCorpus,
  FROZEN_FRAME_SHA256,
  FROZEN_DRAW_ORDER_SHA256,
  EXHAUSTION_REASON,
  MAX_QUALIFIED_AGENCIES,
  EXHAUSTION_CATEGORIES,
} from '../descriptive.mjs';
import { loadSoloInstrument, SOLO_INSTRUMENT_TAG } from '../instrument.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const { identity, core } = await loadSoloInstrument(repo, { development: true });
const require = createRequire(join(repo, 'package.json'));
const parse5 = await import(pathToFileURL(require.resolve('parse5')).href);

const inTemp = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'formfair-solo-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

function draft() {
  return {
    schema: 'formfair/solo-corpus-draft@1',
    synthetic: true,
    frameSha256: FROZEN_FRAME_SHA256,
    drawOrderSha256: FROZEN_DRAW_ORDER_SHA256,
    selectionLedgerFile: 'selection-ledger.csv',
    pages: [
      {
        pageId: 'synthetic-001',
        agency: 'Synthetic Agency',
        website: 'https://example.invalid/',
        originalUrl: 'https://example.invalid/contact',
        finalUrl: 'https://example.invalid/contact',
        capturedAt: '2026-09-22T00:00:00Z',
        browser: 'synthetic browser',
        automationTool: 'synthetic capture',
        viewport: { width: 1280, height: 800 },
        locale: 'en-NZ',
        redirects: [],
        category: 'enquiry-or-contact',
        file: 'synthetic-001.html',
      },
    ],
  };
}

function prepare(dir) {
  writeFileSync(join(dir, 'selection-ledger.csv'), 'agency,status\nSynthetic Agency,captured\n');
  writeFileSync(
    join(dir, 'synthetic-001.html'),
    '<form><label for="n">Full name</label><input id="n" pattern="[A-Za-z]+"><input name="email" type="email"></form>'
  );
  const sealed = sealCorpus({ draft: draft(), capturesDir: dir, instrument: identity });
  assert.ok(sealed.manifest, sealed.problems.join('; '));
  const manifestPath = join(dir, 'corpus.json');
  writeFileSync(manifestPath, `${JSON.stringify(sealed.manifest, null, 2)}\n`);
  return { manifest: sealed.manifest, manifestPath };
}

describe('corpus seal', () => {
  test('binds the frame, draw order, selection ledger, metadata, and captured bytes', async () => {
    await inTemp(async (dir) => {
      const { manifest, manifestPath } = prepare(dir);
      const loaded = loadSealedPages({ manifest, manifestPath, capturesDir: dir });
      assert.ok(loaded.pages, loaded.problems.join('; '));
      assert.equal(loaded.pages.length, 1);
      assert.match(manifest.pages[0].sha256, /^[0-9a-f]{64}$/);
      assert.match(manifest.selectionLedger.sha256, /^[0-9a-f]{64}$/);
    });
  });

  test('refuses changed markup and a changed selection ledger', async () => {
    await inTemp(async (dir) => {
      const { manifest, manifestPath } = prepare(dir);
      writeFileSync(join(dir, 'synthetic-001.html'), '<form>changed</form>');
      writeFileSync(join(dir, 'selection-ledger.csv'), 'changed');
      const loaded = loadSealedPages({ manifest, manifestPath, capturesDir: dir });
      assert.equal(loaded.pages, null);
      assert.match(loaded.problems.join(' '), /hash mismatch/);
      assert.match(loaded.problems.join(' '), /selection ledger/);
    });
  });
});

describe('real-world output is deliberately descriptive', () => {
  test('reports applicability and tool outputs without accuracy or defect-prevalence fields', async () => {
    await inTemp(async (dir) => {
      const { manifest, manifestPath } = prepare(dir);
      const loaded = loadSealedPages({ manifest, manifestPath, capturesDir: dir });
      const report = await analyseDescriptively({
        pages: loaded.pages,
        analysePage: (html) => core.analyseWith(html),
        findNameControls: core.findNameControls,
        parseFragment: parse5.parseFragment,
        instrument: identity,
        manifest: { ...manifest, sha256: loaded.manifestSha256 },
      });
      assert.equal(report.counts.supportedInputs, 1);
      assert.equal(report.counts.toolDetectedNameControls, 1);
      assert.equal(report.toolOutput.findingsByRule['FF-01'], 1);
      assert.match(report.interpretation.prohibited, /not human-confirmed defects/i);
      const text = JSON.stringify(report);
      assert.doesNotMatch(text, /"precision"\s*:/i);
      assert.doesNotMatch(text, /"recall"\s*:/i);
      assert.doesNotMatch(text, /"F1"\s*:/i);
      assert.doesNotMatch(text, /<input/i, 'published report must not reproduce captured markup');
      assert.equal(readFileSync(join(dir, 'synthetic-001.html'), 'utf8').includes('<input'), true);
    });
  });

  test('the real CLIs seal and analyse a synthetic corpus end to end', async () => {
    await inTemp(async (dir) => {
      writeFileSync(join(dir, 'selection-ledger.csv'), 'agency,status\nSynthetic Agency,captured\n');
      writeFileSync(
        join(dir, 'synthetic-001.html'),
        '<form><label for="n">Full name</label><input id="n" pattern="[A-Za-z]+"></form>'
      );
      const draftPath = join(dir, 'draft.json');
      const manifestPath = join(dir, 'manifest.json');
      const reportPath = join(dir, 'report.json');
      writeFileSync(draftPath, `${JSON.stringify(draft(), null, 2)}\n`);

      const env = { ...process.env, FORMFAIR_SOLO_INSTRUMENT_DIR: repo };
      const seal = spawnSync(
        process.execPath,
        [join(repo, 'evaluation', 'solo', 'cli-seal-corpus.mjs'), '--draft', draftPath, '--captures', dir, '--out', manifestPath, '--synthetic', '--development'],
        { cwd: repo, env, encoding: 'utf8' }
      );
      assert.equal(seal.status, 0, seal.stderr);

      const run = spawnSync(
        process.execPath,
        [join(repo, 'evaluation', 'solo', 'cli-descriptive.mjs'), '--manifest', manifestPath, '--captures', dir, '--out', reportPath, '--synthetic', '--development'],
        { cwd: repo, env, encoding: 'utf8' }
      );
      assert.equal(run.status, 0, run.stderr);
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      assert.equal(report.corpus.synthetic, true);
      assert.equal(report.counts.toolDetectedNameControls, 1);
      assert.equal(report.toolOutput.findingsByRule['FF-01'], 1);
      assert.equal(report.toolOutput.delegated.scored, false);
    });
  });
});


describe('the corpus seal verifies the frame rather than trusting the draft', () => {
  test('a fabricated frame hash is refused', () => {
    // The defect this closes: the seal checked only that the declared digests were 64 hex
    // characters, so a draft could assert any value - including sixty-four zeros - and seal
    // successfully. This is the same failure the evaluation seal had earlier.
    for (const key of ['frameSha256', 'drawOrderSha256']) {
      const bad = { ...draft(), [key]: '0'.repeat(64) };
      const sealed = sealCorpus({ draft: bad, capturesDir: here, instrument: identity });
      assert.ok(!sealed.manifest, `${key} was accepted when fabricated`);
      assert.ok(
        sealed.problems.some((p) => p.includes(key) && p.includes('hashes to')),
        `expected ${key} to be refused by content, got: ${sealed.problems.join(' | ')}`
      );
    }
  });

  test('a modified frame on disk is refused even when the draft agrees with it', () => {
    // Declaring the modified file's own hash must not launder it: the seal pins the
    // frame-v1.0.0 content, because a different frame produces a different sample.
    const dir = mkdtempSync(join(tmpdir(), 'formfair-frame-'));
    writeFileSync(join(dir, 'frame.csv'), 'agency,website\nTampered,example.govt.nz\n');
    writeFileSync(join(dir, 'draw-order.csv'), 'agency,hash\nTampered,00\n');
    const tamperedFrame = createHash('sha256')
      .update(readFileSync(join(dir, 'frame.csv')))
      .digest('hex');
    const tampered = { ...draft(), frameSha256: tamperedFrame };
    const sealed = sealCorpus({
      draft: tampered,
      capturesDir: here,
      instrument: identity,
      frameDir: dir,
    });
    rmSync(dir, { recursive: true, force: true });
    assert.ok(!sealed.manifest);
    assert.ok(
      sealed.problems.some((p) => p.includes('no longer the frozen one')),
      sealed.problems.join(' | ')
    );
  });

  test('the frozen digests are the ones recorded with the frame', () => {
    const frameDir = new URL('../../frame/', import.meta.url);
    const digest = (f) =>
      createHash('sha256').update(readFileSync(new URL(f, frameDir))).digest('hex');
    assert.equal(digest('frame.csv'), FROZEN_FRAME_SHA256);
    assert.equal(digest('draw-order.csv'), FROZEN_DRAW_ORDER_SHA256);
  });
});

/**
 * The seal must require and preserve the exhaustion records.
 *
 * solo-protocol-v1.0.1. An earlier test asserted only that hashing the draft JSON changed when
 * an exhaustion was removed - which proves nothing, because `sealCorpus` does not hash the
 * draft. It builds a new manifest from the pages and the ledger, and it ignored
 * `exhaustedAgencies` completely. The claim "sealed with the corpus" was false, and these tests
 * exercise the sealer itself.
 *
 * The denominator is the point: forty pages say nothing about prevalence unless the corpus also
 * records how many agencies were searched to obtain them.
 */
describe('the corpus seal requires the exhaustion records', () => {
  const frameDir = join(repo, 'evaluation', 'frame');
  const order = readFileSync(join(frameDir, 'draw-order.csv'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\d+,/.test(l))
    .map((l) => {
      // Quoted fields: two frame agencies have commas in their names.
      const out = []; let f = ''; let q = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (q) { if (c === '"' && l[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
        else if (c === '"') q = true; else if (c === ',') { out.push(f); f = ''; } else f += c;
      }
      out.push(f);
      return { position: Number(out[0]), agency: out[1] };
    })
    .sort((a, b) => a.position - b.position)
    .map((r) => r.agency);

  const exhaustion = (agency) => ({
    agency,
    exhaustedAt: '2026-09-25T04:00:00Z',
    reason: EXHAUSTION_REASON,
    categorySetVersions: {
      'account-registration': 1,
      'service-application': 3,
      'enquiry-or-contact': 1,
      'subscription-or-newsletter': 1,
    },
  });

  const pageFor = (agency, n) => ({
    pageId: `real-${String(n).padStart(3, '0')}`,
    agency,
    website: 'https://example.invalid/',
    originalUrl: 'https://example.invalid/contact',
    finalUrl: 'https://example.invalid/contact',
    capturedAt: '2026-09-22T00:00:00Z',
    browser: 'Chromium 153',
    automationTool: 'playwright 1.63.0',
    viewport: { width: 1280, height: 800 },
    locale: 'en-NZ',
    redirects: [],
    category: 'enquiry-or-contact',
    file: `real-${String(n).padStart(3, '0')}.html`,
  });

  /** A real (non-synthetic) draft covering a prefix of the frozen draw order. */
  function realDraft({ pageCount, exhaustedCount }) {
    const pages = [];
    const exhaustedAgencies = [];
    for (let i = 0; i < pageCount; i++) pages.push(pageFor(order[i], i + 1));
    for (let i = pageCount; i < pageCount + exhaustedCount; i++) exhaustedAgencies.push(exhaustion(order[i]));
    return {
      schema: 'formfair/solo-corpus-draft@1',
      synthetic: false,
      frameSha256: FROZEN_FRAME_SHA256,
      drawOrderSha256: FROZEN_DRAW_ORDER_SHA256,
      selectionLedgerFile: 'selection-ledger.csv',
      pages,
      exhaustedAgencies,
    };
  }

  function prepareReal(dir, draftObj) {
    writeFileSync(join(dir, 'selection-ledger.csv'), 'agency,status\n');
    for (const p of draftObj.pages) {
      writeFileSync(join(dir, p.file), '<form><label for="n">Full name</label><input id="n"></form>');
    }
  }

  test('a one-page corpus with no exhaustion cannot seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 1, exhaustedCount: 0 });
      prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir: dir, instrument: identity, frameDir });
      assert.equal(sealed.manifest, null, 'a one-page corpus must not seal');
      assert.ok(
        sealed.problems.some((p) => /every agency in the frozen order must be either a page or a recorded exhaustion/.test(p)),
        sealed.problems.join('; ')
      );
    });
  });

  test('THE REAL TEST: removing the exhaustion makes sealing fail', async () => {
    await inTemp(async (dir) => {
      // A complete corpus: every agency in the frozen order is a page or an exhaustion.
      const complete = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      prepareReal(dir, complete);
      const ok = sealCorpus({ draft: complete, capturesDir: dir, instrument: identity, frameDir });
      assert.ok(ok.manifest, ok.problems.join('; '));

      // Remove one exhaustion; the same corpus must now refuse to seal.
      const missing = structuredClone(complete);
      missing.exhaustedAgencies = missing.exhaustedAgencies.slice(0, -1);
      const failed = sealCorpus({ draft: missing, capturesDir: dir, instrument: identity, frameDir });
      assert.equal(failed.manifest, null, 'removing an exhaustion must break the seal');
      assert.ok(
        failed.problems.some((p) => p.includes(order[order.length - 1])),
        `the refusal should name the unaccounted agency: ${failed.problems.join('; ')}`
      );
    });
  });

  test('the exhaustion records reach the manifest and survive loading', async () => {
    await inTemp(async (dir) => {
      const complete = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      prepareReal(dir, complete);
      const sealed = sealCorpus({ draft: complete, capturesDir: dir, instrument: identity, frameDir });
      assert.ok(sealed.manifest, sealed.problems.join('; '));
      assert.equal(sealed.manifest.exhaustedAgencies.length, order.length - 2);
      assert.equal(sealed.manifest.exhaustedAgencies[0].agency, order[2]);
      assert.equal(sealed.manifest.exhaustedAgencies[0].reason, EXHAUSTION_REASON);
      assert.equal(sealed.manifest.exhaustedAgencies[0].categorySetVersions['service-application'], 3);

      // Survives being written and read back, which is how the study consumes it.
      const manifestPath = join(dir, 'corpus.json');
      writeFileSync(manifestPath, `${JSON.stringify(sealed.manifest, null, 2)}\n`);
      const reloaded = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.deepEqual(reloaded.exhaustedAgencies, sealed.manifest.exhaustedAgencies);
      const loaded = loadSealedPages({ manifest: reloaded, manifestPath, capturesDir: dir });
      assert.deepEqual(loaded.problems, [], 'loading must not object to the new field');
      assert.equal(loaded.pages.length, 2, 'loading the pages must still work alongside the records');
      // The records are part of what the manifest hash covers, so a study that verifies the
      // manifest is verifying them too.
      assert.match(loaded.manifestSha256, /^[0-9a-f]{64}$/);
    });
  });

  test('an exhaustion without the frozen reason does not seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      d.exhaustedAgencies[0].reason = 'no forms found';
      prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir: dir, instrument: identity, frameDir });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /must be the frozen exhaustion reason/.test(p)));
    });
  });

  test('a legacy exhaustion with no timestamp or versions does not seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      d.exhaustedAgencies[0] = { agency: order[2], exhaustedAt: null, reason: EXHAUSTION_REASON, categorySetVersions: null };
      prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir: dir, instrument: identity, frameDir });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /predates the exhaustion operation/.test(p)));
      assert.ok(sealed.problems.some((p) => /categorySetVersions must name all four categories/.test(p)));
    });
  });

  test('an agency cannot be both a page and an exhaustion', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      d.exhaustedAgencies.push(exhaustion(order[0]));
      prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir: dir, instrument: identity, frameDir });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /is both a sealed page and an exhausted agency/.test(p)));
    });
  });

  test('a duplicated exhaustion does not seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      d.exhaustedAgencies.push(exhaustion(order[2]));
      prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir: dir, instrument: identity, frameDir });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /recorded as exhausted more than once/.test(p)));
    });
  });

  test('an agency outside the frozen frame does not seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      d.exhaustedAgencies[0] = exhaustion('Department of Nowhere');
      prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir: dir, instrument: identity, frameDir });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /outside the frozen frame: Department of Nowhere/.test(p)));
    });
  });

  test('at the target of forty, the agencies touched must be a prefix of the draw order', async () => {
    await inTemp(async (dir) => {
      // Forty pages and one exhaustion, but the exhaustion is taken from the far end of the
      // order rather than from within the first forty-one: an agency was reached out of turn.
      const d = realDraft({ pageCount: 40, exhaustedCount: 0 });
      d.exhaustedAgencies = [exhaustion(order[44])];
      prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir: dir, instrument: identity, frameDir });
      assert.equal(sealed.manifest, null);
      assert.ok(
        sealed.problems.some((p) => /are not the first 41 of the frozen draw order/.test(p)),
        sealed.problems.join('; ')
      );
    });
  });

  test('forty pages and no exhaustions seals, being an exact prefix', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 40, exhaustedCount: 0 });
      prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir: dir, instrument: identity, frameDir });
      assert.ok(sealed.manifest, sealed.problems.join('; '));
      assert.deepEqual(sealed.manifest.exhaustedAgencies, []);
    });
  });

  test('the sealer and the capture package agree on the frozen exhaustion contract', async () => {
    // Duplicated across two packages on purpose, since evaluation/ must not import capture/.
    // The duplication is only safe if it is checked.
    const capture = await import(pathToFileURL(join(repo, 'capture', 'run.mjs')).href);
    const selection = await import(pathToFileURL(join(repo, 'capture', 'selection.mjs')).href);
    assert.equal(capture.EXHAUSTION_REASON, EXHAUSTION_REASON);
    assert.equal(selection.MAX_QUALIFIED_AGENCIES, MAX_QUALIFIED_AGENCIES);
    assert.deepEqual([...selection.CATEGORY_ORDER], [...EXHAUSTION_CATEGORIES]);
  });
});
