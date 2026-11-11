import { memo, useMemo } from "react";

import { BLOCKIE_GRID, blockieData, blockieRuns } from "@/lib/blockies";
import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  16: "size-4",
  20: "size-5",
  24: "size-6",
  32: "size-8",
  40: "size-10",
} as const;

export type BlockieSize = keyof typeof SIZE_CLASS;

/**
 * The blockie identicon of an address, as an inline SVG (decorative: the
 * address or name sits next to it). The seed is the lower-case address, as in
 * wallets. The 1 px border is an overlay, so the picture keeps its full size
 * and whole-pixel cells.
 */
export const Blockie = memo(function Blockie({
  address,
  size = 16,
  className,
}: {
  address: string;
  size?: BlockieSize;
  className?: string;
}) {
  const seed = address.toLowerCase();
  const { data, runs } = useMemo(() => {
    const parsed = blockieData(seed);
    return { data: parsed, runs: blockieRuns(parsed.cells) };
  }, [seed]);

  return (
    <span
      aria-hidden="true"
      data-testid="blockie"
      data-seed={seed}
      className={cn(
        "relative inline-block shrink-0 overflow-hidden bg-surface",
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border",
        size <= 24 ? "rounded-sm" : "rounded-md",
        SIZE_CLASS[size],
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${BLOCKIE_GRID} ${BLOCKIE_GRID}`}
        shapeRendering="crispEdges"
        focusable="false"
        className="block size-full"
      >
        <rect width={BLOCKIE_GRID} height={BLOCKIE_GRID} fill={data.bgColor} />
        {runs.map((run) => (
          <rect
            key={`${run.y}-${run.x}`}
            x={run.x}
            y={run.y}
            width={run.width}
            height={1}
            fill={run.value === 1 ? data.color : data.spotColor}
          />
        ))}
      </svg>
    </span>
  );
});
