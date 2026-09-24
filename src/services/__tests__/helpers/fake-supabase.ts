/**
 * In-memory fake of the Supabase boundary for auth tests.
 *
 * A single "Supabase world" holds the user records (id → app_metadata, the
 * server-side claim cache) that BOTH the per-request session client and the
 * service-role Admin client see — exactly like the real thing, where
 * `admin.updateUserById` mutates the same user record that a later
 * `getUser()`/`refreshSession()` returns.
 *
 * The fakes record every boundary crossing in `events` (ordered), so tests
 * can pin the exact call sequence:
 *
 *   session:sign-in → neon (via prisma fake) → admin:get-user-by-id →
 *   admin:update-user-by-id → session:refresh
 *
 * Failure injection:
 *   world.sessionBehavior = { signInWithPasswordError, refreshError, … }
 *   world.adminBehavior   = { getUserByIdError, updateUserByIdError, … }
 *   world.serviceRoleKey  = undefined  → createServiceRoleClient() throws
 */

export type FakeSupabaseUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
  identities?: unknown[];
};

export type SessionBehavior = {
  signInWithPasswordError?: unknown;
  signInWithPasswordUser?: FakeSupabaseUser | null;
  signInWithPasswordCalls?: number;
  getUser?: FakeSupabaseUser | null;
  refreshError?: unknown;
  refreshThrow?: Error;
  refreshCalls?: number;
  signOutError?: unknown;
  signOutCalls?: number;
  exchangeCodeForSessionError?: unknown;
  exchangeCodeForSessionUser?: FakeSupabaseUser | null;
};

export type AdminBehavior = {
  getUserByIdError?: unknown;
  updateUserByIdError?: unknown;
  /** Returns a user with a DIFFERENT id than requested (validation tripwire). */
  updateUserByIdWrongUser?: boolean;
  updateUserByIdCalls?: number;
  getUserByIdCalls?: number;
};

export type FakeSupabaseWorld = {
  /** Server-side user records: id → the user Supabase itself stores. */
  users: Map<string, FakeSupabaseUser>;
  /** Ordered record of every Supabase boundary crossing. */
  events: string[];
  /** Last app_metadata payload written via the Admin API (the actual PUT body). */
  lastAdminUpdate: { userId: string; app_metadata: Record<string, unknown> } | null;
  sessionBehavior: SessionBehavior;
  adminBehavior: AdminBehavior;
  /** Set to a string to simulate a missing/misconfigured service-role key. */
  serviceRoleKey: string | undefined;

  createSessionClient(): {
    auth: {
      signInWithPassword(
        _args: { email: string; password: string },
      ): Promise<{ data: { user: FakeSupabaseUser | null; session: unknown }; error: unknown }>;
      getUser(): Promise<{ data: { user: FakeSupabaseUser | null }; error: null }>;
      refreshSession(): Promise<{
        data: { session: unknown; user: FakeSupabaseUser | null };
        error: unknown;
      }>;
      signOut(): Promise<{ error: unknown }>;
      exchangeCodeForSession(
        code: string,
      ): Promise<{ data: { user: FakeSupabaseUser | null }; error: unknown }>;
      signInWithOAuth(args: {
        provider: string;
        options: { redirectTo: string; queryParams: Record<string, string> };
      }): Promise<{ data: { url: string | null }; error: unknown }>;
    };
  };

  createServiceRoleClient(): {
    auth: {
      admin: {
        getUserById(id: string): Promise<{ data: { user: FakeSupabaseUser | null }; error: unknown }>;
        updateUserById(
          id: string,
          attributes: { app_metadata: Record<string, unknown> },
        ): Promise<{ data: { user: FakeSupabaseUser | null }; error: unknown }>;
      };
    };
  };

  reset(): void;
};

function initialSessionBehavior(): SessionBehavior {
  return {
    signInWithPasswordCalls: 0,
    refreshCalls: 0,
    signOutCalls: 0,
  };
}

function initialAdminBehavior(): AdminBehavior {
  return {
    getUserByIdCalls: 0,
    updateUserByIdCalls: 0,
  };
}

