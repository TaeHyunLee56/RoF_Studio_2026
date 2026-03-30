import "dotenv/config";

/**
 * Firebase / GCP 서비스 계정 — 환경 변수 FIREBASE_SERVICE_ACCOUNT_JSON (JSON 문자열 전체)
 */
export function loadServiceAccount(): Record<string, unknown> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw === undefined || String(raw).trim() === "") {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON 환경 변수에 서비스 계정 JSON 전체를 설정하세요."
    );
  }
  return JSON.parse(String(raw)) as Record<string, unknown>;
}
