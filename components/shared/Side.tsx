import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** A side badge with text, so colour is never the only signal. */
export function Side({
  label,
  tone,
  className,
}: {
  label: string;
  tone: "long" | "short";
  className?: string;
}) {
  return (
    <Badge variant={tone} className={cn("h-4 w-11 px-1 text-[10px] leading-none", className)}>
      {label}
    </Badge>
  );
}
