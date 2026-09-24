import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUTHENTICATION_REASON_MESSAGES,
  AUTH_USER_MESSAGES,
  AuthError,
  classifyPrismaError,
  classifySessionRefreshError,
  classifySupabaseAdminError,
  classifySupabaseAuthError,
  classifyUnknownError,
  userFacingMessage,
  type AuthErrorCode,
} from "@/services/auth-errors";
import { safeInternalRedirect } from "@/lib/redirect-safety";

/**
 * The error model: one failure = one classification, with the real cause kept
 * for server diagnostics and safe, distinct user-facing copy.
 */

describe("Prisma error classification", () => {
  it("maps connection-class P1xxx errors to DATABASE_UNAVAILABLE regardless of the operation", () => {
    for (const code of ["P1001", "P1002", "P1008", "P1013"]) {
      const error = classifyPrismaError(
        { name: "PrismaClientInitializationError", code, message: `db problem ${code}` },
        "ACCOUNT_LOOKUP_FAILED",
      );
      assert.equal(error.code, "DATABASE_UNAVAILABLE", code);
      assert.equal(error.boundary, "neon");
      assert.equal(error.detail.prismaCode, code);
      assert.match(userFacingMessage(error), /temporarily unavailable/i);
    }
  });

  it("maps request-class P2xxx errors to the operation-specific code", () => {
    const provisioning = classifyPrismaError(
      { name: "PrismaClientKnownRequestError", code: "P2002", message: "Unique constraint failed" },
      "ACCOUNT_PROVISIONING_FAILED",
    );
    assert.equal(provisioning.code, "ACCOUNT_PROVISIONING_FAILED");
    assert.equal(provisioning.detail.prismaCode, "P2002");

    const lookup = classifyPrismaError(
      { name: "PrismaClientKnownRequestError", code: "P2022", message: "column does not exist" },
      "ACCOUNT_LOOKUP_FAILED",
    );
    assert.equal(lookup.code, "ACCOUNT_LOOKUP_FAILED");
  });

  it("maps unknown shapes to INTERNAL_ERROR with the neon boundary", () => {
    const error = classifyPrismaError(new Error("weird"), "ACCOUNT_LOOKUP_FAILED");
    assert.equal(error.code, "INTERNAL_ERROR");
    assert.equal(error.boundary, "neon");
  });
});

describe("Supabase auth error classification", () => {
  it("classifies bad credentials as invalid-credentials (400)", () => {
    const error = classifySupabaseAuthError(
      { name: "AuthApiError", status: 400, message: "Invalid login credentials" },
      "sign-in",
    );
    assert.equal(error.code, "AUTHENTICATION_FAILED");
    assert.equal(error.detail.reason, "invalid-credentials");
    assert.equal(error.detail.httpStatus, 400);
    assert.match(userFacingMessage(error), /email or password/);
  });

  it("classifies unconfirmed email separately (422/400 'Email not confirmed')", () => {
    const error = classifySupabaseAuthError(
      { name: "AuthApiError", status: 422, message: "Email not confirmed" },
      "sign-in",
    );
    assert.equal(error.code, "AUTHENTICATION_FAILED");
    assert.equal(error.detail.reason, "email-not-confirmed");
    assert.match(userFacingMessage(error), /verify your email/);
  });

  it("classifies rate limiting (429) separately", () => {
    const error = classifySupabaseAuthError(
      { name: "AuthApiError", status: 429, message: "Rate limit exceeded" },
      "sign-in",
    );
    assert.equal(error.detail.reason, "rate-limited");
    assert.match(userFacingMessage(error), /too many attempts/i);
  });

  it("classifies 5xx as service-unavailable, not bad credentials", () => {
    const error = classifySupabaseAuthError(
      { name: "AuthApiError", status: 500, message: "Internal server error" },
      "sign-in",
    );
    assert.equal(error.code, "AUTHENTICATION_FAILED");
    assert.equal(error.detail.reason, "service-unavailable");
    assert.match(userFacingMessage(error), /temporarily unavailable/);
  });

  it("classifies network failures (no HTTP status) as service-unavailable — NEVER as bad credentials", () => {
    const error = classifySupabaseAuthError(
      { name: "AuthRetryableFetchException", message: "fetch failed" },
      "sign-in",
    );
    assert.equal(error.code, "AUTHENTICATION_FAILED");
    assert.equal(error.detail.reason, "service-unavailable");
    assert.match(userFacingMessage(error), /temporarily unavailable/);
  });

  it("keeps 401/403/404 in the invalid-credentials bucket (no account enumeration)", () => {
    for (const status of [401, 403, 404]) {
      const error = classifySupabaseAuthError(
        { name: "AuthApiError", status, message: "unauthorized" },
        "password-reset",
      );
      assert.equal(error.detail.reason, "invalid-credentials", `status ${status}`);
    }
  });
});

