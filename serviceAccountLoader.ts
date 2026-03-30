import "dotenv/config";

/**
 * Firebase / GCP 서비스 계정 — 환경 변수 FIREBASE_SERVICE_ACCOUNT_JSON (JSON 문자열 전체)
 *
 * Returns the parsed service account object, or null if the environment
 * variable is missing, empty, or contains invalid JSON.  All failure cases
 * are logged so the caller can decide whether to abort or continue without
 * Firebase.
 */
export function loadServiceAccount(): Record<string, unknown> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  // ── 1. Presence check ──────────────────────────────────────────────────────
  if (raw === undefined) {
    console.error(
      "[serviceAccountLoader] ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is not set. " +
        "Add the full service-account JSON as this environment variable."
    );
    return null;
  }

  if (raw.trim() === "") {
    console.error(
      "[serviceAccountLoader] ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is set but empty. " +
        "Make sure the variable contains the full JSON string."
    );
    return null;
  }

  // ── 2. Parse check ─────────────────────────────────────────────────────────
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error(
      "[serviceAccountLoader] ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON as JSON.",
      "\n  Parse error:", (err as Error).message,
      "\n  First 120 chars of raw value:", raw.substring(0, 120)
    );
    return null;
  }

  // ── 3. Sanity-check required fields ────────────────────────────────────────
  const required = ["type", "project_id", "private_key", "client_email"];
  const missing = required.filter((k) => !(k in parsed));
  if (missing.length > 0) {
    console.error(
      "[serviceAccountLoader] ERROR: Parsed JSON is missing required service-account fields:",
      missing.join(", ")
    );
    return null;
  }

  console.log(
    `[serviceAccountLoader] Service account loaded successfully ` +
      `(project: ${parsed["project_id"]}, client: ${parsed["client_email"]})`
  );
  return parsed;
}
