import { TRADING_ENABLED } from "@/lib/trading/config";

const HYPERLIQUID_DOCS_URL = "https://hyperliquid.gitbook.io/hyperliquid-docs";

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-1 px-4 py-3 text-2xs text-faint sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:px-6">
        {TRADING_ENABLED ? (
          <p data-testid="footer-disclaimer">
            Slipstream is an unofficial viewer for Hyperliquid public data. It places no mainnet
            orders and gives no financial advice. Testnet trading is enabled in this build.
          </p>
        ) : (
          <p data-testid="footer-disclaimer">
            Slipstream is an unofficial, read-only viewer for Hyperliquid public data. It places no
            orders and gives no financial advice.
          </p>
        )}
        <a
          href={HYPERLIQUID_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Hyperliquid docs<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </footer>
  );
}