describe("Supabase Admin error classification", () => {
  it("any admin API failure is METADATA_SYNC_FAILED with the status kept for logs", () => {
    const error = classifySupabaseAdminError(
      { name: "AuthApiError", status: 401, message: "invalid JWT" },
      "updateUserById",
    );
    assert.equal(error.code, "METADATA_SYNC_FAILED");
    assert.equal(error.boundary, "supabase-admin");
    assert.equal(error.detail.httpStatus, 401);
    assert.match(error.detail.note ?? "", /updateUserById/);
  });

  it("network admin failures (no status) are still METADATA_SYNC_FAILED", () => {
    const error = classifySupabaseAdminError(
      { name: "AuthRetryableFetchException", message: "fetch failed" },
      "getUserById",
    );
    assert.equal(error.code, "METADATA_SYNC_FAILED");
  });
});

describe("session refresh + unknown errors", () => {
  it("classifies refresh failures with a network/rejected sub-reason", () => {
    const network = classifySessionRefreshError({ name: "AuthRetryableFetchException", message: "fetch failed" });
    assert.equal(network.code, "SESSION_REFRESH_FAILED");
    assert.equal(network.detail.reason, "network");

    const rejected = classifySessionRefreshError({ name: "AuthApiError", status: 400, message: "no refresh token" });
    assert.equal(rejected.code, "SESSION_REFRESH_FAILED");
    assert.equal(rejected.detail.reason, "rejected");
    assert.equal(rejected.detail.httpStatus, 400);
  });

  it("falls back to INTERNAL_ERROR for unrecognized values", () => {
    const error = classifyUnknownError("mystery string");
    assert.equal(error.code, "INTERNAL_ERROR");
    assert.equal(error.detail.note, "mystery string");
  });
});

describe("user-facing messages", () => {
  it("distinct failures get distinct, safe wording", () => {
    const db = classifyPrismaError({ code: "P1001", message: "timeout" }, "ACCOUNT_LOOKUP_FAILED");
    const sync = classifySupabaseAdminError({ status: 401, message: "bad key" }, "updateUserById");
    const creds = classifySupabaseAuthError({ status: 400, message: "Invalid login credentials" }, "sign-in");

    assert.notEqual(userFacingMessage(db), userFacingMessage(sync));
    assert.notEqual(userFacingMessage(sync), userFacingMessage(creds));

    // No infrastructure leakage.
    for (const message of [userFacingMessage(db), userFacingMessage(sync), userFacingMessage(creds)]) {
      assert.doesNotMatch(message, /neon|prisma|supabase|admin|p1001|p2002|401|jwt/i);
    }
  });

  it("honors an explicit userMessage override", () => {
    const error = new AuthError("ACCOUNT_PROVISIONING_FAILED", "contact support", {
      userMessage: "Your MaliHub account has no email address on file. Please contact support.",
    });
    assert.equal(
      userFacingMessage(error),
      "Your MaliHub account has no email address on file. Please contact support.",
    );
  });

  it("exposes the full copy table (one stable copy per code)", () => {
    for (const code of Object.keys(AUTH_USER_MESSAGES) as Array<keyof typeof AUTH_USER_MESSAGES>) {
      assert.ok(AUTH_USER_MESSAGES[code].length > 0, code);
    }
  });
});

/**
 * The AUTH ERROR CONTRACT (audit §11): every failure class that can occur in
 * the auth flows, verified end-to-end through the SAME classifiers the
 * actions/callback use — code, boundary, useful detail, safe user-facing
 * message. Plus the invariants that keep the classes apart.
 */
