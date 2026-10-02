/**
 * The approval packet.
 *
 * The researcher approves every candidate set, because candidate discovery is the
 * judgement-bearing step and no code can check it. That approval is only meaningful if
 * what is being approved can be read in a minute rather than reconstructed from a JSON log,
 * so this renders one set as a short brief: which websites were checked, by what method,
 * what each established, what was found, and anything unusual.
 *
 * It deliberately shows what was NOT found as prominently as what was. A set with one
 * candidate and a set with one candidate after three dead methods are different things to
 * approve, and the difference is the part a reviewer needs.
 */

import {
  setKey, CATEGORY_ORDER, SEARCH_TERMS, MAX_CANDIDATES_PER_CATEGORY,
  TECHNICAL_ATTRITION_OUTCOMES,
} from './selection.mjs';
import { barrierAccounting, readContentUrls } from './run.mjs';

const pad = (s, n) => String(s).padEnd(n);

export function buildPacket(log, { agency, category }) {
  const set = log.candidateSets?.[setKey(agency, category)];
  if (!set) throw new Error(`no candidate set for ${agency} / ${category}`);

  const records = log.attempts.filter(
    (a) => a.status === 'discovery' && a.agency === agency && a.category === category &&
      a.candidateSetVersion === set.version
  );

  // selection-v1.0.13: superseded records are shown but not counted as evidence, and are kept
  // out of FOR ATTENTION. Counting them made the packet report twenty-seven inspections for a
  // twenty-six record round, and raised an anomaly against a record the same packet declares is
  // not evidence.
  const supersededIds = new Set(
    records.filter((r) => log.attempts.some((o) => o.supersedesDiscoveryId === r.id)).map((r) => r.id)
  );
  const active = records.filter((r) => !supersededIds.has(r.id));

  const websites = [...new Set(records.map((r) => r.website))].sort();
  const byWebsite = websites.map((w) => ({
    website: w,
    inspections: records
      .filter((r) => r.website === w)
      .map((r) => ({
        method: r.discoveryKind, outcome: r.outcome, url: r.url, note: r.note ?? null,
        // selection-v1.0.12: a corrected record and its replacement are both shown. Hiding the
        // superseded one would let a correction read as though it were the original finding,
        // and the reviewer is approving the round's judgement, not a tidied summary of it.
        id: r.id ?? null,
        supersededBy: log.attempts.find((o) => o.supersedesDiscoveryId === r.id)?.id ?? null,
        corrects: r.supersedesDiscoveryId ?? null,
      })),
  }));

  // Amendment 50. Computed here because the anomaly list and the per-origin breakdown both need it.
  const scope = { agency, category, candidateSetVersion: set.version };
  // Which barrier records remain UNRESOLVED. Needed by the anomaly list and the per-origin
  // breakdown alike, so it is computed once, before either.
  const unresolvedIds = new Set(barrierAccounting(log, scope).unresolvedRecords);

  // Anything a reviewer should look at twice, most decision-relevant first.
  const anomalies = [];
  // Built from active records: a withdrawn finding is not something to attend to.

  // A candidate on a host whose robots.txt was recorded as disallowing something is the
  // single most decision-relevant fact in the packet, and it was buried among the
  // per-inspection notes. It is stated as a bounded warning rather than a verdict: the
  // capture command re-reads robots at assessment time and is the thing that decides.
  const disallowingHosts = new Set(
    records
      .filter((r) => r.outcome === 'disallowed' && r.discoveryKind === 'robots')
      .map((r) => {
        try { return new URL(r.url).host; } catch { return null; }
      })
      .filter(Boolean)
  );
  for (const candidate of set.locked) {
    let host = null;
    try { host = new URL(candidate).host; } catch { /* not a URL; other guards catch it */ }
    if (host && disallowingHosts.has(host)) {
      anomalies.push(
        `CANDIDATE ON A RESTRICTED HOST: ${candidate} - ${host} publishes robots rules that ` +
          'disallow at least one path. Assessment will re-read them and may exclude it without retrieval.'
      );
    }
  }
  for (const r of active) {
    // selection-v1.0.21: attrition first. An inspection that could not be read is the most
    // decision-relevant thing in a packet whose candidate list is empty, because it decides
    // whether the emptiness says anything about the agency at all.
    if (TECHNICAL_ATTRITION_OUTCOMES.includes(r.outcome)) {
      // Amendment 50. A barrier the headed fallback cleared is an event, not lost coverage, and
      // listing it as NOT READ beside a successful read of the same URL misreports the round.
      const recoveredBarrier = r.outcome === 'retrieval-blocked' && !unresolvedIds.has(r.id);
      // Amendment 54. A technical conclusion is said in its own words: the page WAS rendered and
      // the server did not serve it, which is a different fact from a request that was barred.
      // Calling it NOT READ would understate it - the bytes exist and were examined - and calling
      // it read would overstate it, because nothing in them bears on candidates.
      const serverFailure = r.recordType === 'technical-conclusion';
      anomalies.push(
        serverFailure
          ? `RENDERED BUT NOT SERVED (${r.outcome}): ${r.discoveryKind} ${r.url}${r.note ? ` - ${r.note}` : ''}`
          : recoveredBarrier
            ? `barrier recovered (${r.outcome}, then read headed): ${r.discoveryKind} ${r.url}`
            : `NOT READ (${r.outcome}): ${r.discoveryKind} ${r.url}${r.note ? ` - ${r.note}` : ''}`
      );
    }
    if (r.outcome === 'disallowed') anomalies.push(`${r.method ?? r.discoveryKind} disallowed: ${r.url}${r.note ? ` - ${r.note}` : ''}`);
    if (r.outcome === 'unavailable') anomalies.push(`${r.discoveryKind} unavailable: ${r.url}${r.note ? ` - ${r.note}` : ''}`);
  }
  for (const method of ['navigation', 'sitemap', 'internal-search', 'robots']) {
    if (!records.some((r) => r.discoveryKind === method)) {
      anomalies.push(`no ${method} inspection was recorded for this round`);
    }
  }
  if (set.droppedBeyondBound?.length) {
    anomalies.push(`${set.droppedBeyondBound.length} candidate(s) fell beyond the bound of ${MAX_CANDIDATES_PER_CATEGORY} and were not assessed`);
  }
  const earlier = CATEGORY_ORDER.slice(0, CATEGORY_ORDER.indexOf(category));
  const skipped = earlier.filter((c) => !log.candidateSets?.[setKey(agency, c)] &&
    !(log.supersededCandidateSets ?? []).some((v) => v.agency === agency && v.category === c));
  if (skipped.length) anomalies.push(`higher-priority categories with no round: ${skipped.join(', ')}`);

  const superseded = (log.supersededCandidateSets ?? []).filter(
    (v) => v.agency === agency && v.category === category
  );

  // Which origins could not be read, and which merely had nothing at the path asked for. Computed
  // here, from the records, because `inspections` on the rendered packet is a COUNT - the first
  // version of this read `p.inspections.filter` and would have thrown on every empty set.
  const originOf = (url) => { try { return new URL(url).origin; } catch { return url; } };
  // Per ORIGIN and per outcome, not merged into one bucket. The first version said "blocked or
  // withheld on 3 origins", which was wrong about the third: providinginformation.nzsis.govt.nz
  // answered every request, its robots and sitemap with 404s and its home page with a shell. One
  // label covering "refused us" and "answered but unreadable" is the same collapse that made
  // `no-candidates` wrong in the first place.
  // Amendment 50. UNRESOLVED only. Counting every barrier attempt here made the per-origin
  // breakdown contradict the summary line above it: five attempts on one origin, four of them
  // recovered, read as five unread pages.
  const notRead = active.filter(
    (r) => (r.outcome === 'retrieval-blocked' && unresolvedIds.has(r.id)) ||
      (r.outcome !== 'retrieval-blocked' &&
        (TECHNICAL_ATTRITION_OUTCOMES.includes(r.outcome) || r.outcome === 'unavailable'))
  );
  const attritionByOrigin = [...notRead.reduce((acc, r) => {
    const origin = originOf(r.url);
    if (!acc.has(origin)) acc.set(origin, new Map());
    const counts = acc.get(origin);
    counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
    return acc;
  }, new Map())]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([origin, counts]) => ({
      origin,
      outcomes: [...counts].map(([outcome, n]) => ({ outcome, n })),
    }));

  const unreadableRecords = active.filter((r) => TECHNICAL_ATTRITION_OUTCOMES.includes(r.outcome));
  const unreadableByOutcome = [...unreadableRecords.reduce(
    (acc, r) => acc.set(r.outcome, (acc.get(r.outcome) ?? 0) + 1), new Map()
  )].map(([outcome, n]) => ({ outcome, n }));

  // Amendment 50. Barriers that were RECOVERED are not lost coverage, and a zero-candidate result
  // rests on what was read rather than on what was logged.
  const barriers = barrierAccounting(log, scope);
  const read = readContentUrls(log, scope);

  return {
    agency, category, version: set.version,
    barriers, read,
    approval: set.approval, lockedAt: set.lockedAt,
    terms: SEARCH_TERMS[category] ?? [],
    websites: byWebsite,
    inspections: active.length,
    unreadable: { total: unreadableRecords.length, byOutcome: unreadableByOutcome },
    attritionByOrigin,
    supersededRecords: supersededIds.size,
    candidates: set.locked,
    droppedBeyondBound: set.droppedBeyondBound ?? [],
    anomalies,
    supersededRounds: superseded.map((v) => ({
      version: v.version, reason: v.supersededReason, note: v.approvalNote ?? null,
    })),
  };
}

