import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        primary: "bg-primary/15 text-primary-400",
        cyan: "bg-cyan/15 text-cyan",
        verified: "bg-cyan/15 text-cyan",
        glass: "glass-sm text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge({
  className,
  variant,
  children,
}: {
  className?: string;
  children: React.ReactNode;
} & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, className }))}>{children}</span>;
}
