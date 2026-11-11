/** Placeholder home page. Phase 2 adds the leaderboard and the live feed. */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-2 px-4 py-6 md:px-6">
      <h1 className="text-xl font-semibold">Slipstream</h1>
      <p className="text-sm text-muted-foreground">
        A read-only live feed of Hyperliquid perps traders.
      </p>
    </main>
  );
}
