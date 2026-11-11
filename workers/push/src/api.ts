import type { z } from "zod";

import { corsHeaders, decideOrigin } from "./cors";
import {
  applyTestResult,
  deleteSubscriptionByEndpoint,
  findSubscription,
  upsertSubscription,
} from "./db";
import { readConfig, readVapid, type Env } from "./env";
import { sendPush } from "./push";
import { endpointBodySchema, normalizeWatches, subscribeBodySchema } from "./schemas";
import { runTick, type TickDeps } from "./watch";
import { classifyPushStatus, type PushPayload } from "./watcher";

/** Request bodies above this size get 413. */
export const MAX_BODY_BYTES = 64 * 1024;

export const TEST_PAYLOAD: Omit<PushPayload, "time"> = {
  title: "Slipstream push alerts are on",
  body: "You will get a notification when a tracked trader trades.",
  url: "/watchlist",
  tag: "slipstream-test",
};

type JsonValue = Record<string, unknown>;

function json(body: JsonValue, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

type BodyResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: string; message: string };

/** Read and validate a JSON body with a size limit. */
export async function readBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<BodyResult<z.output<S>>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "body_too_large", message: "Body above 64 KB" };
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "body_too_large", message: "Body above 64 KB" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, error: "invalid_json", message: "Body is not JSON" };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    return {
      ok: false,
      status: 400,
      error: "invalid_body",
      message: `${path ? `${path}: ` : ""}${issue?.message ?? "Invalid body"}`,
    };
  }
  return { ok: true, data: parsed.data };
}

/** Constant-time comparison of the admin token. */
function tokenMatches(header: string | null, token: string | undefined): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const given = header.slice("Bearer ".length);
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let index = 0; index < token.length; index += 1) {
    diff |= given.charCodeAt(index) ^ token.charCodeAt(index);
  }
  return diff === 0;
}

export async function handleRequest(
  request: Request,
  env: Env,
  deps: TickDeps = {},
): Promise<Response> {
  const config = readConfig(env);
  const decision = decideOrigin(request.headers.get("origin"), config.allowedOrigins);
  if (decision.kind === "forbidden") {
    return json({ error: "origin_not_allowed" }, 403, {});
  }
  const cors = corsHeaders(decision);
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    switch (route) {
      case "GET /health":
        return json({ ok: true, network: "any", time: Date.now() }, 200, cors);

      case "GET /vapid-public-key": {
        const vapid = readVapid(env);
        if (!vapid) return json({ error: "not_configured" }, 503, cors);
        return json({ publicKey: vapid.publicKey }, 200, cors);
      }

      case "POST /subscriptions": {
        const body = await readBody(request, subscribeBodySchema);
        if (!body.ok) return json({ error: body.error, message: body.message }, body.status, cors);
        const watches = normalizeWatches(body.data.addresses, config.maxAddressesPerSubscription);
        if (!watches.ok) return json({ error: watches.error, message: watches.message }, 400, cors);
        const id = await upsertSubscription(
          env.DB,
          {
            endpoint: body.data.subscription.endpoint,
            p256dh: body.data.subscription.keys.p256dh,
            auth: body.data.subscription.keys.auth,
            network: body.data.network,
            minNotional: body.data.minNotionalUsd,
            watches: watches.watches,
          },
          Date.now(),
        );
        return json({ id, addresses: watches.watches.length }, 200, cors);
      }

      case "DELETE /subscriptions": {
        const body = await readBody(request, endpointBodySchema);
        if (!body.ok) return json({ error: body.error, message: body.message }, body.status, cors);
        const removed = await deleteSubscriptionByEndpoint(env.DB, body.data.endpoint);
        return json({ removed }, 200, cors);
      }

      case "POST /subscriptions/test": {
        const body = await readBody(request, endpointBodySchema);
        if (!body.ok) return json({ error: body.error, message: body.message }, body.status, cors);
        const vapid = readVapid(env);
        if (!vapid) return json({ error: "not_configured" }, 503, cors);
        const subscription = await findSubscription(env.DB, body.data.endpoint);
        if (!subscription) return json({ error: "not_found" }, 404, cors);
        const status = await sendPush(
          subscription,
          { ...TEST_PAYLOAD, time: Date.now() },
          vapid,
          deps.fetch,
        );
        const outcome = classifyPushStatus(status);
        await applyTestResult(env.DB, subscription.id, outcome);
        return json({ sent: outcome === "sent", status }, 200, cors);
      }

      case "POST /tick": {
        if (!tokenMatches(request.headers.get("authorization"), env.ADMIN_TOKEN)) {
          return json({ error: "unauthorized" }, 401, cors);
        }
        const stats = await runTick(env, deps);
        return json({ ...stats }, 200, cors);
      }

      default:
        return json({ error: "not_found" }, 404, cors);
    }
  } catch (error) {
    console.log(JSON.stringify({ event: "request_error", route, message: String(error) }));
    return json({ error: "internal_error" }, 500, cors);
  }
}