export function renderPacket(p) {
  const out = [];
  out.push(`APPROVAL PACKET   ${p.agency}`);
  out.push(`category          ${p.category} (round ${p.version})`);
  out.push(`locked at         ${p.lockedAt}`);
  out.push(`search terms      ${p.terms.join(', ')}`);
  // selection-v1.0.23: "discovery records", not "inspections". Six of the nine records in the
  // NZSIS round inspected no agency content at all - they record that a request was refused. A
  // heading that counts them as inspections overstates what the round looked at, in the one line
  // a reviewer is most likely to read and least likely to question.
  out.push(
    `discovery records ${p.inspections} active across ${p.websites.length} website(s)` +
      (p.supersededRecords ? `, ${p.supersededRecords} superseded record(s) shown but not evidence` : '')
  );
  // Per outcome, because "retrieved no agency content" is not true of all of them: a
  // retrieval-inconclusive record DID receive the agency's own document, it just held nothing to
  // judge. What every one of these shares is that no candidate judgement came out of it.
  //
  // Amendment 50: it says "made no judgement of its own", not "was not read". A barred attempt the
  // headed fallback then read produced no judgement at that record and cost no coverage, and this
  // line sat directly above the barrier figures where the shorter wording invited the reading the
  // amendment exists to prevent.
  if (p.unreadable?.total) {
    out.push(
      `of which          ${p.unreadable.total} made no judgement of their own: ` +
        p.unreadable.byOutcome.map(({ outcome, n }) => `${outcome} x${n}`).join(', ')
    );
  }
  // Amendment 50: recovered and unresolved kept apart, because they mean opposite things.
  if (p.barriers?.barrierAttempts) {
    out.push(
      `barriers          ${p.barriers.barrierAttempts} attempt(s): ${p.barriers.recovered} recovered by the ` +
        `headed fallback, ${p.barriers.unresolved} unresolved over ${p.barriers.unresolvedUrls} URL(s)`
    );
  }
  if (p.read) {
    out.push(`read              ${p.read.urls} content URL(s) across ${p.read.origins} origin(s), judged`);
  }
  out.push('');
  for (const w of p.websites) {
    out.push(`  ${w.website}`);
    for (const i of w.inspections) {
      out.push(`    ${pad(i.method, 16)} ${pad(i.outcome, 17)} ${i.url}`);
      if (i.supersededBy) {
        out.push(`    ${' '.repeat(34)}SUPERSEDED by ${i.supersededBy}; not evidence for this set`);
      }
      if (i.corrects) out.push(`    ${' '.repeat(34)}corrects ${i.corrects}`);
      if (i.note) out.push(`    ${' '.repeat(34)}${i.note}`);
    }
  }
  out.push('');
  out.push(`CANDIDATES (${p.candidates.length})`);
  if (p.candidates.length === 0) {
    // selection-v1.0.21. An empty set has two quite different causes, and this line asserted the
    // wrong one for NZSIS: "this category yields no eligible form" says the agency publishes none,
    // which is a finding about the agency. Where the origins could not be read at all, nothing was
    // established about what they publish, and saying otherwise would put a prevalence observation
    // into the record that no inspection supports.
    // Amendment 50. Three different empty results, stated as three different things. The previous
    // version had two, and chose between them on raw attrition counts - so a round whose every
    // page was read after a recovered barrier was described as establishing nothing, which was the
    // opposite of the truth.
    const b = p.barriers ?? { unresolved: 0, unresolvedUrls: 0, recovered: 0, robotsUnestablished: 0 };
    const r = p.read ?? { urls: 0, origins: 0 };
    const unread = b.unresolved + b.robotsUnestablished + (b.retrievalInconclusive ?? 0);
    if (unread === 0) {
      out.push(`  none - all ${r.urls} content URL(s) across ${r.origins} origin(s) were read, and this`);
      out.push('  category yields no eligible form');
      if (b.recovered) {
        out.push(`  (${b.recovered} barrier attempt(s) were recovered by the headed fallback and cost no coverage)`);
      }
    } else if (r.urls > 0) {
      out.push(`  none among the ${r.urls} content URL(s) successfully read across ${r.origins} origin(s).`);
      if (b.recovered) {
        out.push(`  ${b.recovered} barrier attempt(s) were recovered by the headed fallback and cost no coverage.`);
      }
      out.push(`  NOT read: ${unread} record(s) over ${b.unresolvedUrls || b.unreadUrls} URL(s) -`);
      for (const { origin, outcomes } of p.attritionByOrigin ?? []) {
        out.push(`    ${origin} - ${outcomes.map(({ outcome, n }) => `${outcome} x${n}`).join(', ')}`);
      }
      out.push('  So this result supports no candidate among the pages successfully examined. It does');
      out.push('  NOT establish that the agency publishes no such form.');
    } else {
      out.push('  none recorded - and NOT because the category was searched and found empty.');
      out.push('  Not one content URL was read. What each origin actually did:');
      for (const { origin, outcomes } of p.attritionByOrigin ?? []) {
        out.push(`    ${origin} - ${outcomes.map(({ outcome, n }) => `${outcome} x${n}`).join(', ')}`);
      }
      out.push('  This is technical attrition in the discovery method. Nothing here establishes');
      out.push('  whether this agency publishes such a form, or whether the public can reach one.');
    }
  }
  p.candidates.forEach((c, i) => out.push(`  ${i + 1}. ${c}`));
  if (p.droppedBeyondBound.length) {
    out.push(`  beyond the bound, not assessed: ${p.droppedBeyondBound.length}`);
  }
  out.push('');
  out.push(`FOR ATTENTION (${p.anomalies.length})`);
  if (p.anomalies.length === 0) out.push('  nothing unusual');
  for (const a of p.anomalies) out.push(`  - ${a}`);
  if (p.supersededRounds.length) {
    out.push('');
    out.push(`SUPERSEDED ROUNDS (${p.supersededRounds.length})`);
    for (const s of p.supersededRounds) out.push(`  v${s.version}: ${s.reason}`);
  }
  out.push('');
  out.push(`This set is ${p.approval}. Approving it means the candidate list above is the`);
  out.push('one that should be assessed - not that any candidate is eligible.');
  return out.join('\n');
}
