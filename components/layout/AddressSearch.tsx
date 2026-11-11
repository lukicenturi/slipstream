"use client";

import { LoaderCircleIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isLikelyName, parseSearchInput } from "@/lib/names";
import { NamesError, resolveName } from "@/lib/names/client";
import { WALLET_ENABLED } from "@/lib/trading/config";
import { cn } from "@/lib/utils";

// At 375 px the input has about 107 px of text room without the wallet button. Every build
// now has the wallet button, so the text room is about 75 px: a short word must do there.
// The label "Trader address or name" still names the input for screen readers.
const NARROW_PLACEHOLDER = WALLET_ENABLED ? "Search" : "Address, .eth or .hl";

function lookupMessage(error: unknown, name: string): string {
  if (error instanceof NamesError) {
    if (error.kind === "not_found") return `No address found for ${name}`;
    if (error.kind === "invalid") return "Enter an address, a .eth name or a .hl name.";
  }
  return "Name lookup failed. Try again.";
}

/**
 * Search for a trader by address, `.eth` name or `.hl` name. A name is
 * resolved on our server (/api/resolve). The search shows an inline error,
 * and opens the profile with a lower-case address.
 */
export function AddressSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const errorId = useId();
  // The full placeholder does not fit the header input at 375 px.
  const wide = useMediaQuery("(min-width: 640px)");

  function open(address: string) {
    setError(null);
    setValue("");
    router.push(`/trader/${address}`);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resolving) return;
    const input = parseSearchInput(value);
    switch (input.kind) {
      case "empty":
        setError("Enter an address");
        return;
      case "invalid":
        setError("Enter an address, a .eth name or a .hl name.");
        return;
      case "address":
        open(input.address);
        return;
      case "ens":
      case "hl": {
        setError(null);
        setResolving(true);
        try {
          const { address } = await resolveName(input.name);
          open(address);
        } catch (lookupError) {
          setError(lookupMessage(lookupError, input.name));
        } finally {
          setResolving(false);
        }
      }
    }
  }

  const Icon = resolving ? LoaderCircleIcon : SearchIcon;

  return (
    <form
      role="search"
      onSubmit={(event) => void onSubmit(event)}
      className={cn("relative", className)}
      aria-busy={resolving}
      noValidate
    >
      <label htmlFor={`${errorId}-input`} className="sr-only">
        Trader address or name
      </label>
      <Icon
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint",
          resolving && "motion-safe:animate-spin",
        )}
      />
      <input
        id={`${errorId}-input`}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        placeholder={wide ? "Search address, name.eth or name.hl" : NARROW_PLACEHOLDER}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        // Read-only, not disabled: a disabled input loses focus, and the
        // user could not press Enter again after an error.
        readOnly={resolving}
        aria-disabled={resolving ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "h-8 w-full min-w-0 rounded-md border border-border bg-surface pr-3 pl-8 text-xs text-foreground transition-colors placeholder:font-sans placeholder:text-faint read-only:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-short",
          // Addresses use the mono font, names the sans font, as in the tables.
          isLikelyName(value) ? "font-sans" : "font-mono",
        )}
      />
      {resolving ? (
        <span role="status" className="sr-only">
          Looking up {value.trim()}
        </span>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="absolute top-full left-0 z-30 mt-1 max-w-[min(20rem,calc(100vw-2rem))] rounded-sm border border-short/40 bg-background px-2 py-1 text-2xs break-words text-short"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
