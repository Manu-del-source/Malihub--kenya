-- Track welcome-email delivery independently from authentication and notifications.
CREATE TYPE "OnboardingEmailKind" AS ENUM ('BUYER_WELCOME', 'SELLER_WELCOME');
CREATE TYPE "OnboardingEmailStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "onboarding_emails" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "kind" "OnboardingEmailKind" NOT NULL,
  "status" "OnboardingEmailStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(500),
  "claimed_at" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "onboarding_emails_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "onboarding_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "onboarding_emails_user_id_kind_key" ON "onboarding_emails"("user_id", "kind");
CREATE INDEX "onboarding_emails_status_updated_at_idx" ON "onboarding_emails"("status", "updated_at");
