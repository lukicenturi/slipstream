import { NETWORK_URLS, networkHost, TRADING_ENABLED } from "@/lib/trading/config";

import { NetworkSwitchLink } from "./NetworkSwitch";

const HYPERLIQUID_DOCS_URL = "https://hyperliquid.gitbook.io/hyperliquid-docs";

const LINK_CLASS =
  "rounded-sm text-muted-foreground underline underline-offset-2 hover:text-foreground";

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-1 px-4 py-3 text-2xs text-faint sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:px-6">
        <div className="flex flex-col gap-1">
          {TRADING_ENABLED ? (
            <>
              <p data-testid="footer-disclaimer">
                Slipstream is an unofficial viewer for Hyperliquid public data. It places no mainnet
                orders and gives no financial advice. Testnet trading is enabled in this build.
              </p>
              <p data-testid="footer-network">
                This is the Hyperliquid testnet build. Orders use test funds only.{" "}
                <NetworkSwitchLink className={LINK_CLASS}>Switch to Mainnet</NetworkSwitchLink> for
                the read-only app.
              </p>
            </>
          ) : (
            <>
              <p data-testid="footer-disclaimer">
                Slipstream is an unofficial, read-only viewer for Hyperliquid public data. It places
                no orders and gives no financial advice.
              </p>
              <p data-testid="footer-network">
                A testnet build with copy trading is at{" "}
                <NetworkSwitchLink className={LINK_CLASS}>
                  {networkHost(NETWORK_URLS.testnet)}
                </NetworkSwitchLink>
                .
              </p>
            </>
          )}
        </div>
        <a
          href={HYPERLIQUID_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`shrink-0 ${LINK_CLASS}`}
        >
          Hyperliquid docs<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </footer>
  );
}
