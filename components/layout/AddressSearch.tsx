"use client";

import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { normalizeAddress } from "@/lib/address";
import { cn } from "@/lib/utils";

/**
 * Search for a trader by address. It checks the address, shows an inline
 * error, and opens the profile with a lower-case address.
 */
export function AddressSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim() === "") {
      setError("Enter an address");
      return;
    }
    const address = normalizeAddress(value);
    if (!address) {
      setError("Not a valid address. Expected 0x followed by 40 hex characters.");
      return;
    }
    setError(null);
    setValue("");
    router.push(`/trader/${address}`);
  }

  return (
    <form role="search" onSubmit={onSubmit} className={cn("relative", className)} noValidate>
      <label htmlFor={`${errorId}-input`} className="sr-only">
        Trader address
      </label>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
      />
      <input
        id={`${errorId}-input`}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        placeholder="Search address 0x…"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-8 w-full min-w-0 rounded-md border border-border bg-surface pr-3 pl-8 font-mono text-xs text-foreground transition-colors placeholder:font-sans placeholder:text-faint hover:border-border-strong focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-short"
      />
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="absolute top-full left-0 z-30 mt-1 max-w-[min(20rem,calc(100vw-2rem))] rounded-sm border border-short/40 bg-background px-2 py-1 text-2xs text-short"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
