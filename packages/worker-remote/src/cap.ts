import type { Executor } from "@cloudflare/codemode";

/**
 * Wraps an executor with a per-user daily limit on `code` runs, counted in
 * KV per UTC day. KV is eventually consistent, so concurrent runs can
 * overshoot slightly; this is a cost guard, not a hard quota.
 */
export function withDailyCap(options: {
  executor: Executor;
  kv: KVNamespace;
  userId: string;
  limit: number;
  now?: () => Date;
}): Executor {
  const { executor, kv, userId, limit } = options;
  const now = options.now ?? (() => new Date());
  return {
    async execute(code, providers, execOptions) {
      const day = now().toISOString().slice(0, 10);
      const key = `pondlog:cap:${userId}:${day}`;
      const used = Number((await kv.get(key)) ?? "0") || 0;
      if (used >= limit) {
        return {
          result: undefined,
          error: `Daily limit of ${limit} code runs reached. It resets at 00:00 UTC.`,
        };
      }
      await kv.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
      return executor.execute(code, providers, execOptions);
    },
  };
}

export function parseLimit(raw: string | undefined, fallback = 200): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
