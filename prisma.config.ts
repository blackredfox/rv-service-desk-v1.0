import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // In early bootstrap, DATABASE_URL may be absent. Prisma commands that connect to a real DB
    // still require a valid URL, but we avoid hard-failing config evaluation.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/rv_service_desk?schema=public",
  },
});
