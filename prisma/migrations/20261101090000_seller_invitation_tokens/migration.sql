-- One-time, admin-issued seller invitations.
-- Only SHA-256 token hashes are persisted. Raw bearer tokens are returned once
-- to the authenticated administrator for manual sharing.
CREATE TABLE "seller_invitation_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "claimed_at" TIMESTAMPTZ(6),
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seller_invitation_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_invitation_tokens_user_id_key"
  ON "seller_invitation_tokens"("user_id");
CREATE UNIQUE INDEX "seller_invitation_tokens_token_hash_key"
  ON "seller_invitation_tokens"("token_hash");
CREATE INDEX "seller_invitation_tokens_expires_at_idx"
  ON "seller_invitation_tokens"("expires_at");

ALTER TABLE "seller_invitation_tokens"
  ADD CONSTRAINT "seller_invitation_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