export function createFakeSupabaseWorld(): FakeSupabaseWorld {
  const users = new Map<string, FakeSupabaseUser>();
  const events: string[] = [];

  const world: FakeSupabaseWorld = {
    users,
    events,
    lastAdminUpdate: null,
    sessionBehavior: initialSessionBehavior(),
    adminBehavior: initialAdminBehavior(),
    serviceRoleKey: "fake-service-role-key",

    createSessionClient() {
      return {
        auth: {
          async signInWithPassword(_args) {
            events.push("session:sign-in");
            const b = world.sessionBehavior;
            b.signInWithPasswordCalls = (b.signInWithPasswordCalls ?? 0) + 1;
            if (b.signInWithPasswordError) {
              return { data: { user: null, session: null }, error: b.signInWithPasswordError };
            }
            const user = b.signInWithPasswordUser ?? null;
            return { data: { user, session: {} }, error: null };
          },
          async getUser() {
            events.push("session:get-user");
            const user = world.sessionBehavior.getUser ?? null;
            return { data: { user: user ? { ...user } : null }, error: null };
          },
          async refreshSession() {
            events.push("session:refresh");
            const b = world.sessionBehavior;
            b.refreshCalls = (b.refreshCalls ?? 0) + 1;
            if (b.refreshThrow) throw b.refreshThrow;
            const user = b.getUser ?? null;
            return {
              data: { session: {}, user: user ? { ...user } : null },
              error: b.refreshError ?? null,
            };
          },
          async signOut() {
            events.push("session:sign-out");
            const b = world.sessionBehavior;
            b.signOutCalls = (b.signOutCalls ?? 0) + 1;
            return { error: b.signOutError ?? null };
          },
          async exchangeCodeForSession(code) {
            events.push(`session:exchange-code:${code ? "with-code" : "without-code"}`);
            const b = world.sessionBehavior;
            if (b.exchangeCodeForSessionError) {
              return { data: { user: null }, error: b.exchangeCodeForSessionError };
            }
            const user = b.exchangeCodeForSessionUser ?? null;
            return { data: { user }, error: null };
          },
          async signInWithOAuth(args) {
            events.push("session:sign-in-with-oauth");
            return { data: { url: `https://accounts.google.com/oauth?redirect=${encodeURIComponent(args.options.redirectTo)}` }, error: null };
          },
        },
      };
    },

    createServiceRoleClient() {
      if (!world.serviceRoleKey) {
        // Mirrors the guard in lib/supabase/server.ts.
        throw new Error(
          "SUPABASE_SERVICE_ROLE_KEY is not configured. The service-role Supabase client cannot be created; the app_metadata mirror (and therefore sign-in) will fail. Set SUPABASE_SERVICE_ROLE_KEY in the server environment.",
        );
      }
      return {
        auth: {
          admin: {
            async getUserById(id) {
              events.push(`admin:get-user-by-id:${id}`);
              const b = world.adminBehavior;
              b.getUserByIdCalls = (b.getUserByIdCalls ?? 0) + 1;
              if (b.getUserByIdError) {
                return { data: { user: null }, error: b.getUserByIdError };
              }
              const user = users.get(id) ?? null;
              return { data: { user: user ? { ...user } : null }, error: null };
            },
            async updateUserById(id, attributes) {
              events.push(`admin:update-user-by-id:${id}`);
              const b = world.adminBehavior;
              b.updateUserByIdCalls = (b.updateUserByIdCalls ?? 0) + 1;
              world.lastAdminUpdate = {
                userId: id,
                app_metadata: { ...attributes.app_metadata },
              };
              if (b.updateUserByIdError) {
                return { data: { user: null }, error: b.updateUserByIdError };
              }
              const existing = users.get(id);
              if (!existing) {
                return {
                  data: { user: null },
                  error: { name: "AuthApiError", status: 404, message: "User not found" },
                };
              }
              if (b.updateUserByIdWrongUser) {
                return {
                  data: {
                    user: { ...existing, id: "some-other-user-id", app_metadata: attributes.app_metadata },
                  },
                  error: null,
                };
              }
              const updated: FakeSupabaseUser = {
                ...existing,
                // The real Admin API PUT replaces the app_metadata object
                // wholesale — the fake does the same, which is exactly what
                // syncApplicationClaims must protect against by read-merging.
                app_metadata: { ...attributes.app_metadata },
              };
              users.set(id, updated);
              return { data: { user: { ...updated } }, error: null };
            },
          },
        },
      };
    },

    reset() {
      users.clear();
      events.length = 0;
      world.lastAdminUpdate = null;
      world.sessionBehavior = initialSessionBehavior();
      world.adminBehavior = initialAdminBehavior();
      world.serviceRoleKey = "fake-service-role-key";
    },
  };

  return world;
}

/** Builds a canonical Supabase user fixture. */
export function fakeSupabaseUser(overrides: Partial<FakeSupabaseUser> = {}): FakeSupabaseUser {
  return {
    id: "9f4b7c1e-4a9d-4d1c-9b6a-2f5c8e7a1b3d",
    email: "emmanuel@example.com",
    phone: null,
    email_confirmed_at: "2026-09-20T08:15:00.000Z",
    user_metadata: { full_name: "Emmanuel Yegon" },
    app_metadata: {},
    identities: [{ id: "identity-1" }],
    ...overrides,
  };
}
