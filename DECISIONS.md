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

- Per-wallet info calls go straight from the browser to the info endpoint (CORS `*`).
- The liquidation estimate will use the isolated-margin formula with `mmr = 1 / (2 * maxLeverage)`.
- The deployment URL and the items that cannot be done here (a real phone test, a GIF) will be added in Phase 4.

### Phase 2: leaderboard and live feed

- Fills carry no leverage, so feed rows omit the leverage figure from the plan's example copy ("opened 5x long").
- Snapshot fills seed the feed. They are flagged `live: false` and do not animate. Live fills are flagged `live: true` and slide in (`motion-safe` only).
- The feed reducer is a pure module in `lib/calc/liveFeed.ts`, with its tests next to it. `hooks/useLiveFeed.ts` only wires it to `useReducer` and the shared socket. React StrictMode runs reducers twice, so the reducer copies its sets and never changes the old state.
- The de-duplication key is `user:tid`, not `tid` alone. Both sides of one trade share a tid, and two top traders can trade against each other. A key of `tid` alone would hide the second trader's fill.
- The seen set is capped at 5,000 keys, as planned. A snapshot can hold up to 2,000 fills per trader, so the cap alone cannot block an old fill from coming back after a reconnect. The reducer also keeps a per-trader watermark (the newest fill time). A snapshot fill older than the watermark is ignored.
- A snapshot keeps the 20 most recent orders per trader after aggregation. With 15 to 20 active traders, the 100-item cap fills at once from snapshots, and live items push the oldest out.
- `aggregateFills` groups by `oid` only. `mergeFillIntoItems` (and `mergeItemIntoItems`) add the 60 s rule: a later part of the same order joins the item when the gap is 60 s or less, else it starts a new item. A merged item keeps its id and its `live` flag, so it does not animate again.
- When the parts of one order carry different `dir` values (for example "Close Long" and "Open Short"), the item shows the flip ("Long > Short").
- The feed side badge shows the position side ("Long"/"Short") from `dir`, so "Close Long" shows "Long". Spot fills ("Buy"/"Sell") show "Buy"/"Sell". Spot coins show their raw id (for example `@107`), because the app does not load spot metadata.
- A closed PnL that rounds to $0.00 is hidden.
- The feed error state uses "not open for more than 30 s", not "status is `closed` for more than 30 s". While subscribers exist, the socket retries and its status stays `reconnecting`; it only reaches `closed` when nobody subscribes. `HyperliquidSocket.getDownSince()` returns the time when the socket left the open state. `useConnectionLost()` reads it.
- When the connection is lost and the feed already has items, a banner with a "Reconnect" button shows above the items. The items stay. When the feed is empty, the full error state shows.
- The header and the empty feed show the connection status as a dot plus a word: "Live", "Connecting", "Reconnecting", "Offline". The feed panel header shows the order count instead of a second status.
- The leaderboard rank is the PnL rank in the chosen window. It stays with the row when another column is sorted. Account value, PnL and ROI are sortable; Rank and Trader are not. Sorting and ranking live in `lib/calc/leaderboard.ts`.
- Below `sm`, the leaderboard shows compact USD values (`+$142.5M`) and hides the Account value column. From `sm` up it shows full values.
- On mobile, the panel titles are visually hidden (screen readers still read them), because the tab bar above shows the same words.
- `AddressSearch` already validates and navigates to `/trader/<address>`. The profile page arrives in Phase 3, so the link returns 404 until then. Trader links use `prefetch={false}` so that 100 rows do not prefetch 100 routes.
- Only about 15 of the top 20 traders return a `userFills` snapshot. The others send no snapshot message (they have no recent fills). The dev page shows the snapshot count, so the reconnect check waits for the same count again.
- The `/dev` page now shows feed counts: items, unique user+oid, fills, unique fills, snapshots, live messages, duplicates dropped, traders followed. It also has the "Force reconnect" button.
- Done-when check (headless Chromium, `pnpm dev -p 3100`): before the reconnect, 100 items and 100 unique user+oid. After the first forced reconnect, 100 and 100 (snapshots 15 -> 30, 406 replayed fills dropped). After the second, 100 and 100 (snapshots 45, 803 dropped). Fills equal unique fills in every sample. No console errors or warnings. No horizontal scroll at 375 px. The feed keeps its 100 items across a mobile tab switch.
- During the first browser run, the dev server sent HMR "built" events in a loop and the page reloaded again and again. After a file edit the loop stopped, and it did not come back with the same code. It looks like a stale Turbopack dev state, not an app bug.

### Phase 3: trader profile

