/**
 * The bounded search rule (Amendment 2).
 *
 * The bound decides the achieved sample as much as the draw order does, so it is enforced
 * here rather than left to whoever is running the scan to remember on agency thirty.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalise, orderCandidates, remainingBudget, SEARCH_TERMS, CATEGORY_ORDER,
  MAX_CANDIDATES_PER_CATEGORY, MAX_CANDIDATES_PER_AGENCY, DISCOVERY_KINDS,
} from '../selection.mjs';
import { emptyLog, appendAttempt, ELIGIBILITY_CRITERIA, deriveLedger } from '../run.mjs';

const nullEligibility = () => Object.fromEntries(ELIGIBILITY_CRITERIA.map((c) => [c, null]));
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
    for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) {
      appendAttempt(log, candidate('TPK', 'enquiry-or-contact', i));
    }
    assert.throws(
      () => appendAttempt(log, candidate('TPK', 'enquiry-or-contact', 99)),
      /effort bound reached/
    );
  });

  test('another category in the same agency is still open', () => {
    const log = emptyLog();
    for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) {
      appendAttempt(log, candidate('TPK', 'enquiry-or-contact', i));
    }
    appendAttempt(log, candidate('TPK', 'service-application', 0));
    assert.equal(log.attempts.length, MAX_CANDIDATES_PER_CATEGORY + 1);
  });

  test('a twenty-first candidate in the agency is refused even across categories', () => {
    const log = emptyLog();
    for (const category of CATEGORY_ORDER) {
      for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) appendAttempt(log, candidate('TPK', category, i));
    }
    assert.equal(log.attempts.length, MAX_CANDIDATES_PER_AGENCY);
    assert.throws(() => appendAttempt(log, candidate('TPK', 'account-registration', 98)), /effort bound reached/);
  });

  test('the bound is per agency, so the next agency starts fresh', () => {
    const log = emptyLog();
    for (const category of CATEGORY_ORDER) {
      for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) appendAttempt(log, candidate('TPK', category, i));
    }
    appendAttempt(log, candidate('Ministry of Health', 'account-registration', 0));
    assert.equal(remainingBudget(log.attempts, { agency: 'Ministry of Health' }).exhausted, false);
  });

  test('discovery pages are logged but do not consume the bound', () => {
    // A sitemap or a search results page is inspected to FIND candidates. Counting it as
    // one would let a thorough search exhaust the bound before assessing a single form.
    const log = emptyLog();
    for (let i = 0; i < MAX_CANDIDATES_PER_CATEGORY; i++) {
      appendAttempt(log, candidate('TPK', 'enquiry-or-contact', i));
    }
    for (const kind of DISCOVERY_KINDS) {
      appendAttempt(log, {
        examinedAt: '2026-09-24T00:00:00Z', agency: 'TPK', website: 'https://w.govt.nz/',
        url: `https://w.govt.nz/discovery/${kind}`, status: 'discovery', discoveryKind: kind,
      });
    }
    assert.equal(log.attempts.length, MAX_CANDIDATES_PER_CATEGORY + DISCOVERY_KINDS.length);
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
      /discoveryKind/
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
