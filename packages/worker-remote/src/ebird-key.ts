import { createEbirdClient } from "@pondlog/source-ebird";

export const NO_KEY_MESSAGE =
  "No eBird key on this connection. Reconnect the connector and add your key (free at https://ebird.org/api/keygen).";

export type KeyCheck = "valid" | "invalid" | "unavailable";

/** eBird keys are short alphanumeric tokens; reject anything else before calling out. */
export function normalizeKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return /^[A-Za-z0-9]{6,64}$/.test(key) ? key : null;
}

/**
 * One cheap eBird call (region info for "US") to prove the key works.
 * The key goes only in the X-eBirdApiToken header, via source-ebird.
 */
export async function checkEbirdKey(key: string): Promise<KeyCheck> {
  const ebird = createEbirdClient({ getApiKey: () => key });
  const result = await ebird.getRegionInfo("US");
  if (result.ok) return "valid";
  const status = result.error.statusCode;
  return status === 401 || status === 403 ? "invalid" : "unavailable";
}
