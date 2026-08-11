import "dotenv/config";
import { defineConfig } from "prisma/config";

const provider = process.env.DB_PROVIDER || "sqlite";

export default defineConfig({
  schema: `src/prisma/schemas/${provider}.prisma`,
  // Each provider gets its own migration history — the SQL is provider-specific
  // (e.g. SQLite's DATETIME vs Postgres's TIMESTAMP) and Prisma locks a
  // migrations folder to a single provider via its migration_lock.toml anyway.
  migrations: {
    path: `src/prisma/schemas/migrations/${provider}`,
  },
  datasource: {
    url: process.env.DB_URL!,
  },
});