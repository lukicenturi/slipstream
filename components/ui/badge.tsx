import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Restyled for Slipstream: 2 px radius, 1 px border, 11 px uppercase text.
const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-1.5 text-2xs font-medium tracking-wide whitespace-nowrap uppercase [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-brand/40 bg-brand-dim text-brand",
        secondary: "border-border bg-surface text-muted-foreground",
        outline: "border-border text-foreground",
        long: "border-long/40 bg-long-dim text-long",
        short: "border-short/40 bg-short-dim text-short",
        destructive: "border-short/40 bg-short-dim text-short",
        ghost: "border-transparent text-muted-foreground",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
