import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  SOLO_PROTOCOL_TAG,
} from '../descriptive.mjs';
import { loadSoloInstrument, sealerIdentity, SOLO_INSTRUMENT_TAG, SOLO_SEALER_TAG } from '../instrument.mjs';

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

  /**
   * The authoritative capture log the seal now verifies against: approved captures for the page
   * agencies, and four approved, settled candidate sets plus the exhaustion record for each
   * exhausted agency.
   */
  function captureLogFor(draftObj) {
    const log = {
      schema: 'formfair/capture-log@1',
      attempts: [],
      candidateSets: {},
      supersededCandidateSets: [],
      exhausted: structuredClone(draftObj.exhaustedAgencies ?? []),
    };
    for (const [i, page] of draftObj.pages.entries()) {
      log.attempts.push({
        id: `c-${String(i + 1).padStart(4, '0')}`,
        agency: page.agency, category: page.category, status: 'captured', approval: 'approved',
        url: page.originalUrl, finalUrl: page.finalUrl, pageId: page.pageId,
      });
    }
    for (const record of draftObj.exhaustedAgencies ?? []) {
      for (const [category, version] of Object.entries(record.categorySetVersions ?? {})) {
        log.candidateSets[`${record.agency}\u0000${category}`] = {
          agency: record.agency, category, version,
          discovered: [], locked: [], ordered: [], droppedBeyondBound: [],
          lockedAt: '2026-09-25T03:00:00Z', approval: 'approved',
          candidateDeclaration: 'none', declaredAt: '2026-09-25T03:00:00Z',
          discoveryRecordIds: ['d-0001'], discoveryMethods: ['navigation'],
        };
      }
    }
    return log;
  }

  /**
   * Mirrors the real layout: the capture ROOT holds `capture-log.json` and a `captures/`
   * directory beside it. Flattening the two in a fixture would have let the path checks pass
   * without ever being exercised.
   */
  function prepareReal(dir, draftObj, { log = captureLogFor(draftObj), logName = 'capture-log.json' } = {}) {
    const capturesDir = join(dir, 'captures');
    mkdirSync(capturesDir, { recursive: true });
    writeFileSync(join(capturesDir, 'selection-ledger.csv'), 'agency,status\n');
    for (const p of draftObj.pages) {
      writeFileSync(join(capturesDir, p.file), '<form><label for="n">Full name</label><input id="n"></form>');
    }
    const captureLogPath = join(dir, logName);
    writeFileSync(captureLogPath, `${JSON.stringify(log, null, 2)}\n`);
    return { capturesDir, captureLogPath, captureRoot: dir };
  }

  test('a one-page corpus with no exhaustion cannot seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 1, exhaustedCount: 0 });
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
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
      const { capturesDir, captureLogPath } = prepareReal(dir, complete);
      const ok = sealCorpus({ draft: complete, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.ok(ok.manifest, ok.problems.join('; '));

      // Remove one exhaustion; the same corpus must now refuse to seal.
      const missing = structuredClone(complete);
      missing.exhaustedAgencies = missing.exhaustedAgencies.slice(0, -1);
      const failed = sealCorpus({ draft: missing, capturesDir, instrument: identity, frameDir, captureLogPath });
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
      const { capturesDir, captureLogPath } = prepareReal(dir, complete);
      const sealed = sealCorpus({ draft: complete, capturesDir, instrument: identity, frameDir, captureLogPath });
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
      const loaded = loadSealedPages({ manifest: reloaded, manifestPath, capturesDir });
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
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /must be the frozen exhaustion reason/.test(p)));
    });
  });

  test('a legacy exhaustion with no timestamp or versions does not seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      d.exhaustedAgencies[0] = { agency: order[2], exhaustedAt: null, reason: EXHAUSTION_REASON, categorySetVersions: null };
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /predates the exhaustion operation/.test(p)));
      assert.ok(sealed.problems.some((p) => /categorySetVersions must name all four categories/.test(p)));
    });
  });

  test('an agency cannot be both a page and an exhaustion', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      d.exhaustedAgencies.push(exhaustion(order[0]));
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /is both a sealed page and an exhausted agency/.test(p)));
    });
  });

  test('a duplicated exhaustion does not seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      d.exhaustedAgencies.push(exhaustion(order[2]));
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /recorded as exhausted more than once/.test(p)));
    });
  });

  test('an agency outside the frozen frame does not seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      d.exhaustedAgencies[0] = exhaustion('Department of Nowhere');
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
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
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
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
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
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
  test('THE FABRICATION: 44 well-shaped but unsupported exhaustions cannot seal', async () => {
    // Shape validation alone made the completion rule trivially satisfiable: a hand-written
    // draft could claim forty-four searches nobody performed and present a one-page corpus as a
    // complete scan of the frame. The sealed selection ledger does not close this, because it
    // records examined URLs and outcomes, not candidate-set versions, approvals or exhaustions.
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 1, exhaustedCount: order.length - 1 });
      // Every record is perfectly well formed; the log simply does not support any of them.
      const emptyLogFile = {
        schema: 'formfair/capture-log@1',
        attempts: [
          {
            id: 'c-0001', agency: order[0], category: 'enquiry-or-contact', status: 'captured',
            approval: 'approved', url: 'https://example.invalid/contact',
            finalUrl: 'https://example.invalid/contact', pageId: 'real-001',
          },
        ],
        candidateSets: {},
        supersededCandidateSets: [],
        exhausted: [],
      };
      const { capturesDir, captureLogPath } = prepareReal(dir, d, { log: emptyLogFile });
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });

      assert.equal(sealed.manifest, null, 'unsupported exhaustions must not seal');
      const unrecorded = sealed.problems.filter((p) => /is not recorded as exhausted in the capture log/.test(p));
      assert.equal(unrecorded.length, order.length - 1, `expected all 44 refused: ${unrecorded.length}`);
    });
  });

  test('an exhaustion whose candidate set is pending in the log cannot seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 1, exhaustedCount: order.length - 1 });
      const log = captureLogFor(d);
      log.candidateSets[`${order[1]}\u0000service-application`].approval = 'pending';
      const { capturesDir, captureLogPath } = prepareReal(dir, d, { log });
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /service-application set is pending, not approved/.test(p)));
    });
  });

  test('an exhaustion claiming a version the log disagrees with cannot seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 1, exhaustedCount: order.length - 1 });
      const log = captureLogFor(d);
      log.candidateSets[`${order[1]}\u0000service-application`].version = 9;
      const { capturesDir, captureLogPath } = prepareReal(dir, d, { log });
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /is version 9, but the exhaustion claims version 3/.test(p)));
    });
  });

  test('forty-one pages cannot seal, even as an exact prefix', async () => {
    // The branch tested `>= 40`, which treats forty-one as "reached the target" and seals it
    // against a forty-one agency prefix. The study takes at most forty.
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 41, exhaustedCount: 0 });
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.equal(sealed.manifest, null, 'forty-one pages must not seal');
      assert.ok(
        sealed.problems.some((p) => /41 agencies have a sealed page, which exceeds the target of 40/.test(p)),
        sealed.problems.join('; ')
      );
    });
  });

  test('a real seal requires the capture log to be supplied at all', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      const { capturesDir } = prepareReal(dir, d);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /captureLogPath is required to seal a real corpus/.test(p)));
    });
  });

  test('a page the capture log does not record as approved cannot seal', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      const log = captureLogFor(d);
      log.attempts[0].approval = 'pending';
      const { capturesDir, captureLogPath } = prepareReal(dir, d, { log });
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.equal(sealed.manifest, null);
      assert.ok(sealed.problems.some((p) => /is not an approved capture in the capture log/.test(p)));
    });
  });

  test('the manifest names this protocol, the sealer, and the bound capture log', async () => {
    await inTemp(async (dir) => {
      const d = realDraft({ pageCount: 2, exhaustedCount: order.length - 2 });
      const { capturesDir, captureLogPath } = prepareReal(dir, d);
      const sealer = { tag: SOLO_SEALER_TAG, commit: 'f'.repeat(40), dirty: false };
      const sealed = sealCorpus({
        draft: d, capturesDir, instrument: identity, frameDir, captureLogPath, sealer,
      });
      assert.ok(sealed.manifest, sealed.problems.join('; '));
      // It used to default to solo-protocol-v1.0.0, so a v1.0.1 manifest misnamed its own rules.
      assert.equal(sealed.manifest.protocol, SOLO_PROTOCOL_TAG);
      assert.equal(sealed.manifest.protocol, SOLO_SEALER_TAG);
      assert.equal(sealed.manifest.sealer.tag, SOLO_SEALER_TAG);
      assert.equal(sealed.manifest.sealer.commit, 'f'.repeat(40));
      // The analyser identity is still recorded separately.
      assert.equal(sealed.manifest.instrument.tag, 'evaluation-v1.1.0');
      // And the log is bound by hash, so it cannot be swapped after the fact.
      assert.match(sealed.manifest.captureLog.sha256, /^[0-9a-f]{64}$/);
      assert.equal(
        sealed.manifest.captureLog.sha256,
        createHash('sha256').update(readFileSync(captureLogPath)).digest('hex')
      );
    });
  });
});