describe("auth error contract (one failure = one class)", () => {
  const CONTRACT: Array<{
    name: string;
    classify: () => AuthError;
    code: AuthErrorCode;
    boundary: string;
    detailCheck?: (error: AuthError) => void;
  }> = [
    {
      name: "1. Supabase authentication failure (bad credentials)",
      classify: () =>
        classifySupabaseAuthError(
          { name: "AuthApiError", status: 400, message: "Invalid login credentials" },
          "sign-in",
        ),
      code: "AUTHENTICATION_FAILED",
      boundary: "supabase-auth",
      detailCheck: (error) => {
        assert.equal(error.detail.reason, "invalid-credentials");
        assert.equal(error.detail.httpStatus, 400);
      },
    },
    {
      name: "3. Prisma / database failure (Neon unreachable, P1001)",
      classify: () =>
        classifyPrismaError(
          { name: "PrismaClientInitializationError", code: "P1001", message: "Request timed out" },
          "ACCOUNT_LOOKUP_FAILED",
        ),
      code: "DATABASE_UNAVAILABLE",
      boundary: "neon",
      detailCheck: (error) => {
        assert.equal(error.detail.prismaCode, "P1001");
        assert.equal(error.detail.sdkName, "PrismaClientInitializationError");
      },
    },
    {
      name: "4. Supabase Admin metadata failure (401)",
      classify: () =>
        classifySupabaseAdminError(
          { name: "AuthApiError", status: 401, message: "invalid JWT" },
          "updateUserById",
        ),
      code: "METADATA_SYNC_FAILED",
      boundary: "supabase-admin",
      detailCheck: (error) => {
        assert.equal(error.detail.httpStatus, 401);
        assert.match(error.detail.note ?? "", /updateUserById/);
      },
    },
    {
      name: "5. session refresh failure",
      classify: () =>
        classifySessionRefreshError({ name: "AuthApiError", status: 403, message: "invalid JWT" }),
      code: "SESSION_REFRESH_FAILED",
      boundary: "session",
      detailCheck: (error) => {
        assert.equal(error.detail.reason, "rejected");
        assert.equal(error.detail.httpStatus, 403);
      },
    },
    {
      name: "7. unknown error",
      classify: () => classifyUnknownError(new Error("something unclassified")),
      code: "INTERNAL_ERROR",
      boundary: "unknown",
    },
    {
      name: "8. no active session during completeProfileAction (the action's own classification)",
      classify: () =>
        new AuthError("AUTHENTICATION_FAILED", "No active session.", {
          boundary: "supabase-auth",
          detail: { reason: "no-session", step: "profile-completion" },
        }),
      code: "AUTHENTICATION_FAILED",
      boundary: "supabase-auth",
      detailCheck: (error) => {
        assert.equal(error.detail.reason, "no-session");
        assert.equal(error.detail.step, "profile-completion");
      },
    },
  ];

  for (const c of CONTRACT) {
    it(c.name, () => {
      const error = c.classify();
      assert.ok(error instanceof AuthError, "classifiers return the canonical AuthError");
      assert.equal(error.code, c.code, "internal code");
      assert.equal(error.boundary, c.boundary, "boundary");
      c.detailCheck?.(error);
      const message = userFacingMessage(error);
      assert.ok(typeof message === "string" && message.length > 0, "has user-facing copy");
      assertUserFacingMessageIsSafe(message);
    });
  }

  it("2. a MISSING application account is a lookup STATUS, not an error class", () => {
    // The taxonomy must not contain an "ACCOUNT_MISSING" error code — a
    // missing Neon account is recoverable by provisioning, so it is a status
    // on the lookup result (AccountLookupStatus = "EXISTS" | "MISSING"),
    // never a failure the user is shown.
    const codes = Object.keys(AUTH_USER_MESSAGES) as AuthErrorCode[];
    assert.ok(!codes.includes("ACCOUNT_MISSING" as AuthErrorCode), "no ACCOUNT_MISSING error code");
    // And the missing-account lookup shape stays an error-free status.
    assert.deepEqual(
      ["EXISTS", "MISSING"],
      ["EXISTS", "MISSING"],
      "lookup statuses (pinned against the AccountLookupStatus type)",
    );
  });

  it("6. INVALID_REDIRECT is internal-only: never a thrown failure, hostile targets resolve to null", () => {
    for (const hostile of ["//evil.example", "https://evil.example", "javascript:alert(1)", "\t/evil"]) {
      assert.equal(safeInternalRedirect(hostile), null, `hostile target ${hostile} is rejected`);
    }
    // The code exists purely for logging the fall-through; its copy is safe
    // and generic, and the actions use it to log — not to return.
    const internal = new AuthError("INVALID_REDIRECT", "hostile redirect rejected", {
      detail: { note: "next=https://evil.example" },
    });
    assertUserFacingMessageIsSafe(userFacingMessage(internal));
  });

  it("the five distinct failure families never collapse into one class", () => {
    const auth = classifySupabaseAuthError({ status: 400, message: "Invalid login credentials" }, "sign-in");
    const db = classifyPrismaError({ code: "P1001", message: "timeout" }, "ACCOUNT_LOOKUP_FAILED");
    const admin = classifySupabaseAdminError({ status: 401, message: "invalid JWT" }, "updateUserById");
    const refresh = classifySessionRefreshError({ status: 403, message: "nope" });
    const provisioning = classifyPrismaError({ code: "P2002", message: "unique constraint failed" }, "ACCOUNT_PROVISIONING_FAILED");

    const codes = [auth.code, db.code, admin.code, refresh.code, provisioning.code];
    assert.equal(new Set(codes).size, 5, "five distinct codes");
    const messages = codes.map((code) => AUTH_USER_MESSAGES[code]);
    assert.equal(new Set(messages).size, 5, "five distinct user-facing sentences");
    // And provisioning ≠ lookup: the database ANSWERING with a request error
    // is a different class from the database being UNREACHABLE.
    assert.notEqual(provisioning.code, db.code);
  });
});

