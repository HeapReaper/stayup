import "dotenv/config";
import { defineConfig } from "prisma/config";

const provider = process.env.DB_PROVIDER || "sqlite";

export default defineConfig({
  schema: `src/prisma/schemas/${provider}.prisma`,
  datasource: {
    url: process.env.DB_URL!,
  },
});