- The page `app/trader/[address]/page.tsx` stays a server page. With `cacheComponents` on, route params are request data, so the page reads them in a child component inside a `Suspense` boundary. `generateMetadata` sets the title to `0xf5d8…ad53 · Slipstream` (the pattern of the other pages). An invalid address gets the title `Invalid address · Slipstream`.
- The invalid address view shows the `ErrorState` ("Not a valid address." and "Expected 0x followed by 40 hex characters.") and a second search box below it, as the plan asks.
- The "Mark" column shows the live mid from `allMids`, not the exchange mark price. The app has no mark price feed, and the mid is within a few ticks of it. Before the first mid arrives, the row shows the mark at the time of the API response (`positionValue / |size|`) and the API PnL and ROE.
- The live ROE is the live PnL over the initial margin (`|size| * entry / leverage`). It matches the API `returnOnEquity` within rounding.
- The pure position math (`unrealizedPnl`, `returnOnEquity`, `totalUnrealizedPnl`, `hasNoActivity`) lives in `lib/calc/positions.ts` with tests. The header sum uses `useLiveUnrealizedPnl`, which listens only to the coins of the open positions.
- Unknown addresses report an account value of "0.1" or "0.0", never 0. The "no activity" check therefore uses an account value below 1 USD, no positions, and no fills.
- `0x0000000000000000000000000000000000000001` has one fill: a "Spot Dust Conversion" that the exchange made, with a zero hash. Such system fills do not count as activity (`isSystemFill` in `lib/calc/fillAction.ts`). The address then shows the empty state.
- The plan's header checklist names "total PnL". The PnL panel shows the PnL of the chosen window (Day, Week, Month, All) as a 20 px number above the chart, in the same place as the Arkham reference. The stat grid keeps the four stats from the plan.
- The win rate counts the fills that `userFills` returns (the API sends at most 2,000). For an active trader this covers only the recent history. Orders are grouped by `oid`, as planned.
- `RecentFills` aggregates all loaded fills with `aggregateFills` and shows the 50 most recent orders, not the orders of the last 50 raw fills. This gives a full list of 50 rows for traders who fill one order in many parts.
- Fill rows show the local clock time `HH:mm:ss`. A fill from an earlier day gets the date in front ("Nov 9 14:02:11"), so that an old fill does not look like today. The full date is in the `title` attribute.
- The chart uses an `AreaSeries` with the same colour at the top and the bottom, so the fill is flat (no gradient). The line is green when the last value is 0 or more, and red below 0. Scroll and zoom are off, so the page scrolls normally on touch screens.
- The TradingView attribution logo is off (`attributionLogo: false`). The licence then asks for a link to tradingview.com on the page, so a small "Chart by TradingView" link sits under the chart.
- `components/shared/Price.tsx` did not exist yet (the plan listed it). It now shows a value with a green or red flash on change. It keeps the previous value in state and updates it during render, so no effect runs on each tick.
- `Panel` has a new `titleOnMobile` option. The home page hides panel titles below `lg` because its tab bar shows them. The profile panels show their titles at every width.
- Layout: on mobile, the order is header, stats, positions, PnL chart, recent fills. On desktop, the chart (7/12) and the fills (5/12) sit above the positions table, as in the Arkham reference. The fills panel takes the height of the chart panel on desktop and scrolls inside it. On mobile it is capped at 480 px.
- The positions table has a fixed minimum width of 820 px. On narrow screens it scrolls sideways and the Asset column stays in place. The scroll box is `relative`, because the absolute sr-only caption otherwise escaped it and made the whole page 833 px wide at 375 px.
- The watchlist store keeps one module-level list. It reads localStorage once, writes on every change, and listens to the `storage` event for changes from other tabs. When storage throws, the list still works for the session. The pure parts (`parseWatchlist`, `toggleWatchlist`) live in `lib/watchlist.ts` with tests.
- The "Watching" strip sits above both home panels. When it shows on desktop, the page grows by about 36 px, because the panels keep their fixed height.
- `AddressSearch` now shows "Not a valid address. Expected 0x followed by 40 hex characters." for a bad address, and clears the input after it navigates.
- During the browser check, one hydration warning came up on the invalid address page. It came from the Playwright screenshot, which hides the caret with an inline style before React hydrates. A run without the screenshot step, and a run with `caret: "initial"`, showed no console errors.
- Done-when check (headless Chromium, `pnpm dev -p 3100`): the profile of `0xf5d81a135f756ca16544e53c20fc20643ec3ad53` shows 29 positions. Between two samples 6 s apart, the mark and the unrealized PnL changed in 26 of 29 rows (BTC 73,807.50 / -$1,996 -> 73,800.50 / -$2,124). The header sum changed from -$954.05 to -$1,028. The chart canvas renders at 686 x 220 px. The Day toggle changes the PnL value. 50 fill rows render. Follow, the home strip and Unfollow work. There is no horizontal scroll at 375 px and no console error.
- The CLAUDE.md workflow asks for `/ship-simple`. This phase ran as the implementer step of that workflow, so it did not start the command again.
