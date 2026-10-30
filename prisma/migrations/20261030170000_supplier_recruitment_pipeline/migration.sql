-- Persisted supplier recruitment enquiries and admin-only negotiation notes.
CREATE TYPE "SupplierLeadStatus" AS ENUM
  ('NEW', 'CONTACTED', 'QUALIFIED', 'NEGOTIATING', 'VERIFICATION_PENDING', 'ONBOARDED', 'DECLINED');

CREATE TABLE "supplier_leads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_name" TEXT NOT NULL,
  "contact_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "location" TEXT,
  "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "catalogue_url" TEXT,
  "website_url" TEXT,
  "message" TEXT,
  "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "SupplierLeadStatus" NOT NULL DEFAULT 'NEW',
  "internal_notes" TEXT,
  "wholesale_terms" TEXT,
  "delivery_terms" TEXT,
  "follow_up_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supplier_leads_status_created_at_idx" ON "supplier_leads"("status", "created_at");
CREATE INDEX "supplier_leads_follow_up_at_idx" ON "supplier_leads"("follow_up_at");
CREATE INDEX "supplier_leads_email_idx" ON "supplier_leads"("email");
