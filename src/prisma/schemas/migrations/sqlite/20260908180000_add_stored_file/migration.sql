-- Uploaded files (status page logos, profile pictures) live in the database,
-- not on a volume: the deploy compose files are imported by URL and mount only
-- their own `logs` volume, so an upload on a container filesystem would vanish
-- on the next redeploy. Rows are immutable — a replaced logo is a new row and
-- the old one is deleted — which is what lets /api/files/[id] serve them with a
-- one-year immutable cache.
CREATE TABLE "stored_file" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stored_file_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "stored_file_uploadedById_idx" ON "stored_file"("uploadedById");
