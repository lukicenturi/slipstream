"use client";

import { useEffect, useRef, useState } from "react";

import { iconSymbol, iconUrl, monogram } from "@/lib/assets";
import { cn } from "@/lib/utils";

// Symbols whose image failed once. A re-render or a new row does not retry them.
const failedSymbols = new Set<string>();

const SIZE_CLASS = { 16: "size-4", 20: "size-5", 24: "size-6" } as const;

/**
 * A round coin icon next to a coin name (decorative: the name sits next to
 * it). Coins without an icon, and images that fail to load, show a
 * 2-letter monogram in the same box, so the row height never changes.
 */
export function AssetIcon({
  coin,
  size = 16,
  className,
}: {
  coin: string;
  size?: 16 | 20 | 24;
  className?: string;
}) {
  const symbol = iconSymbol(coin);
  const [failed, setFailed] = useState(() => symbol === null || failedSymbols.has(symbol));
  const imgRef = useRef<HTMLImageElement>(null);

  const markFailed = () => {
    if (symbol) failedSymbols.add(symbol);
    setFailed(true);
  };

  // An image can fail before React attaches onError (during hydration).
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) markFailed();
    // Runs once per symbol; markFailed only reads the symbol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const box = cn("inline-block shrink-0 rounded-full", SIZE_CLASS[size], className);

  if (failed || symbol === null) {
    return (
      <span
        aria-hidden="true"
        data-testid="asset-icon"
        data-state="fallback"
        className={cn(
          box,
          "inline-flex items-center justify-center border bg-surface font-mono text-[9px] leading-none text-muted-foreground uppercase",
          size === 24 && "text-[10px]",
        )}
      >
        {monogram(coin)}
      </span>
    );
  }

  return (
    // Remote SVGs at 16 to 24 px; next/image adds nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={iconUrl(symbol)}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      data-testid="asset-icon"
      data-state="image"
      onError={markFailed}
      className={cn(box, "bg-surface object-cover")}
    />
  );
}
