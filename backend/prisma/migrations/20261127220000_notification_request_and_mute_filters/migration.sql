ALTER TABLE "NotificationPreferences" ADD COLUMN "chatRequestAlerts" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "muteSocialAlerts" BOOLEAN NOT NULL DEFAULT false;
