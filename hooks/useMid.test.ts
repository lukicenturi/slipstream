import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { midsStore } from "@/lib/hyperliquid/mids";

import { useMid } from "./useMid";

/*
 * The test environment has no DOM, so this test renders on the server.
 * The per-coin updates of the store are covered in lib/hyperliquid/mids.test.ts.
 */

function MidProbe({ coin }: { coin: string }) {
  const mid = useMid(coin);
  return createElement("span", null, mid === undefined ? "none" : String(mid));
}

describe("useMid", () => {
  it("renders no mid on the server, so the HTML matches the first client render", () => {
    midsStore.ingest({ BTC: 100 });
    expect(renderToString(createElement(MidProbe, { coin: "BTC" }))).toBe("<span>none</span>");
  });
});
