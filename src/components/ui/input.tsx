import * as React from "react";
import { cn } from "@/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-border bg-background/60 px-4 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        invalid && "border-destructive focus-visible:ring-destructive",
        className
      )}
      aria-invalid={invalid}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
