// src/lib/firebase-admin.ts
// Server-only Firebase Admin initialization for Next.js (App Router).
// Do NOT import this file from client components.

import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

type RawServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function readServiceAccountFile(): RawServiceAccountJson {
  const relPath =
    process.env.FIREBASE_ADMIN_KEY_PATH?.trim() || "secrets/firebase-admin.json";

  const absPath = path.isAbsolute(relPath)
    ? relPath
    : path.join(process.cwd(), relPath);

  const raw = fs.readFileSync(absPath, "utf8");
  return JSON.parse(raw) as RawServiceAccountJson;
}

function toServiceAccount(raw: RawServiceAccountJson): admin.ServiceAccount {
  const clientEmail = raw.client_email;
  const privateKey = raw.private_key;

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Invalid Firebase Admin service account JSON: missing client_email/private_key."
    );
  }

  // admin.ServiceAccount expects camelCase fields.
  return {
    clientEmail,
    privateKey,
  };
}

export function getFirebaseAdminApp(): admin.app.App {
  if (admin.apps.length > 0) return admin.app();

  const raw = readServiceAccountFile();
  const serviceAccount = toServiceAccount(raw);

  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() || raw.project_id || undefined;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId,
  });

  return admin.app();
}

export function getFirebaseAuth(): admin.auth.Auth {
  return getFirebaseAdminApp().auth();
}
