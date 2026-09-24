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
