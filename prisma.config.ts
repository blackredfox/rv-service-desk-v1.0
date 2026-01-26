// prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
    // Optional: only if you use a separate shadow DB for migrations
    // shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
});
