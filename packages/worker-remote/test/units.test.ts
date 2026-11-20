import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowed, parseAllowlist } from "../src/allowlist.js";
import { parseLimit, withDailyCap } from "../src/cap.js";
import { checkEbirdKey, normalizeKey } from "../src/ebird-key.js";
import { consentPage, ebirdKeyPage, escapeHtml } from "../src/html.js";
import { PENDING_COOKIE, readPendingHandle } from "../src/pending.js";
import { compact, withPrefix } from "../src/upstream.js";

function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
      delete: async (k: string) => void store.delete(k),
    } as unknown as KVNamespace,
  };
}

describe("allowlist", () => {
  it("parses numeric IDs and ignores junk", () => {
    expect([...parseAllowlist(" 397953, abc, 12 ,0, -4, 1.5")]).toEqual([397953, 12]);
  });
  it("lets nobody in when empty or unset", () => {
    expect(isAllowed("", 397953)).toBe(false);
    expect(isAllowed(undefined, 397953)).toBe(false);
  });
  it("matches only numbers, not numeric strings", () => {
    expect(isAllowed("397953", 397953)).toBe(true);
    expect(isAllowed("397953", "397953")).toBe(false);
    expect(isAllowed("397953", 1)).toBe(false);
  });
});

describe("daily cap", () => {
  it("runs until the limit, then returns an error without executing", async () => {
    const { kv, store } = fakeKv();
    const execute = vi.fn(async () => ({ result: 42 }));
    const capped = withDailyCap({ executor: { execute }, kv, userId: "7", limit: 2, now: () => new Date("2026-11-20T10:00:00Z") });
    expect((await capped.execute("x", [])).result).toBe(42);
    expect((await capped.execute("x", [])).result).toBe(42);
    const third = await capped.execute("x", []);
    expect(third.error).toMatch(/Daily limit of 2/);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(store.get("pondlog:cap:7:2026-11-20")).toBe("2");
  });
  it("counts each user and day separately", async () => {
    const { kv } = fakeKv();
    const execute = vi.fn(async () => ({ result: 1 }));
    let day = "2026-11-20";
    const a = withDailyCap({ executor: { execute }, kv, userId: "a", limit: 1, now: () => new Date(`${day}T00:00:00Z`) });
    const b = withDailyCap({ executor: { execute }, kv, userId: "b", limit: 1, now: () => new Date(`${day}T00:00:00Z`) });
    await a.execute("x", []);
    expect((await a.execute("x", [])).error).toBeDefined();
    expect((await b.execute("x", [])).error).toBeUndefined();
    day = "2026-11-21";
    expect((await a.execute("x", [])).error).toBeUndefined();
  });
  it("parses the limit with a safe fallback", () => {
    expect(parseLimit("50")).toBe(50);
    expect(parseLimit("abc")).toBe(200);
    expect(parseLimit("-1")).toBe(200);
    expect(parseLimit(undefined)).toBe(200);
  });
});

describe("eBird key", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes and rejects malformed keys before any call", () => {
    expect(normalizeKey("  abc123def  ")).toBe("abc123def");
    expect(normalizeKey("has space")).toBeNull();
    expect(normalizeKey("a&b=c")).toBeNull();
    expect(normalizeKey(42)).toBeNull();
  });

  it("checks the key in the header only, never the URL", async () => {
    const calls: { url: string; token: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const token = new Headers(init?.headers).get("x-ebirdapitoken");
      calls.push({ url, token });
      return token === "goodkey1"
        ? new Response(JSON.stringify({ result: "United States" }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("Forbidden", { status: 403 });
    }));
    expect(await checkEbirdKey("goodkey1")).toBe("valid");
    expect(await checkEbirdKey("badkey22")).toBe("invalid");
    expect(calls.every((c) => !c.url.includes("goodkey1") && !c.url.includes("badkey22"))).toBe(true);
    expect(calls.map((c) => c.token)).toContain("goodkey1");
  });
});

describe("pages", () => {
  it("escapes everything a client controls", () => {
    const html = consentPage({ clientName: `<script>x</script>`, clientDomain: `a"b`, redirectHost: "claude.ai", redirectIsLoopback: true }, `h"<`);
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&#60;script&#62;");
    expect(html).toContain("value=\"h&#34;&#60;\"");
    expect(html).toContain("app on your computer");
    expect(escapeHtml(`'&`)).toBe("&#39;&#38;");
  });
  it("never puts a key into the key form", () => {
    const html = ebirdKeyPage("octocat", "eBird did not accept that key.");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/name="ebird_key"[^>]*value=/);
  });
});

describe("pending cookie", () => {
  it("reads only a well-formed handle", () => {
    const req = (cookie: string) => new Request("https://x/", { headers: { Cookie: cookie } });
    expect(readPendingHandle(req(`a=1; ${PENDING_COOKIE}=abcdefghijklmnopqrstuvwxyz012345`))).toBe("abcdefghijklmnopqrstuvwxyz012345");
    expect(readPendingHandle(req(`${PENDING_COOKIE}=short`))).toBeNull();
    expect(readPendingHandle(req(`${PENDING_COOKIE}=bad%20chars%20here%20padding`))).toBeNull();
    expect(readPendingHandle(req("other=1"))).toBeNull();
  });
});

describe("description compaction", () => {
  it("keeps the first sentence, short defaults and tool pointers, drops examples", () => {
    expect(compact("NOAA station id, 6–8 digits. Example: '9444090'. Use `find_tide_stations` to look one up. Optional, when omitted tides are skipped.", 1, 200))
      .toBe("NOAA station id, 6–8 digits. Use `find_tide_stations` to look one up.");
    expect(compact("Window in days. eBird caps this at 30. Default 14.", 1, 200)).toBe("Window in days. Default 14.");
    expect(compact('Region suffix (e.g. "Clallam Co., Washington"). More text.', 1, 200)).toBe('Region suffix (e.g. "Clallam Co., Washington").');
    expect(compact("x".repeat(50), 1, 10)).toHaveLength(10);
    expect(compact(undefined, 1, 10)).toBeUndefined();
  });
  it("prefixes tool references", () => {
    expect(withPrefix("Use `find_tide_stations` or `get_nearby_recent`.", "pondlog")).toBe("Use `pondlog_find_tide_stations` or `pondlog_get_nearby_recent`.");
  });
});

describe("trimmed tool references", () => {
  it("drops sentences that point at a trimmed tool", () => {
    expect(withPrefix("Locale code. Use `get_taxa_locales` to list them.", "ebird")).toBe("Locale code.");
  });
});
