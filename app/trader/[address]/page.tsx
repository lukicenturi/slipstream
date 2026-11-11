import type { Metadata } from "next";
import { Suspense } from "react";

import { AddressSearch } from "@/components/layout/AddressSearch";
import { ErrorState } from "@/components/shared/States";
import { TraderProfile } from "@/components/trader/TraderProfile";
import { Skeleton } from "@/components/ui/skeleton";
import { isAddress } from "@/lib/address";
import { shortAddress } from "@/lib/format";

export async function generateMetadata({
  params,
}: PageProps<"/trader/[address]">): Promise<Metadata> {
  const { address } = await params;
  return {
    title: isAddress(address)
      ? `${shortAddress(address.toLowerCase())} · Slipstream`
      : "Invalid address · Slipstream",
  };
}

/** The trader profile. A thin server page around the client profile. */
export default function TraderPage({ params }: PageProps<"/trader/[address]">) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-3 lg:px-6 lg:py-4">
      {/* The params are request data, so they resolve inside a Suspense boundary. */}
      <Suspense fallback={<ProfileSkeleton />}>
        <TraderRoute params={params} />
      </Suspense>
    </div>
  );
}

async function TraderRoute({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return <InvalidAddress />;
  return <TraderProfile address={address.toLowerCase()} />;
}

function InvalidAddress() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border px-4 pb-8">
      <h1 className="sr-only">Invalid address</h1>
      <ErrorState
        title="Not a valid address."
        description="Expected 0x followed by 40 hex characters."
        className="pb-2"
      />
      <AddressSearch className="w-full max-w-sm" />
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Loading the trader" className="flex flex-col gap-3">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-5 w-72 max-w-full" />
      <Skeleton className="h-[74px] w-full" />
    </div>
  );
}
