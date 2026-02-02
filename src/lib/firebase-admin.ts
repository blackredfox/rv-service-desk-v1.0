import fs from "node:fs";
import path from "node:path";
import admin from "firebase-admin";

/**
 * Shape of firebase-admin.json (snake_case, as Google provides it)
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

function loadServiceAccount(): FirebaseServiceAccountJson {
  const envPath = process.env.FIREBASE_ADMIN_KEY_PATH;

  // Production must always provide an explicit service account path.
  if (process.env.NODE_ENV === "production" && !envPath) {
    throw new Error("FIREBASE_ADMIN_KEY_PATH is not set");
  }

  // Local dev convenience: default to ./secrets/firebase-admin.json.
  // This keeps credentials out of the repo root and aligns with documented setup.
  const keyPath = envPath || "./secrets/firebase-admin.json";

  const fullPath = path.isAbsolute(keyPath)
    ? keyPath
    : path.join(process.cwd(), keyPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Firebase admin key file not found at: ${fullPath}`);
  }

  const raw = fs.readFileSync(fullPath, "utf8");
  const json = JSON.parse(raw) as FirebaseServiceAccountJson;

  if (typeof json.project_id !== "string" || json.project_id.length === 0) {
    throw new Error("Service account object must contain a string 'project_id' property.");
  }

  if (typeof json.client_email !== "string" || json.client_email.length === 0) {
    throw new Error("firebase-admin.json is missing client_email");
  }

  if (typeof json.private_key !== "string" || json.private_key.length === 0) {
    throw new Error("firebase-admin.json is missing private_key");
  }

  return json;
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
