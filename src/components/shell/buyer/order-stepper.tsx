import { Check, Circle } from "lucide-react";
import { cn } from "@/utils";
import type { OrderProgress } from "@/lib/order-progress";

function shortDate(date: Date) {
  return date.toLocaleDateString("en-KE", { month: "short", day: "numeric" });
}

/** Full stepper for the order detail page. */
export function OrderStepper({ progress }: { progress: OrderProgress }) {
  if (progress.kind === "closed") return null;
  const { steps, currentIndex } = progress;

  return (
    <ol className="flex items-start" aria-label="Order progress">
      {steps.map((step, i) => {
        const current = i === currentIndex && !step.done;
        return (
          <li
            key={step.key}
            className="relative flex-1 text-center"
            aria-current={current ? "step" : undefined}
          >
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-4 h-0.5 w-full",
                  step.done || current ? "bg-primary-400" : "bg-border"
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 mx-auto flex h-8 w-8 items-center justify-center rounded-full border-2",
                step.done
                  ? "border-primary-400 bg-primary-400 text-background"
                  : current
                    ? "border-primary-400 bg-card text-primary-400"
                    : "border-border bg-card text-muted-foreground"
              )}
            >
              {step.done ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Circle className="h-3 w-3" aria-hidden />
              )}
            </span>
            <p className="mt-2 text-xs font-medium">{step.label}</p>
            <p className="min-h-4 text-[11px] text-muted-foreground">
              {step.at ? shortDate(step.at) : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Slim segmented bar for the orders list. */
export function OrderProgressBar({ progress }: { progress: OrderProgress }) {
  if (progress.kind === "closed") return null;
  return (
    <div className="flex gap-1" role="img" aria-label="Order progress">
      {progress.steps.map((step) => (
        <span
          key={step.key}
          className={cn("h-1 flex-1 rounded-full", step.done ? "bg-primary-400" : "bg-border")}
        />
      ))}
    </div>
  );
}
