/*
 * Maps SDK, wallet and network failures to a small TradingError that the
 * sheet can show. The texts come from real exchange responses (see
 * DECISIONS.md, "Testnet trading" and "Mainnet trading at parity"). When the
 * exchange sent a text, the error keeps it verbatim in `exchangeMessage`,
 * so the sheet can show it next to the short message.
 */

import type { Network } from "@/lib/network";

export type TradingErrorKind =
  /** The user rejected the signature in the wallet. */
  | "rejected"
  /** The account has no funds on the network. */
  | "unfunded"
  /** The stored agent is not (or no longer) approved on the exchange. */
  | "agent"
  /** The wallet refused the signature chain id. */
  | "chain"
  /** Any other API error. The message is the API text. */
  | "api"
  /** The request did not reach the exchange or timed out. */
  | "network";

export class TradingError extends Error {
  readonly kind: TradingErrorKind;
  /** The exact text that the exchange returned, when there is one. */
  readonly exchangeMessage: string | undefined;

  constructor(
    kind: TradingErrorKind,
    message: string,
    options?: { cause?: unknown; exchangeMessage?: string },
  ) {
    super(message, { cause: options?.cause });
    this.name = "TradingError";
    this.kind = kind;
    this.exchangeMessage = options?.exchangeMessage;
  }
}

/** The short messages of a network. */
export function tradingMessages(network: Network) {
  return {
    rejected: "Signature rejected.",
    unfunded: `This wallet has no ${network} funds.`,
    agent: `The agent is not approved on ${network}. Approve it again.`,
    chain: "The wallet refused the signature network.",
    network: `Could not reach the Hyperliquid ${network}. Try again.`,
  } as const;
}

/** The testnet messages (kept for the tests and the testnet texts). */
export const MESSAGES = tradingMessages("testnet");

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  cause?: unknown;
  response?: unknown;
}

function asErrorLike(value: unknown): ErrorLike | null {
  return typeof value === "object" && value !== null ? (value as ErrorLike) : null;
}

/** The error and its causes, outermost first (at most 8 levels). */
function causeChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  let current = asErrorLike(error);
  while (current && chain.length < 8 && !chain.includes(current)) {
    chain.push(current);
    current = asErrorLike(current.cause);
  }
  return chain;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The `response` text of an SDK ApiRequestError with a top-level error, else null. */
function apiErrorText(item: ErrorLike): string | null {
  if (item.name !== "ApiRequestError") return null;
  const response = asErrorLike(item.response);
  if (response && typeof response.response === "string") return response.response;
  return text(item.message) || null;
}

export function isUserRejection(error: unknown): boolean {
  return causeChain(error).some(
    (item) =>
      item.code === 4001 ||
      item.name === "UserRejectedRequestError" ||
      /user (rejected|denied)/i.test(text(item.message)),
  );
}

export function isChainMismatch(error: unknown): boolean {
  return causeChain(error).some((item) => {
    const message = text(item.message);
    return /chain ?id/i.test(message) && /(match|mismatch|invalid|unsupported)/i.test(message);
  });
}

/**
 * Turn any thrown value into a TradingError.
 * `agentAddress` is the signer of an agent-signed action: "User or API
 * Wallet <agent> does not exist" then means the agent is not approved.
 * `network` picks the words of the short messages (default testnet).
 */
export function toTradingError(
  error: unknown,
  context: { agentAddress?: string; network?: Network } = {},
): TradingError {
  if (error instanceof TradingError) return error;
  const messages = tradingMessages(context.network ?? "testnet");
  if (isUserRejection(error))
    return new TradingError("rejected", messages.rejected, { cause: error });

  const chain = causeChain(error);
  for (const item of chain) {
    const apiText = apiErrorText(item);
    if (apiText === null) continue;
    const options = { cause: error, exchangeMessage: apiText };
    if (/must deposit/i.test(apiText)) {
      return new TradingError("unfunded", messages.unfunded, options);
    }
    if (/does not exist/i.test(apiText)) {
      const agent = context.agentAddress?.toLowerCase();
      const kind = agent && apiText.toLowerCase().includes(agent) ? "agent" : "unfunded";
      return new TradingError(kind, messages[kind], options);
    }
    return new TradingError("api", apiText, options);
  }

  if (isChainMismatch(error)) return new TradingError("chain", messages.chain, { cause: error });

  const network = chain.some(
    (item) =>
      item.name === "HttpRequestError" ||
      item.name === "TransportError" ||
      item.name === "TimeoutError" ||
      item.name === "AbortError" ||
      (item.name === "TypeError" && /fetch/i.test(text(item.message))),
  );
  if (network) return new TradingError("network", messages.network, { cause: error });

  const message = text(chain[0]?.message) || "Something went wrong.";
  return new TradingError("api", message, { cause: error });
}
