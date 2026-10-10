-- Add Paystack as a supported payment collection provider.
-- Keep existing PayHero rows intact for historical reconciliation.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'PAYSTACK';