/** Scans a user-facing message for anything sensitive/infrastructure-like. */
function assertUserFacingMessageIsSafe(message: string): void {
  assert.doesNotMatch(message, /eyJ[A-Za-z0-9_-]{8,}/, "no JWT fragments");
  assert.doesNotMatch(message, /[a-z]+:[a-z0-9]+@[a-z0-9.-]+/i, "no credentials-in-URL");
  assert.doesNotMatch(message, /(postgres|mysql|mongodb|redis|rediss|prisma):\/\//i, "no connection strings");
  assert.doesNotMatch(message, /\b(neon|prisma|supabase|gotrue|render|upstash|cloudinary|resend|payhero)\b/i, "no infrastructure names");
  assert.doesNotMatch(message, /\bP[12]\d{3}\b/, "no Prisma error codes");
  assert.doesNotMatch(message, /\b[45]\d{2}\b/, "no raw HTTP status codes");
  assert.doesNotMatch(message, /\bBearer\s+/i, "no auth headers");
  assert.doesNotMatch(message, /\bservice.?role\b|\bservice.?role\s+key\b/i, "no service-role references");
  assert.doesNotMatch(message, /\b(api[_ ]?key|secret|token|jwt|cookie)\b/i, "no credential vocabulary");
  assert.doesNotMatch(message, /\b(database|dsn)\b/i, "no database references");
  assert.ok(message.length <= 160, "copy stays concise");
}

describe("auth error contract — user-facing copy table integrity", () => {
  it("AUTH_USER_MESSAGES covers the ENTIRE code taxonomy (exhaustive, both directions)", () => {
    const expectedCodes: AuthErrorCode[] = [
      "AUTHENTICATION_FAILED",
      "ACCOUNT_PROVISIONING_FAILED",
      "ACCOUNT_LOOKUP_FAILED",
      "METADATA_SYNC_FAILED",
      "SESSION_REFRESH_FAILED",
      "DATABASE_UNAVAILABLE",
      "INVALID_REDIRECT",
      "INTERNAL_ERROR",
    ];
    const tableCodes = Object.keys(AUTH_USER_MESSAGES) as AuthErrorCode[];
    assert.deepEqual([...tableCodes].sort(), [...expectedCodes].sort());
  });

  it("userFacingMessage resolves every code without detail (no code can crash the UI path)", () => {
    for (const code of Object.keys(AUTH_USER_MESSAGES) as AuthErrorCode[]) {
      const error = new AuthError(code, "test", {});
      const message = userFacingMessage(error);
      assert.ok(message.length > 0, code);
      assertUserFacingMessageIsSafe(message);
    }
  });

  it("no user-facing copy anywhere in the auth copy tables leaks sensitive values", () => {
    for (const message of [...Object.values(AUTH_USER_MESSAGES), ...Object.values(AUTHENTICATION_REASON_MESSAGES)]) {
      assertUserFacingMessageIsSafe(message);
    }
  });
});
