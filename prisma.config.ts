import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Note: DATABASE_URL can be absent in early bootstrap; prisma commands will require it.
    url: env("DATABASE_URL") ?? "postgresql://localhost:5432/rv_service_desk?schema=public",
  },
});
