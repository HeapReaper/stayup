-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_app_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "organizationName" TEXT NOT NULL DEFAULT 'My Organization',
    "timezone" TEXT NOT NULL DEFAULT 'utc',
    "supportEmail" TEXT,
    "defaultCheckInterval" TEXT NOT NULL DEFAULT '60s',
    "httpTimeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "failedAttemptsThreshold" INTEGER NOT NULL DEFAULT 1,
    "latencyThresholdMs" INTEGER NOT NULL DEFAULT 2000,
    "sslCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
    "certExpiryWarningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "smtpFromEmail" TEXT,
    "smtpFromName" TEXT,
    "smtpUseTls" BOOLEAN NOT NULL DEFAULT true,
    "apiKey" TEXT NOT NULL,
    "webhookSigningSecret" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_app_settings" ("id", "organizationName", "timezone", "supportEmail", "defaultCheckInterval", "httpTimeoutSeconds", "failedAttemptsThreshold", "latencyThresholdMs", "sslCheckEnabled", "certExpiryWarningEnabled", "smtpHost", "smtpPort", "smtpUser", "smtpPass", "smtpFromEmail", "smtpFromName", "smtpUseTls", "apiKey", "webhookSigningSecret", "updatedAt")
SELECT "id", "organizationName", "timezone", "supportEmail", "defaultCheckInterval", "httpTimeoutSeconds", "failedAttemptsThreshold", "latencyThresholdMs", "sslCheckEnabled", "certExpiryWarningEnabled", "smtpHost", "smtpPort", "smtpUser", "smtpPass", "smtpFromEmail", "smtpFromName", "smtpUseTls", "apiKey", "webhookSigningSecret", "updatedAt"
FROM "app_settings";
DROP TABLE "app_settings";
ALTER TABLE "new_app_settings" RENAME TO "app_settings";
CREATE UNIQUE INDEX "app_settings_apiKey_key" ON "app_settings"("apiKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Bump any row still sitting on the old default; leaves rows an admin has
-- deliberately customized untouched.
UPDATE "app_settings" SET "latencyThresholdMs" = 2000 WHERE "latencyThresholdMs" = 800;
