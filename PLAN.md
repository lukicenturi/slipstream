# PLAN: Slipstream, a social feed for Hyperliquid perps traders

**Project name:** Slipstream (repo and package name: `slipstream`). Use this name in the app header, page titles, `package.json` and the README.

A read-only "follow the smart money" web app: leaderboard, live trade feed, trader profiles, and a mocked copy-trade sheet. Built as a portfolio piece for Arbital (onchain social trading; React, TypeScript, React Native).

- **Budget:** about 2 days. Hard cutoff after Phase 4. Phase 5 is a bonus.
- **Rule:** production is read-only. Trading exists only on Hyperliquid testnet behind `NEXT_PUBLIC_TRADING_MODE=testnet`. Never create a mainnet exchange client. Never ask for or store a user's wallet key; only a generated agent key may be stored, in localStorage, for testnet. The only server-side state is the push subscription store in Cloudflare D1 (push endpoint, network, watched addresses, threshold, optional labels). No accounts and no other user data.

## Stack

- Next.js (App Router) + TypeScript strict, deployed on Vercel
- TanStack Query for REST; a small custom WebSocket hook for live data
- Tailwind + shadcn/ui, dark theme, mobile-first
- lightweight-charts (TradingView) for the PnL chart
- zod to validate every API response at the boundary
- Vitest for unit tests on pure functions

## Data sources

| Need | Source | Notes |
|---|---|---|
| Leaderboard | `GET https://stats-data.hyperliquid.xyz/Mainnet/leaderboard` | Undocumented, about 40 MB. Server-side only. |
| Positions | `POST https://api.hyperliquid.xyz/info` with `{"type":"clearinghouseState","user":"0x..."}` | Per wallet address |
| Trade history | Same endpoint, `{"type":"userFills","user":"0x..."}` | Max 2,000 fills per call |
| PnL history | Same endpoint, `{"type":"portfolio","user":"0x..."}` | Works for any address |
| Live prices | `wss://api.hyperliquid.xyz/ws`, subscription `{"type":"allMids"}` | Client-side |
| Live fills | Same socket, subscription `{"type":"userFills","user":"0x..."}` | Client-side |

WebSocket message format: `{"method":"subscribe","subscription":{...}}` and the same with `"unsubscribe"`.

### Constraints to respect

1. **Leaderboard is huge and undocumented.** Fetch it in a Next.js route handler, keep only the top 100 by monthly PnL, cache the trimmed result for 10–15 minutes. Never send the raw file to the browser. Because it is undocumented, fail gracefully if its shape changes.
2. **Verify shapes before coding.** `curl` each endpoint first, save a sample response under `fixtures/`, and write the zod schemas from the real data. Do not guess field names.
3. **WebSocket snapshots.** The first message after subscribing is tagged `isSnapshot: true`. Use it to seed state; do not render it as new feed items.
4. **One shared socket.** All subscriptions go through a single connection with reference counting.
5. **Numbers arrive as strings.** Parse at the boundary; never do float math on raw strings in components.

## Design direction

A dense trading terminal with consumer-grade mobile polish. It must not look like default shadcn or a generic AI-generated dashboard.

### Reference screenshots

Reference images live in `screenshots/`. **Look at every image in that folder before writing any UI**, and match their density, typography and layout. File names say which screen each one informs. Expected set (some may be missing; use what is there):

| Reference | Informs |
|---|---|
| Arbital main trading screen or landing page | Overall tone and colour |
| Hyperliquid leaderboard page | Leaderboard table |
| Hyperliquid trade page, positions panel | Open positions rows |
| Axiom or GMGN live trades view | Live feed rows |
| Arkham or HypurrScan wallet page | Trader profile header and stats |
| Farcaster home feed | Feed item structure (avatar, name, action, time) |
| Family wallet send/swap sheet | Copy-trade bottom sheet |
| Robinhood or Phantom order ticket | Amount input and single confirm button |

Borrow layout, density and interaction patterns only. Do not copy logos, brand names, illustrations or exact colour palettes; pick our own accent colour.

### Style rules

- Tabular or monospace numbers everywhere (Geist Mono or JetBrains Mono) so prices do not jiggle as they tick
- Corner radius 2–6 px; 1 px borders instead of shadows; row height 32–40 px
- Near-black background, one accent colour, plus green and red for long and short (always paired with a label or icon)
- No gradients, no emoji, no glassmorphism
- Rows and dividers instead of a card around everything
- Motion with meaning only: brief flash on price change, new feed items slide in
- Restyle shadcn components to these rules; never ship them with default styling

## Phase 1: foundation (2–3 h)

