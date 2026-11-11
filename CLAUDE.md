# Slipstream: project rules

Read `PLAN.md` first. Work on one phase at a time and stop when its "Done when" check passes.

## Workflow

- Always use the `/ship-simple` command to implement any work in this project: every phase, feature, fix and refactor. This is the default and applies even when the prompt does not mention it: invoke `/ship-simple` yourself before writing or changing any code. Do not implement changes outside it.

## Hard rules

- Trading is enabled per build by `NEXT_PUBLIC_TRADING_MODE` (`testnet` or `mainnet`, and it must match the build's network). Mainnet trading was enabled by the user on 2026-11-11, accepting the risk. Every exchange call starts with `assertTradingEnabled`. Safeguards stay in place: a review step before every order, a per-order size cap, a 24 h agent key on mainnet, and a risk acknowledgement. Never ask for or store a user's wallet key; only a generated agent key may be stored, in localStorage.
- The raw leaderboard file is fetched server-side only, trimmed and cached. Never fetch it from the browser.
- The only server-side state is the push subscription store in Cloudflare D1 (push endpoint, network, watched addresses, threshold, optional labels). No accounts and no other user data. The push Worker reads Hyperliquid over REST; the app still uses one shared WebSocket.
- Before writing a schema, `curl` the endpoint, save the response in `fixtures/`, and derive the zod schema from it. Do not guess field names.

## Design

- Before building or changing any UI, view the reference images in `screenshots/` and follow the "Design direction" section of `PLAN.md`.
- Match the references' density, typography and layout. Do not copy their logos, brand names or exact palettes.
- Never ship default shadcn styling. No gradients, no emoji, small radius, 1 px borders, tabular numbers.
- After finishing a screen, compare it against the matching reference and tighten spacing and type until the density is similar.

## Code style

- TypeScript strict. No `any`, no `@ts-ignore`, no non-null assertions without a comment explaining why.
- Validate every external response with zod at the boundary; components only see parsed types.
- API numbers arrive as strings: parse them in the client layer, not in components.
- Business logic (win rate, liquidation estimate, fill aggregation) lives in `lib/calc/` as pure functions with Vitest tests.
- Components are small and presentational; data fetching lives in hooks.
- One shared WebSocket connection via `lib/hyperliquid/ws.ts`. Components never open their own socket.
- Every data view has loading, empty and error states.
- Mobile-first: design at 375 px wide, then scale up.

## Commands

- `pnpm dev` to run locally
- `pnpm lint && pnpm typecheck && pnpm test` must pass before a phase is done

## Commits

- Small commits with conventional messages (`feat:`, `fix:`, `test:`, `docs:`).
