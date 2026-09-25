/**
 * The bounded search rule (Amendment 2).
 *
 * The bound decides the achieved sample as much as the draw order does, so it is enforced
 * here rather than left to whoever is running the scan to remember on agency thirty.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalise, orderCandidates, remainingBudget, SEARCH_TERMS, CATEGORY_ORDER,
  MAX_CANDIDATES_PER_CATEGORY, MAX_CANDIDATES_PER_AGENCY, DISCOVERY_KINDS,
  parseDrawOrder, splitCsvLine,
} from '../selection.mjs';
import { emptyLog, appendAttempt, ELIGIBILITY_CRITERIA, deriveLedger } from '../run.mjs';
import { prepareSet, addDiscovery, nextTimestamp } from './helpers.mjs';

/** Candidates only: discovery records share the attempts array but are not candidates. */
const candidateCount = (log) => log.attempts.filter((a) => a.status !== 'discovery').length;

const nullEligibility = () => Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null]));

/**
 * Locks a candidate set before anything is assessed.
 *
 * Assessment now requires a locked set, so these tests prepare one. That requirement is
 * the point of the locked-set step and is covered directly in guards.test.mjs.
 */
function prepare(log, agency, category, count) {
  const urls = Array.from({ length: count }, (_, i) => `https://w.govt.nz/${encodeURIComponent(agency)}/${category}/${i}`);
  prepareSet(log, agency, category, urls);
  return urls;
}
const candidate = (agency, category, n) => ({
  examinedAt: '2026-09-24T00:00:00Z', agency, website: 'https://w.govt.nz/',
  url: `https://w.govt.nz/${encodeURIComponent(agency)}/${category}/${n}`, status: 'excluded', category,
  exclusionReason: 'no personal-name field', eligibility: nullEligibility(),
});

describe('canonicalisation', () => {
  test('query parameters are kept, because they can identify the form', () => {
    // Dropping them would merge two distinct forms into one candidate, which on a
    // government site is a realistic way to lose a form silently.
    assert.notEqual(canonicalise('https://a.govt.nz/f?id=7'), canonicalise('https://a.govt.nz/f?id=8'));
  });

  test('fragments, case and default ports are normalised away', () => {
    assert.equal(canonicalise('https://EXAMPLE.govt.nz:443/Form?id=7#top'), 'https://example.govt.nz/Form?id=7');
    assert.equal(canonicalise('http://A.GOVT.NZ:80/x'), 'http://a.govt.nz/x');
    // The PATH keeps its case: a path is case-sensitive on many servers.
    assert.match(canonicalise('https://a.govt.nz/Form'), /\/Form$/);
  });

  test('a valid canonical link wins; an invalid one is ignored', () => {
    assert.equal(canonicalise('https://a.govt.nz/f?x=1', 'https://a.govt.nz/real'), 'https://a.govt.nz/real');
    assert.equal(canonicalise('https://a.govt.nz/f', '/relative'), 'https://a.govt.nz/relative');
    assert.equal(canonicalise('https://a.govt.nz/f', 'javascript:void(0)'), 'https://a.govt.nz/f');
    // A bare string is a valid RELATIVE reference and resolves, which is what a browser
    // does with it. Only a link that cannot resolve at all, or resolves to a non-web
    // scheme, is ignored.
    assert.equal(canonicalise('https://a.govt.nz/f', 'not a url'), 'https://a.govt.nz/not%20a%20url');
    assert.equal(canonicalise('https://a.govt.nz/f', 'mailto:x@y.z'), 'https://a.govt.nz/f');
    assert.equal(canonicalise('https://a.govt.nz/f', ''), 'https://a.govt.nz/f');
  });

  test('candidates are deduplicated and alphabetically ordered, which decides the tie-break', () => {
    assert.deepEqual(
      orderCandidates(['https://a.govt.nz/b', 'https://A.GOVT.NZ/b#frag', 'https://a.govt.nz/a']),
      ['https://a.govt.nz/a', 'https://a.govt.nz/b']
    );
  });
});

