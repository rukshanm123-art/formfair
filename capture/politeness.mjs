/**
 * Politeness policy for the descriptive scan.
 *
 * The frozen protocol fixes what to capture and in what order; it says nothing about how
 * to behave while doing it. These are the researcher's decisions, recorded here so they
 * are part of the artefact rather than improvised during a run, and reported in the
 * provenance of every attempt.
 *
 *   - One capture at a time. No concurrency across agencies or within one.
 *   - At least five seconds between top-level navigations, measured across the whole run.
 *   - robots.txt is honoured. A disallowed path is recorded as excluded, not fetched.
 *   - A 429 stops the run. Retry-After is respected if the run is resumed.
 *   - One retry for a transient failure, then the attempt is recorded as failed.
 *   - Authentication, CAPTCHA, blocking and consent controls are never bypassed. A page
 *     behind one is excluded with that reason; the protocol requires a form to be
 *     publicly reachable without signing in, so such a page is genuinely ineligible.
 *   - The normal Chromium user agent, recorded exactly. A custom agent could change what
 *     the server returns and would make the sample less representative of what a member
 *     of the public receives.
 */

export const POLICY = Object.freeze({
  concurrency: 1,
  minDelayBetweenNavigationsMs: 5000,
  honoursRobotsTxt: true,
  stopOnHttp429: true,
  respectsRetryAfter: true,
  transientRetries: 1,
  bypassesBlockingControls: false,
  userAgent: 'chromium default, unmodified',
  postLoadSettleMs: 2000,
});

/**
 * A deliberately small robots.txt reader.
 *
 * It implements the parts that decide whether a public page may be fetched: user-agent
 * grouping, Allow and Disallow with longest-match precedence, and Crawl-delay. It does not
 * implement wildcards beyond `*` and `$`, and where it cannot parse a rule it treats the
 * path as DISALLOWED, because guessing in the permissive direction is the wrong way to be
 * wrong about someone else's server.
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length > 0 || current.crawlDelay !== null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.rules.push({ allow: field === 'allow', path: value });
    } else if (current && field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return groups;
}

const toRegex = (pattern) => {
  // Escape everything, then restore the two wildcards robots.txt defines.
  let body = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  let anchorEnd = false;
  if (body.endsWith('\\$')) {
    body = body.slice(0, -2);
    anchorEnd = true;
  }
  return new RegExp(`^${body}${anchorEnd ? '$' : ''}`);
};

/** Chooses the group for our agent: an exact match if present, otherwise the `*` group. */
function groupFor(groups, agentToken) {
  const token = agentToken.toLowerCase();
  return (
    groups.find((g) => g.agents.includes(token)) ??
    groups.find((g) => g.agents.includes('*')) ??
    null
  );
}

/**
 * May this path be fetched?
 *
 * Longest matching rule wins, and Allow wins a tie, which is the conventional reading.
 * A robots.txt that could not be retrieved is treated as absent and therefore permissive:
 * that is the standard behaviour, and the alternative would block the whole scan on one
 * server's unrelated outage.
 */
export function isAllowed(groups, pathname, agentToken = '*') {
  if (groups === null) return { allowed: true, reason: 'no robots.txt' };
  const group = groupFor(groups, agentToken);
  if (!group || group.rules.length === 0) return { allowed: true, reason: 'no applicable rule' };

  let best = null;
  for (const rule of group.rules) {
    if (rule.path === '') continue; // `Disallow:` with an empty value permits everything
    let matches;
    try {
      matches = toRegex(rule.path).test(pathname);
    } catch {
      return { allowed: false, reason: `unparsable robots rule ${JSON.stringify(rule.path)}` };
    }
    if (!matches) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule;
    }
  }
  if (!best) return { allowed: true, reason: 'no matching rule' };
  return {
    allowed: best.allow,
    reason: `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}`,
    crawlDelay: group.crawlDelay,
  };
}

/** Paces top-level navigations across a whole run, including any crawl-delay asked for. */
export function createPacer({ minDelayMs = POLICY.minDelayBetweenNavigationsMs, sleep } = {}) {
  let last = 0;
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  return {
    async beforeNavigation(crawlDelaySeconds = null) {
      const required = Math.max(minDelayMs, (crawlDelaySeconds ?? 0) * 1000);
      const elapsed = Date.now() - last;
      if (last !== 0 && elapsed < required) await wait(required - elapsed);
      last = Date.now();
    },
  };
}
