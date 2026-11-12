import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * Regression guard: the wallet code that runs on mainnet is read-only.
 * The header wallet button, the connected account view and the connect
 * popover show in every build. They must never import the exchange module
 * or the trading actions hook, which sign and send exchange actions.
 *
 * The test checks the direct imports of each file, and it also follows the
 * static imports (`import ... from`, `export ... from`) through the app
 * source. A dynamic `import()` is a separate chunk that loads only when it
 * renders (the trading sheet form), so the walk does not follow it. A
 * type-only import has no runtime code, so the walk skips it too.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The wallet files that render on mainnet. */
const MAINNET_WALLET_FILES = [
  "components/trading/WalletButton.tsx",
  "components/account/WalletAccount.tsx",
  "components/trading/ConnectWallet.tsx",
];

/** The modules that sign or send exchange actions. */
const FORBIDDEN_FILES = ["lib/trading/exchange.ts", "hooks/useTradingActions.ts"];
const FORBIDDEN_SPECIFIER = /(^|\/)(lib\/trading\/exchange|useTradingActions)$/;
/** The exchange SDK. Only lib/trading/exchange.ts may import it. */
const SDK_SPECIFIER = /^@nktkas\/hyperliquid(\/|$)/;

const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)(\s+type\b)?[^;"'`]*?\bfrom\s+["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** The runtime import specifiers of a source text (type-only imports skipped). */
function staticImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(STATIC_IMPORT)) {
    const typeOnly = match[1] !== undefined;
    const specifier = match[2];
    if (!typeOnly && specifier !== undefined) specifiers.push(specifier);
  }
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** The repository-relative file of an app import, or null for a package. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(ROOT, dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, ...EXTENSIONS.map((extension) => base + extension)]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) {
      return relative(ROOT, candidate).split("\\").join("/");
    }
  }
  return null;
}

/** Every app file that `entry` reaches through static imports, and the packages they import. */
function reachable(entry: string): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    for (const specifier of staticImports(readFileSync(join(ROOT, file), "utf8"))) {
      const target = resolveImport(file, specifier);
      if (target !== null) queue.push(target);
      else if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
        if (!packages.has(specifier)) packages.set(specifier, file);
      }
    }
  }
  return { files, packages };
}

describe("wallet guard", () => {
  it.each(MAINNET_WALLET_FILES)(
    "%s does not import the exchange or the trading actions",
    (file) => {
      const direct = staticImports(readFileSync(join(ROOT, file), "utf8"));
      expect(direct.filter((specifier) => FORBIDDEN_SPECIFIER.test(specifier))).toEqual([]);
    },
  );

  it.each(MAINNET_WALLET_FILES)("%s does not reach them through static imports", (file) => {
    const { files, packages } = reachable(file);
    expect(FORBIDDEN_FILES.filter((forbidden) => files.has(forbidden))).toEqual([]);
    const sdk = [...packages].filter(([specifier]) => SDK_SPECIFIER.test(specifier));
    expect(sdk).toEqual([]);
  });

  it("the walk finds the exchange from the trading sheet form (self-check)", () => {
    const { files } = reachable("components/trading/TradingCopyTradeForm.tsx");
    expect(files.has("hooks/useTradingActions.ts")).toBe(true);
    expect(files.has("lib/trading/exchange.ts")).toBe(true);
  });

  it("the signing panels of the account and the tracker load only through dynamic imports", () => {
    // They reach the exchange (self-check), but the wallet account does not reach them.
    for (const file of [
      "components/account/OpenOrdersPanel.tsx",
      "components/providers/TrailingStopTracker.tsx",
      "components/trading/ManagePositionForm.tsx",
    ]) {
      expect(reachable(file).files.has("lib/trading/exchange.ts")).toBe(true);
    }
    const { files } = reachable("components/account/WalletAccount.tsx");
    expect(files.has("components/account/OpenOrdersPanel.tsx")).toBe(false);
    expect(files.has("components/trading/ManagePositionForm.tsx")).toBe(false);
  });

  it("reads static, re-export and side-effect imports, and skips type-only and dynamic ones", () => {
    const source = [
      'import { a } from "@/lib/a";',
      'import type { B } from "@/lib/b";',
      "import {\n  c,\n  type C,\n} from './c';",
      'export { d } from "@/lib/d";',
      'export type { E } from "@/lib/e";',
      'import "./f.css";',
      'const G = dynamic(() => import("./g"));',
    ].join("\n");
    expect(staticImports(source).sort()).toEqual(["./c", "./f.css", "@/lib/a", "@/lib/d"]);
  });
});
