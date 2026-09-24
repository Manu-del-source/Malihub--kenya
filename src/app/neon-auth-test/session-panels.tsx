import { prisma } from "@/lib/prisma";
import type { NeonSessionView } from "./session-view";

/**
 * Read-only presentational panels for the Neon Auth POC.
 *
 * `MaliHubIdentityProbe` is the identity-separation check required by the
 * evaluation: it looks the Neon Auth user id up in MaliHub's own `users` table
 * and reports what it finds. It never writes, never provisions, and never links
 * the two identities — reads only, and only when the id could even match
 * (`User.id` is `@db.Uuid`).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 py-2 last:border-0 sm:flex-row sm:items-baseline sm:justify-between">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

export function NeonSessionPanel({ view }: { view: NeonSessionView }) {
  return (
    <section className="glass rounded-xl p-5" data-testid="neon-poc-session-panel">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Neon Auth session state
        </h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            view.authenticated
              ? "bg-emerald-500/15 text-emerald-500"
              : "bg-muted text-muted-foreground"
          }`}
          data-testid="neon-poc-session-state"
        >
          {view.authenticated ? "authenticated" : "unauthenticated"}
        </span>
      </header>

      {view.authenticated ? (
        <dl className="text-sm">
          <Row label="user id (Neon Auth)" value={view.userId ?? "—"} />
          <Row label="email" value={view.email ?? "—"} />
          <Row label="name" value={view.name ?? "—"} />
          <Row
            label="email verified"
            value={view.emailVerified === null ? "unknown" : String(view.emailVerified)}
          />
          <Row label="session id" value={view.sessionId ?? "—"} />
          <Row label="session expires" value={view.expiresAt ?? "—"} />
          <Row label="session created" value={view.createdAt ?? "—"} />
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          No Managed Better Auth session is present for this request. `auth.getSession()` returned
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">{`{ session: null, user: null }`}</code>
          — not an error.
        </p>
      )}
    </section>
  );
}

export async function MaliHubIdentityProbe({ neonUserId }: { neonUserId: string | null }) {
  const isUuid = Boolean(neonUserId && UUID_PATTERN.test(neonUserId));

  let verdict: string;
  let matched = false;

  if (!neonUserId) {
    verdict = "No Neon Auth user to compare.";
  } else if (!isUuid) {
    verdict =
      "Neon Auth user id is not a UUID — it cannot be stored in MaliHub's `users.id` (`@db.Uuid`) without a schema change.";
  } else {
    try {
      const user = await prisma.user.findUnique({
        where: { id: neonUserId },
        select: { id: true, email: true },
      });
      matched = Boolean(user);
      verdict = user
        ? `A MaliHub Prisma user row exists for this id (${user.email}).`
        : "No MaliHub Prisma user row exists for this id — the identities are separate.";
    } catch (error) {
      verdict = `Lookup failed (database unavailable or id rejected): ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  return (
    <section className="glass rounded-xl p-5" data-testid="neon-poc-identity-panel">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Prisma identity separation (read-only)
      </h2>
      <dl className="text-sm">
        <Row label="neon auth user id" value={neonUserId ?? "—"} />
        <Row label="uuid-shaped" value={String(isUuid)} />
        <Row label="prisma users.id match" value={matched ? "found" : "none"} />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">{verdict}</p>
    </section>
  );
}
