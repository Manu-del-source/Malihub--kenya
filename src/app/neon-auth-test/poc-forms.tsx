"use client";

import { useActionState } from "react";
import { neonSignInAction, neonSignUpAction } from "./actions";
import { NEON_POC_IDLE_STATE, type NeonPocFormState } from "./poc-state";

/**
 * Minimal, POC-only UI for the Neon Auth evaluation.
 *
 * Intentionally NOT the MaliHub auth UI (no `AuthCard`, no `LoginForm`, no
 * Google button): this exists to exercise the Managed Better Auth SDK, not to
 * propose a new design. It talks to the POC's own proxy route through Server
 * Actions (`useActionState`), which is the SDK's documented server-side pattern.
 */

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-background/60 px-3 text-sm outline-none " +
  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";

function Feedback({ state }: { state: NeonPocFormState }) {
  if (state.status === "idle" || !state.message) return null;
  const tone = state.status === "error" ? "text-destructive" : "text-emerald-500";
  return (
    <p role="status" className={`text-xs ${tone}`}>
      {state.message}
    </p>
  );
}

export function NeonSignUpForm() {
  const [state, action, pending] = useActionState(neonSignUpAction, NEON_POC_IDLE_STATE);

  return (
    <form action={action} className="flex flex-col gap-3" data-testid="neon-poc-sign-up-form">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Neon Auth — sign up
      </h2>
      <input className={inputClass} name="name" placeholder="Full name (optional)" autoComplete="name" />
      <input
        className={inputClass}
        name="email"
        type="email"
        placeholder="test-account@example.com"
        autoComplete="email"
        required
      />
      <input
        className={inputClass}
        name="password"
        type="password"
        placeholder="Password (min 8 characters)"
        autoComplete="new-password"
        required
      />
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Creating account…" : "Create Neon Auth account"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function NeonSignInForm() {
  const [state, action, pending] = useActionState(neonSignInAction, NEON_POC_IDLE_STATE);

  return (
    <form action={action} className="flex flex-col gap-3" data-testid="neon-poc-sign-in-form">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Neon Auth — sign in
      </h2>
      <input
        className={inputClass}
        name="email"
        type="email"
        placeholder="test-account@example.com"
        autoComplete="email"
        required
      />
      <input
        className={inputClass}
        name="password"
        type="password"
        placeholder="Password"
        autoComplete="current-password"
        required
      />
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-full border border-border text-sm font-medium disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in with Neon Auth"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function NeonSignOutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} data-testid="neon-poc-sign-out-form">
      <button
        type="submit"
        className="h-10 rounded-full border border-border px-5 text-sm font-medium hover:border-primary/50"
      >
        Sign out (Neon Auth)
      </button>
    </form>
  );
}
