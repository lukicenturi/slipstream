import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * Regression guard: every Hyperliquid endpoint comes from lib/network.ts.
 * A hard-coded endpoint elsewhere is how the testnet build once read mainnet
 * data. This test fails when an endpoint appears in the app source outside
 * the allowed files. Tests and fixtures may hold endpoints.
 *
 * The asset icon base `app.hyperliquid.xyz/coins` (lib/assets.ts) is not an
 * endpoint pattern, so it stays allowed for both networks.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The source that ships in the app. */
const SCANNED_DIRS = ["app", "components", "hooks", "lib"];
const SCANNED_ROOT_FILES = ["next.config.ts"];
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;

/** The files that may name an endpoint, relative to the repository root. */
const ALLOWED_FILES = new Set([
  "lib/network.ts", // the one table of endpoints
  "lib/trading/exchange.ts", // the testnet host pin of the exchange transport
]);

const ENDPOINT_PATTERN =
  /api\.hyperliquid\.xyz|api\.hyperliquid-testnet\.xyz|stats-data\.hyperliquid\.xyz|app\.hyperliquid\.xyz\/explorer|app\.hyperliquid-testnet\.xyz/;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) files.push(path);
  }
  return files;
}

/** Every `file:line` outside the allowed files that names an endpoint. */
function findEndpointLiterals(): string[] {
  const files = [
    ...SCANNED_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))),
    ...SCANNED_ROOT_FILES.map((file) => join(ROOT, file)),
  ];
  const hits: string[] = [];
  for (const file of files) {
    const name = relative(ROOT, file).split("\\").join("/");
    if (ALLOWED_FILES.has(name)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (ENDPOINT_PATTERN.test(line)) hits.push(`${name}:${index + 1}: ${line.trim()}`);
      });
  }
  return hits;
}

describe("endpoint guard", () => {
  it("finds no Hyperliquid endpoint outside lib/network.ts and the exchange host pin", () => {
    expect(findEndpointLiterals()).toEqual([]);
  });

  it.each([
    ["https://api.hyperliquid.xyz/info", true],
    ["wss://api.hyperliquid.xyz/ws", true],
    ["https://api.hyperliquid-testnet.xyz/info", true],
    ["https://stats-data.hyperliquid.xyz/Mainnet/leaderboard", true],
    ["https://app.hyperliquid.xyz/explorer/address/0xabc", true],
    ["https://app.hyperliquid-testnet.xyz/drip", true],
    ["https://app.hyperliquid.xyz/coins/BTC.svg", false],
    ["https://hyperliquid.gitbook.io/hyperliquid-docs", false],
  ])("matches %s: %s", (url, expected) => {
    expect(ENDPOINT_PATTERN.test(url)).toBe(expected);
  });
});
