import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limiterForKey } from "../src/client.js";
import { createEbirdClient, getNearbyRecent } from "../src/index.js";

const OBS = [
  {
    speciesCode: "amecro",
    comName: "American Crow",
    sciName: "Corvus brachyrhynchos",
    locId: "L1",
    locName: "Somewhere",
    obsDt: "2026-05-07 09:30",
    howMany: 1,
    lat: 48.1,
    lng: -123.4,
    obsValid: true,
    obsReviewed: false,
    locationPrivate: false,
    subId: "S1",
  },
];

function headerKey(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.["X-eBirdApiToken"];
}

describe("eBird key injection", () => {
  const fetchMock = vi.fn();
  const savedEnv = process.env.EBIRD_API_KEY;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(OBS), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.EBIRD_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedEnv === undefined) delete process.env.EBIRD_API_KEY;
    else process.env.EBIRD_API_KEY = savedEnv;
  });

  it("sends each client's own key when calls run concurrently", async () => {
    // Responses resolve in reverse order so the calls overlap.
    let delay = 30;
    fetchMock.mockImplementation(async () => {
      delay -= 10;
      await new Promise((r) => setTimeout(r, delay));
      return new Response(JSON.stringify(OBS), { status: 200 });
    });
    const alice = createEbirdClient({ getApiKey: () => "key-alice" });
    const bob = createEbirdClient({ getApiKey: () => "key-bob" });

    const [a, b] = await Promise.all([
      alice.getNearbyRecent(48.1, -123.4),
      bob.getNearbyRecent(48.1, -123.4),
    ]);

    expect(a.ok && b.ok).toBe(true);
    const sent = fetchMock.mock.calls.map(([, init]) => headerKey(init));
    expect(sent.sort()).toEqual(["key-alice", "key-bob"]);
  });

  it("default functions read EBIRD_API_KEY on every call", async () => {
    process.env.EBIRD_API_KEY = "env-one";
    await getNearbyRecent(48.1, -123.4);
    process.env.EBIRD_API_KEY = "env-two";
    await getNearbyRecent(48.1, -123.4);
    expect(fetchMock.mock.calls.map(([, init]) => headerKey(init))).toEqual(["env-one", "env-two"]);
  });

  it("an explicit key provider never falls back to the environment", async () => {
    process.env.EBIRD_API_KEY = "env-key";
    const client = createEbirdClient({
      getApiKey: () => undefined,
      missingKeyMessage: "No eBird key on this connection.",
    });

    const result = await client.getNearbyRecent(48.1, -123.4);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.source).toBe("ebird");
      expect(result.error.message).toBe("No eBird key on this connection.");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the existing missing-key error when no key is set", async () => {
    const result = await getNearbyRecent(48.1, -123.4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/EBIRD_API_KEY environment variable is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trims the provided key", async () => {
    const client = createEbirdClient({ getApiKey: () => "  spaced  " });
    await client.getNearbyRecent(48.1, -123.4);
    expect(headerKey(fetchMock.mock.calls[0]?.[1])).toBe("spaced");
  });

  it("never puts the key in the request URL", async () => {
    const client = createEbirdClient({ getApiKey: () => "secret-key" });
    await client.getNearbyRecent(48.1, -123.4);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("secret-key");
  });
});

describe("per-key rate limiting", () => {
  it("gives each key its own limiter and reuses it for the same key", () => {
    const a = limiterForKey("limiter-a");
    expect(limiterForKey("limiter-a")).toBe(a);
    expect(limiterForKey("limiter-b")).not.toBe(a);
  });

  it("one key exhausting its budget does not block another key", async () => {
    const busy = limiterForKey("busy-key");
    for (let i = 0; i < 100; i++) await busy.acquire();
    const other = limiterForKey("idle-key");
    const acquired = await Promise.race([
      other.acquire().then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 50)),
    ]);
    expect(acquired).toBe(true);
  });

  it("evicts the least recently used limiter beyond the cap", () => {
    const first = limiterForKey("evict-first");
    for (let i = 0; i < 500; i++) limiterForKey(`evict-filler-${i}`);
    expect(limiterForKey("evict-first")).not.toBe(first);
  });
});