/**
 * The official sealing command, and the capture log it binds.
 *
 * solo-protocol-v1.0.3. Two defects made the official command unusable or unsound.
 *
 * Both identities were read from one directory: `instrumentIdentity(instrumentDir)` and
 * `sealerIdentity(instrumentDir)`. But `evaluation-v1.1.0` and the solo-protocol tag point at
 * different commits, so no single checkout can satisfy both, and whichever check ran second
 * always failed. Official sealing could not succeed at all.
 *
 * And the capture log was recorded but never re-verified, under a hardcoded filename. The
 * manifest said `capture-log.json` while the seal had read whatever `--capture-log` pointed at,
 * anywhere on disk, and nothing afterwards re-read it - so the one artefact proving which
 * searches happened could be swapped or edited after sealing.
 */
describe('the sealer and the analyser are separate checkouts', () => {
  test('sealerIdentity defaults to the checkout containing the sealer', () => {
    const own = sealerIdentity();
    assert.equal(own.directory, resolve(repo));
    assert.equal(own.tag, SOLO_SEALER_TAG);
  });

  test('sealerIdentity does not follow the analyser directory', () => {
    // The bug: passing the analyser checkout here made the two identities the same directory.
    const elsewhere = mkdtempSync(join(tmpdir(), 'formfair-elsewhere-'));
    try {
      assert.equal(sealerIdentity(elsewhere).directory, resolve(elsewhere));
      assert.notEqual(sealerIdentity().directory, resolve(elsewhere));
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test('the official CLI reads the analyser identity from the environment, not from its own checkout', () => {
    // A real seal with the analyser pointed at a non-git directory must fail on the ANALYSER
    // tag. That it reaches that check at all is the evidence the sealer resolved itself
    // separately: when both identities shared a directory, this could never be distinguished.
    const elsewhere = mkdtempSync(join(tmpdir(), 'formfair-analyser-'));
    try {
      const result = spawnSync(
        process.execPath,
        [join(here, '..', 'cli-seal-corpus.mjs'), '--draft', 'x.json', '--captures', 'y', '--out', 'z.json'],
        { encoding: 'utf8', env: { ...process.env, FORMFAIR_SOLO_INSTRUMENT_DIR: elsewhere } }
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`clean instrument tagged ${SOLO_INSTRUMENT_TAG}`));
      assert.doesNotMatch(result.stderr, /clean sealer checkout/);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('the sealed capture log is bound by path and re-verified', () => {
  const frameDir = join(repo, 'evaluation', 'frame');
  const order = readFileSync(join(frameDir, 'draw-order.csv'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\d+,/.test(l))
    .map((l) => {
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
    agency, exhaustedAt: '2026-09-25T04:00:00Z', reason: EXHAUSTION_REASON,
    categorySetVersions: {
      'account-registration': 1, 'service-application': 3,
      'enquiry-or-contact': 1, 'subscription-or-newsletter': 1,
    },
  });

  function build(dir, { logName = 'capture-log.json' } = {}) {
    const pages = [{
      pageId: 'real-001', agency: order[0], website: 'https://example.invalid/',
      originalUrl: 'https://example.invalid/contact', finalUrl: 'https://example.invalid/contact',
      capturedAt: '2026-09-22T00:00:00Z', browser: 'Chromium 153', automationTool: 'playwright 1.63.0',
      viewport: { width: 1280, height: 800 }, locale: 'en-NZ', redirects: [],
      category: 'enquiry-or-contact', file: 'real-001.html',
    }];
    const exhaustedAgencies = order.slice(1).map(exhaustion);
    const d = {
      schema: 'formfair/solo-corpus-draft@1', synthetic: false,
      frameSha256: FROZEN_FRAME_SHA256, drawOrderSha256: FROZEN_DRAW_ORDER_SHA256,
      selectionLedgerFile: 'selection-ledger.csv', pages, exhaustedAgencies,
    };
    const log = {
      schema: 'formfair/capture-log@1',
      attempts: [{
        id: 'c-0001', agency: order[0], category: 'enquiry-or-contact', status: 'captured',
        approval: 'approved', url: pages[0].originalUrl, finalUrl: pages[0].finalUrl, pageId: 'real-001',
      }],
      candidateSets: {}, supersededCandidateSets: [], exhausted: structuredClone(exhaustedAgencies),
    };
    for (const record of exhaustedAgencies) {
      for (const [category, version] of Object.entries(record.categorySetVersions)) {
        log.candidateSets[`${record.agency}\u0000${category}`] = {
          agency: record.agency, category, version, discovered: [], locked: [], ordered: [],
          droppedBeyondBound: [], lockedAt: '2026-09-25T03:00:00Z', approval: 'approved',
          candidateDeclaration: 'none', declaredAt: '2026-09-25T03:00:00Z',
          discoveryRecordIds: ['d-0001'], discoveryMethods: ['navigation'],
        };
      }
    }
    const capturesDir = join(dir, 'captures');
    mkdirSync(capturesDir, { recursive: true });
    writeFileSync(join(capturesDir, 'selection-ledger.csv'), 'agency,status\n');
    writeFileSync(join(capturesDir, 'real-001.html'), '<form><label for="n">Full name</label><input id="n"></form>');
    const captureLogPath = join(dir, logName);
    writeFileSync(captureLogPath, `${JSON.stringify(log, null, 2)}\n`);
    return { draft: d, capturesDir, captureLogPath, log };
  }

  test('the manifest stores the log\'s actual relative path, not a hardcoded name', async () => {
    await inTemp(async (dir) => {
      const { draft: d, capturesDir, captureLogPath } = build(dir, { logName: 'capture-log-v3.json' });
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.ok(sealed.manifest, sealed.problems.join('; '));
      // Previously this said 'capture-log.json' regardless of what was actually sealed.
      assert.equal(sealed.manifest.captureLog.file, 'capture-log-v3.json');
    });
  });

  test('a capture log outside the capture root is refused', async () => {
    await inTemp(async (dir) => {
      const { draft: d, capturesDir } = build(dir);
      const outside = mkdtempSync(join(tmpdir(), 'formfair-outside-'));
      try {
        const smuggled = join(outside, 'capture-log.json');
        writeFileSync(smuggled, readFileSync(join(dir, 'capture-log.json')));
        const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath: smuggled });
        assert.equal(sealed.manifest, null);
        assert.ok(sealed.problems.some((p) => /outside the capture root/.test(p)), sealed.problems.join('; '));
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  test('loadSealedPages refuses a capture log tampered with after sealing', async () => {
    await inTemp(async (dir) => {
      const { draft: d, capturesDir, captureLogPath, log } = build(dir);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      assert.ok(sealed.manifest, sealed.problems.join('; '));
      const manifestPath = join(dir, 'corpus.json');
      writeFileSync(manifestPath, `${JSON.stringify(sealed.manifest, null, 2)}\n`);

      // Edit the log AFTER sealing: add an exhaustion nobody searched. Same byte length is not
      // attempted; both the hash and the length are checked.
      const tampered = structuredClone(log);
      tampered.exhausted.push(exhaustion('Department of Nowhere'));
      writeFileSync(captureLogPath, `${JSON.stringify(tampered, null, 2)}\n`);

      const loaded = loadSealedPages({ manifest: sealed.manifest, manifestPath, capturesDir });
      assert.equal(loaded.pages, null, 'a tampered capture log must not load');
      assert.ok(loaded.problems.some((p) => /capture log hash mismatch/.test(p)), loaded.problems.join('; '));
      assert.ok(loaded.problems.some((p) => /byte count mismatch/.test(p)), loaded.problems.join('; '));
    });
  });

  test('loadSealedPages refuses a manifest that names a log which is not there', async () => {
    await inTemp(async (dir) => {
      const { draft: d, capturesDir, captureLogPath } = build(dir);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      const manifestPath = join(dir, 'corpus.json');
      writeFileSync(manifestPath, `${JSON.stringify(sealed.manifest, null, 2)}\n`);
      rmSync(captureLogPath);
      const loaded = loadSealedPages({ manifest: sealed.manifest, manifestPath, capturesDir });
      assert.equal(loaded.pages, null);
      assert.ok(loaded.problems.some((p) => /cannot read the sealed capture log/.test(p)));
    });
  });

  test('loadSealedPages refuses a manifest whose sealed log path escapes the root', async () => {
    await inTemp(async (dir) => {
      const { draft: d, capturesDir, captureLogPath } = build(dir);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      const manifestPath = join(dir, 'corpus.json');
      // A manifest edited to point outside the root: "sealed one file but named another".
      const escaped = structuredClone(sealed.manifest);
      escaped.captureLog.file = '../../etc/hosts';
      writeFileSync(manifestPath, `${JSON.stringify(escaped, null, 2)}\n`);
      const loaded = loadSealedPages({ manifest: escaped, manifestPath, capturesDir });
      assert.equal(loaded.pages, null);
      assert.ok(loaded.problems.some((p) => /escapes the capture root/.test(p)));
    });
  });

  test('an untampered corpus loads, and the log verifies', async () => {
    await inTemp(async (dir) => {
      const { draft: d, capturesDir, captureLogPath } = build(dir);
      const sealed = sealCorpus({ draft: d, capturesDir, instrument: identity, frameDir, captureLogPath });
      const manifestPath = join(dir, 'corpus.json');
      writeFileSync(manifestPath, `${JSON.stringify(sealed.manifest, null, 2)}\n`);
      const loaded = loadSealedPages({ manifest: sealed.manifest, manifestPath, capturesDir });
      assert.deepEqual(loaded.problems, []);
      assert.equal(loaded.pages.length, 1);
    });
  });
});
