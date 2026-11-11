import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MidsSourceProvider, useMidsStore } from "@/components/providers/MidsSourceProvider";
import { createMidsStore, midsStore } from "@/lib/hyperliquid/mids";

import { useMid } from "./useMid";

/*
 * The test environment has no DOM, so these tests render on the server.
 * They check which store a hook reads; the per-coin updates of a store
 * are covered in lib/hyperliquid/mids.test.ts.
 */

const testnetStore = createMidsStore();

function StoreProbe() {
  const store = useMidsStore();
  const name = store === midsStore ? "default" : store === testnetStore ? "testnet" : "other";
  return createElement("span", null, name);
}

function MidProbe({ coin }: { coin: string }) {
  const mid = useMid(coin);
  return createElement("span", null, mid === undefined ? "none" : String(mid));
}

describe("mids source", () => {
  it("reads the app-wide store without a provider", () => {
    expect(renderToString(createElement(StoreProbe))).toBe("<span>default</span>");
  });

  it("reads the store of the nearest provider", () => {
    const html = renderToString(
      createElement(MidsSourceProvider, { store: testnetStore }, createElement(StoreProbe)),
    );
    expect(html).toBe("<span>testnet</span>");
  });

  it("leaves views outside the provider on the default store", () => {
    const html = renderToString(
      createElement(
        "div",
        null,
        createElement(MidsSourceProvider, { store: testnetStore }, createElement(StoreProbe)),
        createElement(StoreProbe),
      ),
    );
    expect(html).toBe("<div><span>testnet</span><span>default</span></div>");
  });
});

describe("useMid", () => {
  it("renders no mid on the server, so the HTML matches the first client render", () => {
    midsStore.ingest({ BTC: 100 });
    expect(renderToString(createElement(MidProbe, { coin: "BTC" }))).toBe("<span>none</span>");
  });
});
