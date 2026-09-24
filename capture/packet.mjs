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

import { setKey, CATEGORY_ORDER, SEARCH_TERMS, MAX_CANDIDATES_PER_CATEGORY } from './selection.mjs';

const pad = (s, n) => String(s).padEnd(n);

export function buildPacket(log, { agency, category }) {
  const set = log.candidateSets?.[setKey(agency, category)];
  if (!set) throw new Error(`no candidate set for ${agency} / ${category}`);

  const records = log.attempts.filter(
    (a) => a.status === 'discovery' && a.agency === agency && a.category === category &&
      a.candidateSetVersion === set.version
  );

  const websites = [...new Set(records.map((r) => r.website))].sort();
  const byWebsite = websites.map((w) => ({
    website: w,
    inspections: records
      .filter((r) => r.website === w)
      .map((r) => ({ method: r.discoveryKind, outcome: r.outcome, url: r.url, note: r.note ?? null })),
  }));

  // Anything a reviewer should look at twice, most decision-relevant first.
  const anomalies = [];

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
  for (const r of records) {
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

  return {
    agency, category, version: set.version,
    approval: set.approval, lockedAt: set.lockedAt,
    terms: SEARCH_TERMS[category] ?? [],
    websites: byWebsite,
    inspections: records.length,
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
  out.push(`inspections       ${p.inspections} across ${p.websites.length} website(s)`);
  out.push('');
  for (const w of p.websites) {
    out.push(`  ${w.website}`);
    for (const i of w.inspections) {
      out.push(`    ${pad(i.method, 16)} ${pad(i.outcome, 17)} ${i.url}`);
      if (i.note) out.push(`    ${' '.repeat(34)}${i.note}`);
    }
  }
  out.push('');
  out.push(`CANDIDATES (${p.candidates.length})`);
  if (p.candidates.length === 0) out.push('  none - this category yields no eligible form');
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
