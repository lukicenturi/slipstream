# PLAN: Slipstream, a social feed for Hyperliquid perps traders

**Project name:** Slipstream (repo and package name: `slipstream`). Use this name in the app header, page titles, `package.json` and the README.

A read-only "follow the smart money" web app: leaderboard, live trade feed, trader profiles, and a mocked copy-trade sheet. Built as a portfolio piece for Arbital (onchain social trading; React, TypeScript, React Native).

- **Budget:** about 2 days. Hard cutoff after Phase 4. Phase 5 is a bonus.
- **Rule:** read-only. No wallet connection, no order placement, no database.

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

- [ ] "Copy trade" button on position rows and feed cards opens a bottom sheet
- [ ] Sheet: pre-filled asset and side, size slider, leverage slider, estimated margin and liquidation price (pure function, unit-tested)
- [ ] Confirm button labelled "Demo, no order is placed"; pressing it shows a toast, nothing else
- [ ] Unit tests: win rate, liquidation estimate, fill aggregation, formatters
- [ ] Accessibility pass: keyboard navigation, focus states, colour is not the only signal for long/short
- [ ] Performance pass: memoised rows, no re-render of the whole table on every price tick
- [ ] README: GIF, architecture diagram, trade-offs (server-side leaderboard cache, single socket), known limits, "what I'd build next"
- [ ] Deploy to Vercel; test on a real phone
- [ ] Footer disclaimer: unofficial, read-only, not financial advice

**Done when:** live URL works on mobile and the README explains every major decision.

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

> **Slipstream** ([live link], [GitHub]): A read-only social trading feed for Hyperliquid perps, built over a weekend to explore Arbital's problem space. Solo project: I designed the architecture, the typed API layer, the real-time WebSocket feed and the mobile-first UI, using AI coding tools to move fast.

## References

- Info endpoint: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- WebSocket subscriptions: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
- Leaderboard feed notes: https://www.dwellir.com/guides/hyperliquid-vaults-leaderboard
