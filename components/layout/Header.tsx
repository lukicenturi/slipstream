import Link from "next/link";

import { AddressSearch } from "./AddressSearch";
import { ConnectionStatus } from "./ConnectionStatus";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background">
      <div className="mx-auto flex h-12 w-full max-w-[1440px] items-center gap-3 px-4 lg:gap-6 lg:px-6">
        <Link href="/" className="shrink-0 text-base font-semibold tracking-wide text-foreground">
          Slipstream
        </Link>
        <AddressSearch className="min-w-0 flex-1 lg:max-w-sm" />
        <ConnectionStatus className="ml-auto shrink-0" />
      </div>
    </header>
  );
}
