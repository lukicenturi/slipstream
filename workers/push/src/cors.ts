/*
 * CORS by allowlist. A browser always sends `Origin` on these requests.
 * A request without `Origin` comes from a tool such as curl and gets no
 * CORS headers. A request from an origin outside the list gets 403.
 */

export type OriginDecision =
  { kind: "none" } | { kind: "allowed"; origin: string } | { kind: "forbidden" };

export function decideOrigin(origin: string | null, allowed: readonly string[]): OriginDecision {
  if (origin === null || origin === "") return { kind: "none" };
  const normalized = origin.replace(/\/+$/, "");
  return allowed.includes(normalized)
    ? { kind: "allowed", origin: normalized }
    : { kind: "forbidden" };
}

export function corsHeaders(decision: OriginDecision): Record<string, string> {
  if (decision.kind !== "allowed") return {};
  return {
    "access-control-allow-origin": decision.origin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
