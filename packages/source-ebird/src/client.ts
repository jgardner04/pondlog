import {
  PONDLOG_USER_AGENT,
  RateLimiter,
  err,
  ok,
  withRetry,
  type Result,
} from "@pondlog/core";
import type { z } from "zod";

const BASE_URL = "https://api.ebird.org/v2";

/**
 * One limiter per API key (100 req/min each), so callers with different keys
 * never queue behind each other. Bounded so a long-lived process serving many
 * keys cannot grow without limit; the least recently used limiter is dropped.
 * Limits are per process (or per isolate), not global.
 */
const MAX_LIMITERS = 500;
const limiters = new Map<string, RateLimiter>();

export function limiterForKey(key: string): RateLimiter {
  let limiter = limiters.get(key);
  if (limiter) {
    limiters.delete(key);
  } else {
    limiter = new RateLimiter({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 });
    if (limiters.size >= MAX_LIMITERS) {
      const oldest = limiters.keys().next().value;
      if (oldest !== undefined) limiters.delete(oldest);
    }
  }
  limiters.set(key, limiter);
  return limiter;
}

class RateLimitedError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "RateLimitedError";
    this.statusCode = statusCode;
  }
}

class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

const ENV_MISSING_KEY_MESSAGE =
  "EBIRD_API_KEY environment variable is not set. Get a free key at https://ebird.org/api/keygen and export EBIRD_API_KEY=<your-key>.";

class MissingApiKeyError extends Error {
  constructor(message: string = ENV_MISSING_KEY_MESSAGE) {
    super(message);
    this.name = "MissingApiKeyError";
  }
}

function readEnvApiKey(): string | undefined {
  return process.env.EBIRD_API_KEY;
}

function resolveKey(getApiKey: () => string | undefined, missingKeyMessage?: string): string {
  const key = getApiKey();
  if (!key || key.trim() === "") {
    throw new MissingApiKeyError(missingKeyMessage);
  }
  return key.trim();
}

function readApiKey(): string {
  return resolveKey(readEnvApiKey);
}

/**
 * Throws synchronously if EBIRD_API_KEY is missing. Call this at app startup
 * to fail loudly before issuing any network calls. Inside the source client
 * itself, missing keys surface as a Result error from each fetch.
 */
export function assertEbirdApiKey(): void {
  readApiKey();
}

export interface EbirdFetchOptions {
  searchParams?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** When true, parses response as text instead of JSON (for CSV/text endpoints). */
  responseType?: "json" | "text";
}

function buildUrl(path: string, opts: EbirdFetchOptions | undefined): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (opts?.searchParams) {
    for (const [key, value] of Object.entries(opts.searchParams)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** The signature every endpoint function fetches through. */
export type EbirdFetcher = <T>(
  path: string,
  schema: z.ZodType<T>,
  opts?: EbirdFetchOptions,
) => Promise<Result<T>>;

export interface EbirdFetcherOptions {
  /**
   * Returns the eBird API key for the current call. When provided, it is the
   * only key source: `process.env.EBIRD_API_KEY` is not read. When omitted,
   * the key is read from `process.env.EBIRD_API_KEY` on every call.
   */
  getApiKey?: () => string | undefined;
  /** Error message used when `getApiKey` returns no key. */
  missingKeyMessage?: string;
}

/**
 * Creates a fetcher bound to one key source. Endpoint factories
 * (`createHotspotEndpoints` and friends) take one, and `createEbirdClient`
 * wires them all together.
 */
export function createEbirdFetcher(options: EbirdFetcherOptions = {}): EbirdFetcher {
  const getApiKey = options.getApiKey ?? readEnvApiKey;
  const missingKeyMessage = options.getApiKey ? options.missingKeyMessage : undefined;
  return (path, schema, opts) => fetchWithKey(getApiKey, missingKeyMessage, path, schema, opts);
}

/** Default fetcher: reads `process.env.EBIRD_API_KEY` on every call. */
export const ebirdFetch: EbirdFetcher = createEbirdFetcher();

async function fetchWithKey<T>(
  getApiKey: () => string | undefined,
  missingKeyMessage: string | undefined,
  path: string,
  schema: z.ZodType<T>,
  opts?: EbirdFetchOptions,
): Promise<Result<T>> {
  let apiKey: string;
  try {
    apiKey = resolveKey(getApiKey, missingKeyMessage);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err({ source: "ebird", message });
  }

  const url = buildUrl(path, opts);
  const limiter = limiterForKey(apiKey);

  try {
    const json = await withRetry(
      async () => {
        await limiter.acquire();
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "X-eBirdApiToken": apiKey,
            "User-Agent": PONDLOG_USER_AGENT,
            Accept: "application/json",
          },
          signal: opts?.signal,
        });
        if (res.status === 429) {
          throw new RateLimitedError(429, `eBird rate limit hit at ${path}`);
        }
        if (!res.ok) {
          const text = await safeReadText(res);
          throw new HttpError(
            res.status,
            `eBird ${res.status} on ${path}: ${truncate(text, 200)}`,
          );
        }
        return (await res.json()) as unknown;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        shouldRetry: (e: unknown) => e instanceof RateLimitedError,
      },
    );

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return err({
        source: "ebird",
        message: `Zod schema mismatch on ${path}: ${parsed.error.message}`,
      });
    }
    return ok(parsed.data);
  } catch (cause) {
    if (cause instanceof RateLimitedError) {
      return err({ source: "ebird", message: cause.message, statusCode: cause.statusCode });
    }
    if (cause instanceof HttpError) {
      return err({ source: "ebird", message: cause.message, statusCode: cause.statusCode });
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    return err({ source: "ebird", message, cause });
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
