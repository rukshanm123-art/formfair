/**
 * Robots policy at every top-level redirect, checked before the target is requested.
 *
 * selection-v1.0.28. `page.goto` follows redirects itself, so a permit and a policy check covering
 * the requested URL covered nothing beyond it. Reproduced against `selection-v1.0.27`: `/allowed`
 * returned 302 to `/forbidden`, Chromium requested both, and the disallowed page came back HTTP 200
 * and rendered - its name field and all. The permit boundary was exactly one hop deep, and none of
 * the sixty-six historical backlog records carries a `finalUrl`, so nothing proved the fifty-seven
 * pages about to be rendered would not do the same.
 *
 * Why this is not `page.route`. Playwright calls a route handler for the request it intercepts and
 * then follows redirects internally: the handler is never called for the redirected request, and
 * fulfilling a 3xx makes Chromium follow it without interception either. Both were tried and both
 * leak - the destination server receives the request in each case. Checking the chain after `goto`
 * returns is later still: by then the forbidden page has been served.
 *
 * So the check sits where the decision actually is, at the response stage of the document request,
 * through CDP `Fetch`. Chromium hands over the 3xx before acting on it; a refusal fails the request
 * and the target is never asked for. Measured: with a refusal in place the destination origin
 * receives zero requests.
 *
 * Scope is the MAIN FRAME only. An iframe is a subresource the page fetches, and failing a render
 * because some embedded third party redirects to an origin whose policy we have not recorded would
 * refuse pages for a reason that has nothing to do with the page.
 */

/** Fail-closed: with no policy source, nothing may be followed. */
export const REFUSE_ALL_REDIRECTS = () => ({
  allowed: false,
  reason: 'no recorded robots policy was made available, so no redirect may be followed',
});

/** A redirect chain longer than this is refused rather than walked. */
export const MAX_REDIRECT_HOPS = 10;

const headerOf = (headers, name) =>
  (headers ?? []).find((h) => h.name.toLowerCase() === name)?.value ?? null;

/**
 * Installs the guard and returns the chain it observed.
 *
 * The caller reads `state.refusal` after `goto`: a refusal surfaces as a blocked navigation, which
 * is an error the caller must distinguish from a real failure.
 */
export async function installRedirectGuard(context, page, { url, policyFor = REFUSE_ALL_REDIRECTS }) {
  const state = { redirectChain: [], refusal: null, hops: 0 };
  const cdp = await context.newCDPSession(page);

  await cdp.send('Page.enable');
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const mainFrameId = frameTree?.frame?.id ?? null;

  const sameResource = (a, b) => {
    try {
      const x = new URL(a);
      const y = new URL(b);
      x.hash = '';
      y.hash = '';
      return x.href === y.href;
    } catch {
      return a === b;
    }
  };

  // Documents only, at the response stage. Pausing every subresource would slow every render for
  // no gain: robots governs the documents a crawler retrieves.
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }],
  });

  cdp.on('Fetch.requestPaused', async (event) => {
    const finish = async (action, args = {}) => {
      try {
        await cdp.send(action, { requestId: event.requestId, ...args });
      } catch {
        // The page may already be gone; a closed target is not a policy decision.
      }
    };

    const status = event.responseStatusCode ?? null;
    const location = headerOf(event.responseHeaders, 'location');
    const isMainFrame = mainFrameId === null || event.frameId === mainFrameId;

    if (!isMainFrame || status === null || status < 300 || status > 399 || !location) {
      return finish('Fetch.continueResponse');
    }

    let target = null;
    try {
      target = new URL(location, event.request.url).href;
    } catch {
      state.refusal = { url: `${event.request.url} -> ${location}`, reason: 'the redirect target is not a usable URL', robotsCheckId: null };
      return finish('Fetch.failRequest', { errorReason: 'BlockedByClient' });
    }

    // EVERY hop is counted, including one that returns to the URL we were authorised for. The first
    // version skipped the counter for that case, which meant a loop between the original URL and
    // another path was never bounded here: Chromium hit its own redirect limit instead, and the
    // refusal came from the browser rather than from the policy - so the log would have carried no
    // reason for it.
    state.hops += 1;
    if (state.hops > MAX_REDIRECT_HOPS) {
      state.refusal = { url: target, from: event.request.url, reason: `more than ${MAX_REDIRECT_HOPS} redirects`, robotsCheckId: null };
      return finish('Fetch.failRequest', { errorReason: 'BlockedByClient' });
    }

    // A redirect back to the authorised URL needs no second POLICY decision - the permit already
    // covers it - but it IS recorded. selection-v1.0.29: it was counted and left out of the chain,
    // which contradicted the protocol's own claim that every hop is recorded and would have broken
    // the continuity check that now validates a refusal.
    if (sameResource(target, url)) {
      state.redirectChain.push({
        from: event.request.url,
        to: target,
        httpStatus: status,
        allowed: true,
        robotsCheckId: null,
        disposition: null,
        reason: 'a redirect back to the URL this permit authorises',
      });
      return finish('Fetch.continueResponse');
    }

    const verdict = policyFor(target) ?? REFUSE_ALL_REDIRECTS();
    state.redirectChain.push({
      from: event.request.url,
      to: target,
      httpStatus: status,
      allowed: verdict.allowed === true,
      robotsCheckId: verdict.robotsCheckId ?? null,
      disposition: verdict.disposition ?? null,
      reason: verdict.reason ?? null,
    });
    if (verdict.allowed !== true) {
      state.refusal = {
        url: target,
        from: event.request.url,
        reason: verdict.reason ?? 'not permitted by the recorded robots policy',
        robotsCheckId: verdict.robotsCheckId ?? null,
        disposition: verdict.disposition ?? null,
      };
      return finish('Fetch.failRequest', { errorReason: 'BlockedByClient' });
    }
    return finish('Fetch.continueResponse');
  });

  return state;
}

/** Was this navigation error our own refusal rather than a failure of the page? */
export const isRefusedNavigation = (error, state) =>
  state?.refusal !== null && /ERR_BLOCKED_BY_CLIENT|ERR_ABORTED|ERR_FAILED/.test(error?.message ?? '');
