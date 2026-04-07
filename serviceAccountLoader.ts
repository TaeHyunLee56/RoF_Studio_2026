import "dotenv/config";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadServiceAccount(): Record<string, unknown> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw !== undefined && String(raw).trim() !== "") {
    return JSON.parse(String(raw).trim()) as Record<string, unknown>;
  }
  return require(path.join(__dirname, "secretAccountKey.json")) as Record<
    string,
    unknown
  >;
}