describe('the effort bound', () => {
  test('five candidates per category, twenty per agency', () => {
    assert.equal(MAX_CANDIDATES_PER_CATEGORY, 5);
    assert.equal(MAX_CANDIDATES_PER_AGENCY, 20);
    assert.equal(MAX_CANDIDATES_PER_AGENCY, MAX_CANDIDATES_PER_CATEGORY * CATEGORY_ORDER.length);
  });

  test('a sixth candidate in a category is refused', () => {
    const log = emptyLog();
    // Six locked, so the sixth is refused by the BOUND rather than by the locked set.
    prepare(log, 'TPK', 'enquiry-or-contact', 6);
    for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) {
      appendAttempt(log, candidate('TPK', 'enquiry-or-contact', i));
    }
    assert.throws(
      () => appendAttempt(log, candidate('TPK', 'enquiry-or-contact', 5)),
      /effort bound reached|not in the locked candidate set/
    );
  });

  test('another category in the same agency is still open', () => {
    const log = emptyLog();
    prepare(log, 'TPK', 'enquiry-or-contact', MAX_CANDIDATES_PER_CATEGORY);
    prepare(log, 'TPK', 'service-application', 1);
    for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) {
      appendAttempt(log, candidate('TPK', 'enquiry-or-contact', i));
    }
    appendAttempt(log, candidate('TPK', 'service-application', 0));
    assert.equal(candidateCount(log), MAX_CANDIDATES_PER_CATEGORY + 1);
  });

  test('a twenty-first candidate in the agency is refused even across categories', () => {
    const log = emptyLog();
    for (const category of CATEGORY_ORDER) {
      prepare(log, 'TPK', category, MAX_CANDIDATES_PER_CATEGORY);
      for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) appendAttempt(log, candidate('TPK', category, i));
    }
    assert.equal(candidateCount(log), MAX_CANDIDATES_PER_AGENCY);
    assert.throws(
      () => appendAttempt(log, candidate('TPK', 'account-registration', 98)),
      /effort bound reached|not in the locked candidate set/
    );
  });

  test('the bound is per agency, so the next agency starts fresh', () => {
    const log = emptyLog();
    for (const category of CATEGORY_ORDER) {
      prepare(log, 'TPK', category, MAX_CANDIDATES_PER_CATEGORY);
      for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) appendAttempt(log, candidate('TPK', category, i));
    }
    prepare(log, 'Ministry of Health', 'account-registration', 1);
    appendAttempt(log, candidate('Ministry of Health', 'account-registration', 0));
    assert.equal(remainingBudget(log.attempts, { agency: 'Ministry of Health' }).exhausted, false);
  });

  test('discovery pages are logged but do not consume the bound', () => {
    // A sitemap or a search results page is inspected to FIND candidates. Counting it as
    // one would let a thorough search exhaust the bound before assessing a single form.
    const log = emptyLog();
    prepare(log, 'TPK', 'enquiry-or-contact', MAX_CANDIDATES_PER_CATEGORY);
    for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) {
      appendAttempt(log, candidate('TPK', 'enquiry-or-contact', i));
    }
    DISCOVERY_KINDS.forEach((kind) => {
      addDiscovery(log, { agency: 'TPK', category: 'enquiry-or-contact', method: kind, outcome: 'no-candidates' });
    });
    assert.equal(candidateCount(log), MAX_CANDIDATES_PER_CATEGORY, 'discovery records are not candidates');
    // And they reach the ledger, so the search is auditable, not just its outcome.
    const ledger = deriveLedger(log);
    for (const kind of DISCOVERY_KINDS) assert.match(ledger, new RegExp(`discovery: ${kind}`));
  });

  test('a discovery record must name how the page was found', () => {
    const log = emptyLog();
    assert.throws(
      () => appendAttempt(log, {
        examinedAt: 't', agency: 'TPK', website: 'w', url: 'https://w/x', status: 'discovery',
      }),
      /needs a method from/
    );
  });
});

describe('the frozen search terms', () => {
  test('ten terms, mapped to the four categories', () => {
    const all = Object.values(SEARCH_TERMS).flat();
    assert.equal(all.length, 10);
    assert.deepEqual(Object.keys(SEARCH_TERMS), [...CATEGORY_ORDER]);
    assert.ok(all.includes('tono'), 'te reo terms are part of the frozen set');
    assert.ok(all.includes('whakapā'));
  });
});

/**
 * The frozen draw order quotes two agency names, and both must parse cleanly.
 *
 * selection-v1.0.9. Two of the forty-five agencies have commas in their names, and the file
 * quotes them. The parser assumed it did not, rebuilt the name by joining the middle fields with
 * commas, and returned it still wrapped in its literal quote characters. Nothing had noticed
 * because the scan had not reached position 17.
 *
 * It would have failed there, and quietly: the quoted name matches nothing in the frame, matches
 * nothing an operator types, and would key its candidate sets under a name no other artefact
 * uses - so the agency's whole round would have been recorded under a name that looks right in
 * output and is wrong everywhere it is compared.
 */
describe('the draw order parses quoted agency names', () => {
  const rows = parseDrawOrder(
    readFileSync(new URL('../../evaluation/frame/draw-order.csv', import.meta.url), 'utf8')
  );

  test('forty-five agencies, none carrying a stray quote character', () => {
    assert.equal(rows.length, 45);
    for (const row of rows) {
      assert.ok(!row.agency.includes('"'), `${JSON.stringify(row.agency)} carries a quote character`);
      assert.equal(row.agency, row.agency.trim());
      assert.ok(row.agency.length > 0);
    }
  });

  test('the two comma-bearing names are whole', () => {
    const byPosition = new Map(rows.map((r) => [r.position, r.agency]));
    assert.equal(byPosition.get(17), 'Ministry for Cities, Environment, Regions and Transport');
    assert.equal(byPosition.get(41), 'Ministry of Business, Innovation and Employment');
  });

  test('every draw key is still a full digest, so the fields did not shift', () => {
    // The bug reassembled fields; this catches a parser that mis-splits in the other direction.
    for (const row of rows) assert.match(row.drawKey, /^[0-9a-f]{64}$/);
  });

  test('every agency in the draw order appears in the frame', () => {
    const frame = readFileSync(new URL('../../evaluation/frame/frame.csv', import.meta.url), 'utf8');
    const frameAgencies = new Set(
      frame.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => splitCsvLine(l)[0])
    );
    for (const row of rows) {
      assert.ok(frameAgencies.has(row.agency), `${row.agency} is not in frame.csv`);
    }
  });

  test('splitCsvLine handles quotes, embedded commas and doubled quotes', () => {
    assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
    assert.deepEqual(splitCsvLine('1,"Ministry of A, B and C",key'), ['1', 'Ministry of A, B and C', 'key']);
    assert.deepEqual(splitCsvLine('1,"He said ""hi""",key'), ['1', 'He said "hi"', 'key']);
    assert.deepEqual(splitCsvLine('a,,c'), ['a', '', 'c']);
  });
});
