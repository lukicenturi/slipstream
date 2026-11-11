# Decisions

This file records each choice that differs from `PLAN.md`, each API surprise, and each item that is not complete. Newest entries are at the bottom of each date.

## 2026-11-11

### Design references

- Only 5 of the 8 reference screenshots exist. The Arbital, Farcaster and Family images are missing. Axiom informs the feed rows. Phantom informs the copy-trade sheet.
- The accent colour is amber `#F2B544`. It differs from every reference palette.

### Theme tokens

- shadcn uses `--accent` for neutral hover surfaces. To keep hover states neutral, our amber accent is `--primary` in shadcn terms. Tailwind exposes it as `brand` (`bg-brand`, `text-brand`, `bg-brand-dim`). `--accent` maps to the surface hover colour.
- The Tailwind text scale is remapped to the plan's type scale: `text-2xs` 11 px, `text-xs` 12 px, `text-sm` 13 px (body), `text-base` 14 px, `text-lg` 16 px, `text-xl` 20 px, `text-hero` 28 px.
- Radius keys above `lg` collapse to 6 px, and every shadow token is `none`. A stray shadcn class can therefore not add a large radius or a shadow.
- shadcn was initialised with the `radix-nova` style. Its `cn` helper comes from the `cn` package instead of `clsx` + `tailwind-merge`. We keep it.

### Tooling

- `create-next-app` 16.4.6 enables `cacheComponents`. With it, the route segment config `export const dynamic = 'force-dynamic'` is not allowed. We keep `cacheComponents` on. The leaderboard route calls `await connection()` from `next/server`, which makes it run at request time. `unstable_cache` still works with `cacheComponents` (the Next 16 docs confirm this), so the plan's two cache layers stay as written.
- The `typecheck` script runs `next typegen` before `tsc --noEmit`. The scaffold uses the global `LayoutProps` type, which exists only after Next generates route types. Without this step, a fresh clone fails the typecheck.
- `vitest.config.ts` is renamed to `vitest.config.mts`. Vite warned that the `.ts` config uses ESM syntax in a CommonJS package.
- Prettier uses `printWidth: 100`. `PLAN.md`, `CLAUDE.md` and `AGENTS.md` are in `.prettierignore`, so the formatter does not rewrite the project instructions.
- The scaffold's boilerplate home page and its SVG files are removed. `app/page.tsx` is a plain placeholder until Phase 2.

### Leaderboard

- The top 100 rows are selected by month PnL. The Day, Week and All tabs (Phase 2) re-sort those 100 rows in the browser. The raw file is never sent to the browser.
- The raw response is about 39 MB, above the 2 MB limit of the Next data cache. The route fetches it with `cache: 'no-store'`, trims it, and caches only the trimmed result (about 39 KB). The cache layers are `unstable_cache` (900 s) and a module-level memory cache with a 15 min TTL. When a refresh fails and older data exists, the route returns the older data with `stale: true`. A cold request takes about 7 s in dev. A warm request takes about 20 ms.
- The trim logic lives in `lib/hyperliquid/leaderboard-trim.ts`, apart from the `server-only` module, so that Vitest can test it.
- If fewer than 10 rows parse, the route returns HTTP 502 `{ "error": "leaderboard_unavailable" }` and logs the failure once.
- `getLeaderboard()` in the browser uses a 60 s timeout instead of 10 s, because a cold `/api/leaderboard` request downloads the raw file first.

### Schemas and API surprises

- Zod 4 objects strip unknown keys by default. This keeps the schemas tolerant of new fields without `.passthrough()`.
- `allMids` messages contain about 1,425 keys. Keys that start with `@` (spot) or `#` (builder markets) are dropped in the schema transform. One bad value is skipped instead of the whole message.
- Live `userFills` messages have no `isSnapshot` key. The parsed message always has `isSnapshot: boolean` (`false` when the key is missing).
- `WsMessage` is a union with a fallback branch. `parseWsMessage()` reads the `channel` first and then applies the schema for that channel. An invalid message on a known channel returns `null`; an unknown channel returns `{ channel: 'unknown' }`. A plain `z.union` would hide invalid known messages in the fallback branch, so we do not use one.
- An extra fixture, `fixtures/ws-control.json`, holds a real `subscriptionResponse` and a real `pong`. `scripts/capture-ws-fixtures.mjs` captures all WebSocket fixtures again.
- `clearinghouseState` for an empty address returns `accountValue: "0.1"` and no positions. This is not an error.

### WebSocket

- `HyperliquidSocket` takes an optional `createSocket` factory, so that `lib/hyperliquid/ws.test.ts` can test reference counts, routing, backoff, resubscribe, ping and the idle close with a fake socket and fake timers.
- The socket status starts as `closed`. `useConnectionStatus` returns `connecting` on the server and before the socket exists, because the app subscribes to `allMids` on mount. This prevents a flash of "closed".
- `useHyperliquidWs` uses React 19 `useEffectEvent` for the handler and for the current subscription. Only a change of the subscription key resubscribes.

### Still to come in later phases

- Fills carry no leverage, so feed cards will omit the leverage figure from the plan's example copy.
- Snapshot fills will seed the feed (flagged not live, no animation). Live fills will animate in.
- Per-wallet info calls go straight from the browser to the info endpoint (CORS `*`).
- The liquidation estimate will use the isolated-margin formula with `mmr = 1 / (2 * maxLeverage)`.
- The deployment URL and the items that cannot be done here (a real phone test, a GIF) will be added in Phase 4.
