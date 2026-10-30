CREATE TABLE "auth_session_activity" (
  "session_id" TEXT NOT NULL,
  "auth_user_id" TEXT NOT NULL,
  "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_session_activity_pkey" PRIMARY KEY ("session_id")
);

CREATE INDEX "auth_session_activity_auth_user_id_idx"
  ON "auth_session_activity"("auth_user_id");
