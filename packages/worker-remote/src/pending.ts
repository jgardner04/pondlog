import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { base64url, randomToken } from "./github.js";

/**
 * Holds an authorization between the GitHub callback and the eBird key form.
 * The browser keeps a random handle in a __Host- cookie; KV keeps only the
 * handle's SHA-256, so reading KV alone cannot resume someone's sign-in.
 * Nothing secret is stored: the eBird key is not known yet.
 */

export const PENDING_COOKIE = "__Host-pondlog-pending";
const TTL_SECONDS = 600;
export const MAX_KEY_ATTEMPTS = 5;

export interface PendingAuth {
  request: AuthRequest;
  githubId: number;
  githubLogin: string;
  attempts: number;
}

async function kvKey(handle: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(handle));
  return `pondlog:pending:${base64url(new Uint8Array(digest))}`;
}

export async function createPending(kv: KVNamespace, value: Omit<PendingAuth, "attempts">): Promise<{ cookie: string }> {
  const handle = randomToken();
  const record: PendingAuth = { ...value, attempts: 0 };
  await kv.put(await kvKey(handle), JSON.stringify(record), { expirationTtl: TTL_SECONDS });
  return {
    cookie: `${PENDING_COOKIE}=${handle}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}`,
  };
}

export function readPendingHandle(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === PENDING_COOKIE) {
      const value = rest.join("=");
      return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
    }
  }
  return null;
}

export async function loadPending(kv: KVNamespace, handle: string): Promise<PendingAuth | null> {
  const raw = await kv.get(await kvKey(handle));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingAuth;
  } catch {
    return null;
  }
}

export async function savePending(kv: KVNamespace, handle: string, value: PendingAuth): Promise<void> {
  await kv.put(await kvKey(handle), JSON.stringify(value), { expirationTtl: TTL_SECONDS });
}

export async function deletePending(kv: KVNamespace, handle: string): Promise<void> {
  await kv.delete(await kvKey(handle));
}

export const CLEAR_PENDING_COOKIE = `${PENDING_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
