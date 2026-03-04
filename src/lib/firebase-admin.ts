import fs from "node:fs";
import path from "node:path";
import admin from "firebase-admin";

/**
 * Shape of firebase service account JSON (snake_case, as Google provides it)
 */
type FirebaseServiceAccountJson = {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain?: string;
};

function parseServiceAccountJson(raw: string): FirebaseServiceAccountJson {
  const json = JSON.parse(raw) as FirebaseServiceAccountJson;

  if (typeof json.project_id !== "string" || json.project_id.length === 0) {
    throw new Error(
      "Service account JSON must contain a non-empty string 'project_id'.",
    );
  }

  if (typeof json.client_email !== "string" || json.client_email.length === 0) {
    throw new Error("Service account JSON is missing 'client_email'.");
  }

  if (typeof json.private_key !== "string" || json.private_key.length === 0) {
    throw new Error("Service account JSON is missing 'private_key'.");
  }

  return json;
}

function loadServiceAccount(): FirebaseServiceAccountJson {
  const envJson = process.env.FIREBASE_ADMIN_CREDENTIALS_JSON;
  const envPath = process.env.FIREBASE_ADMIN_KEY_PATH;

  // Preferred for serverless/prod (e.g., Vercel): JSON stored directly in env var
  if (envJson && envJson.trim().length > 0) {
    try {
      return parseServiceAccountJson(envJson);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Failed to parse FIREBASE_ADMIN_CREDENTIALS_JSON: ${msg}`,
      );
    }
  }

  // Production must always provide credentials somehow.
  if (process.env.NODE_ENV === "production" && !envPath) {
    throw new Error(
      "Firebase Admin credentials are not configured. Set FIREBASE_ADMIN_CREDENTIALS_JSON (recommended) or FIREBASE_ADMIN_KEY_PATH.",
    );
  }

  // Local dev convenience: default to ./secrets/firebase-admin.json.
  const keyPath = envPath || "./secrets/firebase-admin.json";

  const fullPath = path.isAbsolute(keyPath)
    ? keyPath
    : path.join(process.cwd(), keyPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Firebase admin key file not found at: ${fullPath}. Set FIREBASE_ADMIN_KEY_PATH or use FIREBASE_ADMIN_CREDENTIALS_JSON.`,
    );
  }

  const raw = fs.readFileSync(fullPath, "utf8");
  return parseServiceAccountJson(raw);
}

/**
 * Singleton Firebase Admin initializer
 */
export function getFirebaseAdmin() {
  if (admin.apps.length > 0) return admin;

  const serviceAccount = loadServiceAccount();

  admin.initializeApp({
    credential: admin.credential.cert({
      // firebase-admin expects camelCase keys
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
    }),
  });

  return admin;
}

/**
 * Convenience helpers (what routes usually import)
 */
export function getFirebaseAuth() {
  return getFirebaseAdmin().auth();
}