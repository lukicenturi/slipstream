import { HL } from "@/lib/network";

/**
 * Orders go to the main perp exchange, and USDC in a builder exchange
 * cannot margin them. This line says where the USDC is and how to move it.
 */
export function BuilderUsdcNote({ dex, linkClassName }: { dex: string; linkClassName?: string }) {
  return (
    <>
      Your USDC is in <span className="font-mono">{dex}</span>. Transfer it to Perps on{" "}
      <a
        href={HL.appUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName ?? "rounded-sm text-brand underline-offset-2 hover:underline"}
      >
        Hyperliquid<span className="sr-only"> (opens in a new tab)</span>
      </a>{" "}
      to trade here.
    </>
  );
}
