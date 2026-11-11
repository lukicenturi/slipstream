"use client";

import { useState } from "react";

import { AddressNameForm, type ResolvedInput } from "@/components/shared/AddressNameForm";
import { TraderProfile } from "@/components/trader/TraderProfile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/useHydrated";
import { useMyAddress } from "@/hooks/useMyAddress";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "My address": the user saves an address or name once (in this browser
 * only), and the section shows that profile on the network of this build.
 * It works in both builds. The value lives in localStorage, so the server render and
 * the first client render show a skeleton.
 */
export function MyAddressSection({ title }: { title: string }) {
  const hydrated = useHydrated();
  const { myAddress, save, forget } = useMyAddress();
  const [editing, setEditing] = useState(false);

  function onResolved({ address, name }: ResolvedInput): null {
    save(address, name);
    setEditing(false);
    return null;
  }

  let body: React.ReactNode;
  if (!hydrated) {
    body = (
      <div role="status" aria-label="Loading your address" className="rounded-lg border px-3 py-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-2 h-8 w-full max-w-md" />
      </div>
    );
  } else if (!myAddress || editing) {
    body = (
      <div
        className="flex flex-col gap-2 rounded-lg border px-3 py-3"
        data-testid="my-address-form"
      >
        <p className="text-xs text-foreground">Your address or name</p>
        <AddressNameForm
          onResolved={onResolved}
          inputLabel="Your address or name"
          submitLabel="Save"
          className="w-full max-w-md"
          submitTestId="my-address-save"
          autoFocus={editing}
        >
          {editing ? (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          ) : null}
        </AddressNameForm>
        <p className="text-2xs text-faint">
          Slipstream stores it only in this browser. Enter an address, a .eth name or a .hl name.
        </p>
      </div>
    );
  } else {
    const isName = myAddress.label !== undefined;
    body = (
      <div className="flex flex-col gap-4">
        <div
          data-testid="my-address-bar"
          data-address={myAddress.address}
          className="flex h-10 items-center gap-2 rounded-lg border px-3"
        >
          <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            Saved
          </span>
          <span
            title={myAddress.address}
            className={cn(
              "min-w-0 truncate text-xs text-foreground",
              isName ? "font-medium" : "font-mono",
            )}
          >
            {myAddress.label ?? shortAddress(myAddress.address)}
          </span>
          {isName ? (
            <span className="hidden font-mono text-2xs text-faint sm:inline">
              {shortAddress(myAddress.address)}
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setEditing(true)}
              data-testid="my-address-change"
            >
              Change
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={forget}
              data-testid="my-address-forget"
            >
              Forget
            </Button>
          </span>
        </div>
        <TraderProfile address={myAddress.address} />
      </div>
    );
  }

  return (
    <section
      aria-labelledby="my-address-title"
      data-testid="my-address"
      className="flex flex-col gap-3"
    >
      <h2 id="my-address-title" className="text-sm font-semibold text-foreground">
        {title}
      </h2>
      {body}
    </section>
  );
}
