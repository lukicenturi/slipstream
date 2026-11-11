import { Badge } from "@/components/ui/badge";

/** A side badge with text, so colour is never the only signal. */
export function Side({ label, tone }: { label: string; tone: "long" | "short" }) {
  return (
    <Badge variant={tone} className="h-4 w-11 px-1 text-[10px] leading-none">
      {label}
    </Badge>
  );
}
