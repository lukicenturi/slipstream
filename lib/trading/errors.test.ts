import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import { describe, expect, it } from "vitest";

import { isChainMismatch, MESSAGES, toTradingError, TradingError } from "./errors";

const OWNER = "0xf5082a22bddbb83d94c7c563f39cce60fee4c28e";
const AGENT = "0xcd3b81c4aac35facf9eea7155c8f3b771420acdb";

// The exact texts that the testnet returned to an unfunded throwaway account.
const MUST_DEPOSIT = `Must deposit before performing actions. User: ${OWNER}`;
const AGENT_MISSING = `User or API Wallet ${AGENT} does not exist.`;

function apiError(response: string): ApiRequestError {
  return new ApiRequestError({ status: "err", response });
}

describe("toTradingError", () => {
  it("maps the unfunded approval error", () => {
    const error = toTradingError(apiError(MUST_DEPOSIT));
    expect(error.kind).toBe("unfunded");
    expect(error.message).toBe(MESSAGES.unfunded);
  });

  it("maps a missing agent when the agent signed", () => {
    expect(toTradingError(apiError(AGENT_MISSING), { agentAddress: AGENT }).kind).toBe("agent");
  });

  it("maps a missing main account to unfunded", () => {
    const text = `User or API Wallet ${OWNER} does not exist.`;
    expect(toTradingError(apiError(text), { agentAddress: AGENT }).kind).toBe("unfunded");
  });

  it("keeps the text of other API errors", () => {
    const error = toTradingError(apiError("Insufficient margin to place order."));
    expect(error.kind).toBe("api");
    expect(error.message).toBe("Insufficient margin to place order.");
  });

  it("detects a user rejection deep in the cause chain", () => {
    const rejection = Object.assign(new Error("User rejected the request."), {
      name: "UserRejectedRequestError",
      code: 4001,
    });
    const wrapped = new Error("Failed to sign typed data", { cause: rejection });
    const error = toTradingError(wrapped);
    expect(error.kind).toBe("rejected");
    expect(error.message).toBe("Signature rejected.");
  });

  it("detects a chain id mismatch", () => {
    const mismatch = new Error('Provided chainId "421614" must match the active chainId "1"');
    expect(isChainMismatch(new Error("sign", { cause: mismatch }))).toBe(true);
    expect(toTradingError(mismatch).kind).toBe("chain");
  });

  it("maps transport failures to network", () => {
    const failure = Object.assign(new Error("HTTP request failed"), { name: "HttpRequestError" });
    expect(toTradingError(failure).kind).toBe("network");
    expect(toTradingError(new TypeError("Failed to fetch")).kind).toBe("network");
  });

  it("passes a TradingError through and handles non-errors", () => {
    const original = new TradingError("agent", MESSAGES.agent);
    expect(toTradingError(original)).toBe(original);
    expect(toTradingError("boom").kind).toBe("api");
  });
});
