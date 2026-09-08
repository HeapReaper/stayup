-- Which record a DNS monitor looks up, and optionally what it must contain.
-- 'A' is what every existing DNS monitor was doing implicitly, so the default
-- leaves them checking exactly what they checked before.
ALTER TABLE "monitor" ADD COLUMN     "dnsRecordType" TEXT NOT NULL DEFAULT 'A',
ADD COLUMN     "dnsExpectedValue" TEXT;
