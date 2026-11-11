import { uniqueAddresses } from "@/lib/names";

import {
  namesResponseSchema,
  resolveErrorSchema,
  resolveResponseSchema,
  type NamesResponse,
  type ResolveResponse,
} from "./schemas";

/*
 * Browser client for our two name routes. It never calls the RPC or the
 * HL Names API directly. Every body goes through a zod schema here.
 */

const REQUEST_TIMEOUT_MS = 15_000;

export type NamesErrorKind = "not_found" | "invalid" | "unavailable" | "network" | "schema";

export class NamesError extends Error {
  readonly kind: NamesErrorKind;
  readonly status: number | undefined;

  constructor(
    kind: NamesErrorKind,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "NamesError";
    this.kind = kind;
    this.status = options?.status;
  }
}

interface RequestOptions {
  signal?: AbortSignal;
}

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function send(
  url: string,
  init: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new NamesError("network", `Request to ${url} failed`, { cause: error });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new NamesError("schema", `Response from ${url} is not JSON`, {
      status: response.status,
      cause: error,
    });
  }
  return { response, body };
}

function errorKind(status: number, body: unknown): NamesErrorKind {
  const parsed = resolveErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error : null;
  if (status === 404 || code === "name_not_found") return "not_found";
  if (status === 400 || code === "invalid_name") return "invalid";
  return "unavailable";
}

/**
 * Resolve a `.eth` or `.hl` name to a lower-case address through
 * /api/resolve. Throws NamesError: `not_found` for an unknown name,
 * `invalid` for a rejected input, `unavailable`, `network` or `schema`
 * when the lookup failed.
 */
export async function resolveName(
  name: string,
  options: RequestOptions = {},
): Promise<ResolveResponse> {
  const url = `/api/resolve?name=${encodeURIComponent(name)}`;
  const { response, body } = await send(url, { signal: withTimeout(options.signal) });
  if (!response.ok) {
    throw new NamesError(
      errorKind(response.status, body),
      `Resolve returned HTTP ${response.status}`,
      {
        status: response.status,
      },
    );
  }
  const parsed = resolveResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new NamesError("schema", "Resolve response does not match the schema", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** The .hl and ENS primary names of up to 120 addresses, through /api/names. */
export async function lookupNames(
  addresses: readonly string[],
  options: RequestOptions = {},
): Promise<NamesResponse> {
  const url = "/api/names";
  const { response, body } = await send(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addresses: uniqueAddresses(addresses) }),
    signal: withTimeout(options.signal),
  });
  if (!response.ok) {
    throw new NamesError("unavailable", `Names returned HTTP ${response.status}`, {
      status: response.status,
    });
  }
  const parsed = namesResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new NamesError("schema", "Names response does not match the schema", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