- [x] Review all images in `screenshots/` and write the design tokens (colours, type scale, spacing, radius) into the Tailwind theme before building any screen
- [x] Scaffold Next.js with TypeScript strict, ESLint, Prettier, Tailwind, shadcn/ui, dark theme
- [x] Capture sample responses for all five data sources into `fixtures/`
- [x] `lib/hyperliquid/schemas.ts`: zod schemas and inferred types
- [x] `lib/hyperliquid/client.ts`: `getLeaderboard`, `getClearinghouseState`, `getUserFills`, `getPortfolio`
- [x] `app/api/leaderboard/route.ts`: fetch, trim to top 100, cache (revalidate 600–900 s)
- [x] `lib/hyperliquid/ws.ts` + `useHyperliquidWs` hook: shared connection, subscribe/unsubscribe by key, reconnect with exponential backoff, resubscribe after reconnect
- [x] `lib/format.ts`: USD, percent, size, short address, relative time

**Done when:** a throwaway page prints the top 10 traders and a live BTC mid price.

## Phase 2: leaderboard and feed (3–4 h)

- [x] `/` layout: leaderboard and live feed side by side on desktop, tabs on mobile
- [x] Leaderboard table: rank, short address (or display name), account value, PnL, ROI; day / week / month / all-time tabs; sortable
- [x] Live feed: subscribe to `userFills` for the top 10–20 traders; cards like "0xab…cd opened 5x long ETH, $240k, 12s ago"
- [x] Aggregate partial fills of the same order into one card
- [x] Cap the feed at about 100 items; new items animate in
- [x] Skeleton loaders, empty state, error state with retry, connection status indicator

**Done when:** the feed updates live with no duplicates after a forced reconnect.

## Phase 3: trader profile (3–4 h)

Route: `/trader/[address]`

- [x] Header: address with copy button, account value, total PnL, win rate, link to the Hyperliquid explorer
- [x] Win rate computed from `closedPnl` on fills (pure function, unit-tested)
- [x] Open positions table: asset, side, size, leverage, entry, mark, unrealized PnL (live from `allMids`), liquidation price
- [x] PnL chart with day / week / month / all-time toggle
- [x] Recent fills list
- [x] Address search in the header with validation (0x + 40 hex chars) and a clear error for invalid or empty accounts
- [x] Follow button and a watchlist stored in localStorage (wrapped in try/catch)

**Done when:** pasting any active address shows positions whose PnL ticks with price.

## Phase 4: copy-trade sheet and polish (2–3 h)

