import { cn } from "cn"

// Restyled for Slipstream: 2 px radius on the surface hover colour.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-sm bg-surface-hover", className)}
      {...props}
    />
  )
}

export { Skeleton }
