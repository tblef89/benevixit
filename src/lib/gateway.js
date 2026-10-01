/**
 * AI Gateway options for every keeper and judge call.
 *
 * The gateway keeps request and response bodies in its logs by default,
 * which for us means visitors' conversations. collectLog: false stops that
 * per request, whatever the dashboard says, so the privacy promise ("we do
 * not keep them") cannot be undone by a settings change. skipCache: every
 * conversation is different, and a cache entry would be one more copy.
 * Counts, tokens and errors still reach the gateway's analytics.
 */
export function gatewayOptions(env) {
  return { gateway: { id: env.GATEWAY_ID, collectLog: false, skipCache: true } };
}
