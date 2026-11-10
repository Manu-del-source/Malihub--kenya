-- Adds a PROMOTION notification type for the Message Centre "Promotions" inbox.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROMOTION';
