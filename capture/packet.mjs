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
      anomalies.push(
        `NOT READ (${r.outcome}): ${r.discoveryKind} ${r.url}${r.note ? ` - ${r.note}` : ''}`
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
  const notRead = active.filter(
    (r) => TECHNICAL_ATTRITION_OUTCOMES.includes(r.outcome) || r.outcome === 'unavailable'
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

  return {
    agency, category, version: set.version,
    approval: set.approval, lockedAt: set.lockedAt,
    terms: SEARCH_TERMS[category] ?? [],
    websites: byWebsite,
    inspections: active.length,
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
  out.push(
    `inspections       ${p.inspections} active across ${p.websites.length} website(s)` +
      (p.supersededRecords ? `, ${p.supersededRecords} superseded record(s) shown but not evidence` : '')
  );
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
    const notRead = p.attritionByOrigin ?? [];
    if (notRead.length === 0) {
      out.push('  none - every inspection was read, and this category yields no eligible form');
    } else {
      out.push('  none recorded - and NOT because the category was searched and found empty.');
      out.push('  What each origin actually did:');
      for (const { origin, outcomes } of notRead) {
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
