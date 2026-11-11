import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** A small outline badge with the name of a builder perp exchange ("vntls"). */
export function DexBadge({ dex, className }: { dex: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      title={`Builder perp exchange ${dex}`}
      data-testid="dex-badge"
      className={cn(
        "h-4 px-1 font-mono text-[10px] font-normal tracking-normal text-muted-foreground normal-case",
        className,
      )}
    >
      {dex}
    </Badge>
  );
}
