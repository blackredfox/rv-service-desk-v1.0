import fs from "node:fs";
import path from "node:path";
import admin from "firebase-admin";

/**
 * Shape of firebase-admin service account JSON (snake_case, as Google provides it)
 * NOTE: Keys are exactly as in the Google service account JSON.
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

function assertServiceAccount(json: FirebaseServiceAccountJson): FirebaseServiceAccountJson {
  if (typeof json.project_id !== "string" || json.project_id.length === 0) {
    throw new Error("Service account JSON must contain non-empty 'project_id'.");
  }
  if (typeof json.client_email !== "string" || json.client_email.length === 0) {
    throw new Error("Service account JSON is missing 'client_email'.");
  }
  if (typeof json.private_key !== "string" || json.private_key.length === 0) {
    throw new Error("Service account JSON is missing 'private_key'.");
  }
  return json;
}

function parseServiceAccountJson(raw: string, sourceLabel: string): FirebaseServiceAccountJson {
  const trimmed = raw.trim();

  try {
    const json = JSON.parse(trimmed) as FirebaseServiceAccountJson;
    return assertServiceAccount(json);
  } catch (e) {
    // This is the #1 failure on Vercel: the value contains REAL line breaks inside private_key,
    // which makes the JSON invalid. The fix is to store one-line JSON and escape newlines as \\n.
    throw new Error(
      `Failed to parse ${sourceLabel}. ` +
        `Ensure it's VALID JSON (single line). For private_key, use escaped newlines (\\\\n) NOT real line breaks. ` +
        `${e instanceof Error ? e.message : String(e)}`
    );
  }
}

function loadServiceAccount(): FirebaseServiceAccountJson {
  // Preferred for serverless (Vercel): store the full JSON in env.
  const jsonB64 = process.env.FIREBASE_ADMIN_CREDENTIALS_JSON_B64;
  const jsonRaw = process.env.FIREBASE_ADMIN_CREDENTIALS_JSON;

  if (jsonB64 && jsonB64.trim().length > 0) {
    const decoded = Buffer.from(jsonB64.trim(), "base64").toString("utf8");
    return parseServiceAccountJson(decoded, "FIREBASE_ADMIN_CREDENTIALS_JSON_B64");
  }

  if (jsonRaw && jsonRaw.trim().length > 0) {
    return parseServiceAccountJson(jsonRaw, "FIREBASE_ADMIN_CREDENTIALS_JSON");
  }

  // Fallback for local/dev: read from a file path.
  const envPath = process.env.FIREBASE_ADMIN_KEY_PATH;

  // Local dev convenience: default to ./secrets/firebase-admin.json.
  const keyPath = envPath || "./secrets/firebase-admin.json";

  const fullPath = path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Firebase admin key file not found at: ${fullPath}. ` +
        `Set FIREBASE_ADMIN_KEY_PATH, or provide FIREBASE_ADMIN_CREDENTIALS_JSON(_B64).`
    );
  }

  const raw = fs.readFileSync(fullPath, "utf8");
  return parseServiceAccountJson(raw, `firebase-admin.json at ${fullPath}`);
}

/**
 * Singleton Firebase Admin initializer
 */
export function getFirebaseAdmin() {
  if (admin.apps.length > 0) return admin;

  const serviceAccount = loadServiceAccount();

  // firebase-admin expects camelCase keys
  const privateKey =
    serviceAccount.private_key.includes("\\n")
      ? serviceAccount.private_key.replace(/\\n/g, "\n")
      : serviceAccount.private_key;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey,
    }),
  });

  return admin;
}

export function getFirebaseAuth() {
  return getFirebaseAdmin().auth();
}