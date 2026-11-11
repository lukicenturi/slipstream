"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
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

export interface ResolvedInput {
  /** Lower-case address. */
  address: string;
  /** The name the user typed, or undefined for an address. */
  name: string | undefined;
  /** The name, or the short address: for status texts. */
  label: string;
}

/**
 * An address, `.eth` name or `.hl` name input with a submit button. Names
 * resolve on our server (/api/resolve). On success the input clears and
 * `onResolved` runs; a string it returns shows as the status line.
 * The watchlist form and the account page use it.
 */
export function AddressNameForm({
  onResolved,
  inputLabel,
  submitLabel,
  placeholder = "Address, name.eth or name.hl",
  className,
  formTestId,
  submitTestId,
  submitClassName,
  autoFocus = false,
  children,
}: {
  onResolved: (input: ResolvedInput) => string | null;
  /** The visually hidden label of the input. */
  inputLabel: string;
  submitLabel: string;
  placeholder?: string;
  className?: string;
  formTestId?: string;
  submitTestId?: string;
  submitClassName?: string;
  autoFocus?: boolean;
  /** Extra buttons after the submit button (for example "Cancel"). */
  children?: ReactNode;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const id = useId();

  function done(input: ResolvedInput) {
    setError(null);
    setValue("");
    setStatus(onResolved(input));
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
        done({ address: input.address, name: undefined, label: shortAddress(input.address) });
        return;
      case "ens":
      case "hl": {
        setError(null);
        setResolving(true);
        try {
          const { address } = await resolveName(input.name);
          done({ address: address.toLowerCase(), name: input.name, label: input.name });
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
      data-testid={formTestId}
      className={cn("flex flex-col gap-1", className)}
    >
      <label htmlFor={`${id}-input`} className="sr-only">
        {inputLabel}
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
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          // Only after a user action ("Change"), never on page load.
          autoFocus={autoFocus}
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
        <Button
          type="submit"
          variant="outline"
          className={cn("w-[4.5rem]", submitClassName)}
          data-testid={submitTestId}
        >
          {resolving ? (
            <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" />
          ) : null}
          {submitLabel}
        </Button>
        {children}
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
