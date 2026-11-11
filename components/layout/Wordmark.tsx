import { cn } from "cn";

type WordmarkSize = "sm" | "lg";

/** Type size of the whole word. */
const WORD_SIZE: Record<WordmarkSize, string> = {
  // 14 px on mobile, 15 px from sm up. The line stays 20 px, as the old header text.
  sm: "text-base leading-5 sm:text-[15px]",
  // For a future landing page.
  lg: "text-hero",
};

/** The amber bar under "stream": 1.5 px, 2 px under the baseline at 15 px. */
const BAR_SIZE: Record<WordmarkSize, string> = {
  sm: "decoration-[1.5px] underline-offset-2",
  lg: "decoration-[3px] underline-offset-4",
};

interface WordmarkProps {
  size?: WordmarkSize;
  className?: string;
}

/**
 * The Slipstream wordmark as live text: "slip" in the text colour and "stream"
 * in amber, with an amber bar under "stream". The bar is a text underline, so
 * the browser places it from the baseline at every size.
 * The outlined SVG copies are in public/brand/ (scripts/brand/make-wordmark.mjs).
 */
export function Wordmark({ size = "sm", className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-sans font-semibold tracking-[-0.02em] whitespace-nowrap text-foreground",
        WORD_SIZE[size],
        className,
      )}
    >
      slip
      <span className={cn("text-brand underline decoration-brand", BAR_SIZE[size])}>stream</span>
    </span>
  );
}
