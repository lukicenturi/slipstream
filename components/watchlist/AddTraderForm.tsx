"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { useWatchlist } from "@/hooks/useWatchlist";
import { shortAddress } from "@/lib/format";
import { isLikelyName, parseSearchInput } from "@/lib/names";
import { NamesError, resolveName } from "@/lib/names/client";
import { cn } from "@/lib/utils";

/** The same wording as the header search. */
function lookupMessage(error: unknown, name: string): string {
  if (error instanceof NamesError) {
    if (error.kind === "not_found") return `No address found for ${name}`;
    if (error.kind === "invalid") return "Enter an address, a .eth name or a .hl name.";
  }
  return "Name lookup failed. Try again.";
}

/**
 * Add a trader by address, `.eth` name or `.hl` name. Names resolve on our
 * server (/api/resolve). On success the input clears.
 */
export function AddTraderForm({ className }: { className?: string }) {
  const { add, isFollowing } = useWatchlist();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const id = useId();

  function track(address: string, label: string) {
    setError(null);
    setValue("");
    if (isFollowing(address)) {
      setStatus(`Already tracking ${label}.`);
      return;
    }
    add(address);
    setStatus(`Tracking ${label}.`);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resolving) return;
    setStatus(null);
    const input = parseSearchInput(value);
    switch (input.kind) {
      case "empty":
        setError("Enter an address");
        return;
      case "invalid":
        setError("Enter an address, a .eth name or a .hl name.");
        return;
      case "address":
        track(input.address, shortAddress(input.address));
        return;
      case "ens":
      case "hl": {
        setError(null);
        setResolving(true);
        try {
          const { address } = await resolveName(input.name);
          track(address, input.name);
        } catch (lookupError) {
          setError(lookupMessage(lookupError, input.name));
        } finally {
          setResolving(false);
        }
      }
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      aria-busy={resolving}
      noValidate
      data-testid="watchlist-add-form"
      className={cn("flex flex-col gap-1", className)}
    >
      <label htmlFor={`${id}-input`} className="sr-only">
        Trader address or name to track
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-input`}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
            if (status) setStatus(null);
          }}
          placeholder="Address, name.eth or name.hl"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          // Read-only, not disabled, so the input keeps focus during a lookup.
          readOnly={resolving}
          aria-disabled={resolving ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : status ? `${id}-status` : undefined}
          className={cn(
            "h-8 w-full min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-xs text-foreground transition-colors placeholder:font-sans placeholder:text-faint read-only:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-short",
            isLikelyName(value) ? "font-sans" : "font-mono",
          )}
        />
        <Button type="submit" variant="outline" className="w-[4.5rem]" data-testid="watchlist-add">
          {resolving ? (
            <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" />
          ) : null}
          Track
        </Button>
      </div>
      {resolving ? (
        <span role="status" className="sr-only">
          Looking up {value.trim()}
        </span>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-2xs text-short">
          {error}
        </p>
      ) : null}
      {status ? (
        <p id={`${id}-status`} role="status" className="text-2xs text-muted-foreground">
          {status}
        </p>
      ) : null}
    </form>
  );
}
