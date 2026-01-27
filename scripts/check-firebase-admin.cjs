/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/check-firebase-admin.cjs
const fs = require("fs");

const p = "./secrets/firebase-admin.json";

try {
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw);

  console.log("ok file:", Boolean(j.type));
  console.log("type:", j.type);
  console.log("project_id:", j.project_id);
  console.log("client_email:", j.client_email);
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
