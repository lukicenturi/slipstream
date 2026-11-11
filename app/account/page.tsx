import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountView } from "@/components/account/AccountView";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Account · Slipstream",
};

/**
 * The account page. A thin server page around the client view: the saved
 * address lives in localStorage and the wallet lives in the browser.
 */
export default function AccountPage() {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <AccountView />
    </Suspense>
  );
}

function AccountSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the account"
      className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-3 lg:px-6 lg:py-4"
    >
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-3 w-64 max-w-full" />
      <Skeleton className="h-[74px] w-full" />
    </div>
  );
}
