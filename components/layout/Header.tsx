import Link from "next/link";
import { Suspense } from "react";

import { NotificationBell } from "@/components/notifications/NotificationBell";
import { LazyWalletButton } from "@/components/trading/lazy";
import { TRADING_ENABLED } from "@/lib/trading/config";

import { AddressSearch } from "./AddressSearch";
import { ConnectionStatus } from "./ConnectionStatus";
import { HeaderNav, HeaderNavLinks } from "./HeaderNav";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background">
      <div className="mx-auto flex h-12 w-full max-w-[1440px] items-center gap-2 px-4 sm:gap-3 lg:gap-6 lg:px-6">
        <Link href="/" className="shrink-0 text-base font-semibold tracking-wide text-foreground">
          Slipstream
        </Link>
        {/* The nav reads the URL, so it needs a Suspense boundary (cacheComponents). */}
        <Suspense fallback={<HeaderNavLinks active={null} />}>
          <HeaderNav />
        </Suspense>
        <AddressSearch className="min-w-0 flex-1 lg:max-w-sm" />
        <ConnectionStatus className="ml-auto shrink-0" compactOnMobile />
        <NotificationBell />
        {TRADING_ENABLED ? <LazyWalletButton /> : null}
      </div>
    </header>
  );
}
