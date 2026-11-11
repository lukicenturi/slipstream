import { buildPushPayload } from "@block65/webcrypto-web-push";

import type { Vapid } from "./env";
import type { FetchFn } from "./hl";
import type { PushPayload, SubscriptionTarget } from "./watcher";

/** A push waits at most 1 hour in the push service. */
export const PUSH_TTL_SECONDS = 3600;

/**
 * Encrypt and send one push. Returns the HTTP status of the push service,
 * or 0 when the request failed before a response (network, timeout, bad key).
 */
export async function sendPush(
  subscription: SubscriptionTarget,
  payload: PushPayload,
  vapid: Vapid,
  fetchFn: FetchFn = fetch,
): Promise<number> {
  try {
    const request = await buildPushPayload(
      { data: { ...payload }, options: { ttl: PUSH_TTL_SECONDS, urgency: "high" } },
      {
        endpoint: subscription.endpoint,
        expirationTime: null,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      vapid,
    );
    const response = await fetchFn(subscription.endpoint, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch (error) {
    console.log(JSON.stringify({ event: "push_error", message: String(error) }));
    return 0;
  }
}