- [x] "Copy trade" button on position rows and feed cards opens a bottom sheet
- [x] Sheet: pre-filled asset and side, size slider, leverage slider, estimated margin and liquidation price (pure function, unit-tested)
- [x] Confirm button labelled "Demo, no order is placed"; pressing it shows a toast, nothing else
- [x] Unit tests: win rate, liquidation estimate, fill aggregation, formatters
- [x] Accessibility pass: keyboard navigation, focus states, colour is not the only signal for long/short
- [x] Performance pass: memoised rows, no re-render of the whole table on every price tick
- [x] README: GIF, architecture diagram, trade-offs (server-side leaderboard cache, single socket), known limits, "what I'd build next"
- [x] Deploy to Vercel; test on a real phone (deployed to https://slipstream-alpha.vercel.app and checked at 375 px in headless Chromium; a physical phone test is still open, see DECISIONS.md)
- [x] Footer disclaimer: unofficial, read-only, not financial advice

**Done when:** live URL works on mobile and the README explains every major decision.

## Phase 4b: testnet trading and asset icons

The user relaxed the read-only rule for testnet only (2026-11-11, see DECISIONS.md). Production stays read-only.

- [x] `lib/trading/config.ts`: trading mode from `NEXT_PUBLIC_TRADING_MODE`, a tested guard that throws unless the mode is `testnet`
- [x] Testnet info reads: `getMeta`, `getAllMidsOnce`, `getClearinghouseState` with a base URL; testnet fixtures and a meta schema test
- [x] Pure order logic in `lib/trading/order.ts`: asset lookup, price and size rounding, IOC order, status summary, leverage update rule (tested)
- [x] Agent key in `lib/trading/agent.ts`: generate, store per owner on testnet, parse with zod, forget (tested)
- [x] `lib/trading/exchange.ts`: approveAgent, updateLeverage and IOC order through `HttpTransport({ isTestnet: true })` only; error mapping (tested)
- [x] wagmi (injected, optional WalletConnect), header wallet button, `useTradingSession`
- [x] Sheet in testnet mode: Testnet badge, 3 steps (wallet, agent, order), testnet mid, balance, disabled reasons, result row, forget agent
- [x] Asset icons with a monogram fallback in the feed, positions, fills and the sheet
- [x] README, DECISIONS and footer updated
- [ ] A real fill on testnet with a funded wallet (manual steps in the README)

**Done when:** `pnpm lint && pnpm typecheck && pnpm test` pass, `pnpm build` passes with and without the flag, and the headless browser checks pass in both modes.

## Phase 4c: watchlist and alerts

In-tab alerts fire while a Slipstream tab is open. Phase 5a adds Web Push for the time without a tab (see DECISIONS.md).

- [x] `lib/alerts.ts` and `lib/notifications.ts`: settings, notices, `shouldNotify`, `noticeText`, `collapseBurst` (tested)
- [x] Stores for alert settings and notices in localStorage (zod, try/catch, 50 notices); the `slipstream.watchlist` format stays
- [x] One global `WatchlistTracker` on the shared socket; snapshot items never notify
- [x] Star toggle on leaderboard rows and feed rows; the profile keeps "Follow"
- [x] Header: Watchlist link with a count, notification bell with unread list and settings (toasts, browser notifications, minimum size)
- [x] Toasts with burst collapsing; browser notifications only when permitted and the tab is hidden
- [x] `/watchlist` page: add by address, `.eth` or `.hl`; account value, live uPnL, positions, last trade, alert switch, remove; loading, empty and error states
- [x] README and DECISIONS updated

**Done when:** `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build` pass, and the headless browser checks (stars, watchlist page, live notice, browser notification stub, 375 px) pass.

## Phase 4d: navigation

- [x] `lib/nav.ts`: nav items, `activeNavKey`, `parseHomeView`, `navCountBadge` (tested)
- [x] Desktop header nav (Leaderboard, Live, Watchlist) with an active state and the watchlist count
- [x] Mobile bottom tab bar (56 px plus the safe-area inset) with icons, labels, an active state and the watchlist badge
- [x] Home view from the URL (`/` and `/?view=live`); in-page tabs removed; both panels stay mounted
- [x] Suspense boundaries with fallbacks for every component that reads the URL; `pnpm build` prerenders as before
- [x] Space for the bar below `lg` (body padding, `viewport-fit=cover`); the sheet and the toasts render above it
- [x] README and DECISIONS updated

**Done when:** `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build` pass, and the headless browser checks at 1280 px and 375 px (active states, URL, mounted panels, nothing under the bar, sheet above the bar, keyboard) pass.

## Phase 4e: deployments and network switch

- [x] `lib/trading/config.ts`: `NETWORK`, `NETWORK_URLS` from `NEXT_PUBLIC_MAINNET_URL` / `NEXT_PUBLIC_TESTNET_URL` with defaults, `otherNetwork`, `networkSwitchTarget` (tested)
- [x] Header pill (`MAINNET` muted / `TESTNET` amber, `MN` / `TN` below `sm`) that links to the other host and keeps the path; Suspense with a fallback
- [x] Footer line with the switch link in both builds
- [x] Header fits on one line at 375 px in both builds
- [x] README (live links, GitHub, Deployments, environment), DECISIONS and this checklist updated

**Done when:** `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build` (flag unset and `testnet`) pass, and the headless browser checks at 375 px (pill text, links with carry-over, footer, one-line header) pass in both modes.

## Phase 4f: desktop live view and account

- [x] `lib/nav.ts`: `/?view=live` marks `Live` at every width; `Account` (`/account`) is the fourth nav item (tested)
- [x] Desktop `/?view=live`: the feed spans the full width as a dense table (Time, Trader, Action, Asset, Size @ Price, Notional, Closed PnL, actions); the leaderboard is hidden but stays mounted; `/` keeps the split
- [x] `MidsSourceProvider`: `useMid` and the live PnL read the nearest mids store (mainnet by default); testnet prices come from REST polling, not a second socket
- [x] `/account`: the connected wallet's testnet balance, positions and fills (testnet build, lazy chunk, reads only), and a saved "My address" mainnet profile in both builds (`slipstream.myAddress`, tested)
- [x] Wallet popover: "USDC available", "Account value" and a "My account" link
- [x] Four bottom tabs fit at 375 px; README, DECISIONS and this checklist updated

**Done when:** `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build` (flag unset and `testnet`) pass, and the headless browser checks at 1280 px and 375 px (live table, kept feed items, account page, saved address, testnet account with a fake wallet, no exchange request) pass in both modes.

## Phase 4g: one network per host

- [x] `lib/network.ts`: `NETWORK` from `NEXT_PUBLIC_NETWORK` or `NEXT_PUBLIC_TRADING_MODE`, `ENDPOINTS`, `HL`, `explorerAddressUrl` (tested); `TRADING_ENABLED` is `NETWORK === "testnet"`
- [x] The info URL, the socket URL, the leaderboard file (cache key with the network) and every explorer link read `HL`
- [x] Testnet-only REST hooks and the mids context removed; the account page, the sheet and the wallet popover share the profile queries and the shared socket
- [x] "Mark" everywhere, "Open on Mainnet", "My address" in both builds, Testnet in the subtitles and the home `h1`
- [x] Regression tests: exported URLs equal `HL` in 4 environments; no endpoint literal outside `lib/network.ts` and the exchange host pin
- [x] README, DECISIONS and this checklist updated

**Done when:** `pnpm lint && pnpm typecheck && pnpm test` pass, `pnpm build` passes with no variable, `NEXT_PUBLIC_TRADING_MODE=testnet` and `NEXT_PUBLIC_NETWORK=testnet`, and the headless browser checks show only mainnet hosts without a variable and only testnet hosts (plus icons) with the testnet flag.

## Phase 5a: push alerts

Alerts reach the user when no Slipstream tab is open. A Cloudflare Worker (`workers/push/`) with a D1 store polls the tracked addresses once a minute and sends Web Push messages; the app's service worker shows them. Free tiers only.

- [x] Worker package `slipstream-push-worker`: HTTP API (`/health`, `/vapid-public-key`, `POST`/`DELETE /subscriptions`, `/subscriptions/test`, `/tick`), zod at every boundary, CORS allowlist, 64 KB body limit
- [x] D1 schema (subscriptions, watches, cursors, deliveries); deliveries pruned after 2 days
- [x] Watcher on a one-minute cron: `userFillsByTime` cursor that starts 2 minutes back (never notifies history), boundary de-dupe by tid, grouping by `oid`, threshold, system-fill filter, request budget for Workers Free, failure pruning (404/410 at once, other errors at 10)
- [x] Pure watcher logic with Vitest tests; root `pnpm lint`, `pnpm typecheck` and `pnpm test` cover the Worker
- [x] Deployed with the D1 database, the migration and four secrets
- [x] App: `public/sw.js`, manifest and icons, `lib/push.ts` (tested), `usePushAlerts`, `PushSync`, "Push alerts" switch with "Send test"
- [x] In-tab and push notifications share the tag `network:user:oid`
- [x] README, DECISIONS and this checklist updated

**Done when:** Worker tests and curl checks (including two `/tick` runs against a fake subscription) pass, `pnpm lint && pnpm typecheck && pnpm test` pass, `pnpm build` passes in both modes, and the headless browser checks (manifest, icons, service worker, switch states, 375 px) pass.

## Phase 5 (bonus): Expo app (4–6 h)

Only if Phases 1–4 are solid.

- [ ] Move `lib/hyperliquid` and hooks into a shared package (monorepo with pnpm workspaces)
- [ ] Expo app with two screens: feed and trader profile
- [ ] Reuse the same client, schemas and WebSocket hook
- [ ] Record a short screen capture for the README

## Suggested structure

```
app/
  page.tsx                    leaderboard + feed
  trader/[address]/page.tsx   profile
  api/leaderboard/route.ts    trimmed, cached leaderboard
components/
  leaderboard/  feed/  trader/  copy-trade/  ui/
lib/
  hyperliquid/  client.ts  schemas.ts  ws.ts
  calc/         winRate.ts  liquidation.ts  aggregateFills.ts
  format.ts
hooks/
  useHyperliquidWs.ts  useWatchlist.ts
fixtures/                     sample API responses
screenshots/                  design reference images (read-only)
```

## Working method

- Always implement through the `/ship-simple` command, for every phase and every change.
- One phase per Claude Code session. Review the diff and commit after each phase.
- Read every file before sharing the link. Be ready to explain any decision in your own words.

## Note for the recruiter

> **Slipstream** ([live, read-only](https://slipstream-hl.vercel.app), [testnet with copy trading](https://slipstream-testnet.vercel.app), [GitHub](https://github.com/lukicenturi/slipstream)): A read-only social trading feed for Hyperliquid perps, with a separate testnet build for copy trading, built over a weekend to explore Arbital's problem space. Solo project: I designed the architecture, the typed API layer, the real-time WebSocket feed and the mobile-first UI, using AI coding tools to move fast.

## References

- Info endpoint: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- WebSocket subscriptions: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
- Leaderboard feed notes: https://www.dwellir.com/guides/hyperliquid-vaults-leaderboard
