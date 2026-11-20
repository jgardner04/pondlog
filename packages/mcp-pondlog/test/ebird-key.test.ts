import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ebirdFor } from "../src/briefing.js";

function keyOf(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.["X-eBirdApiToken"];
}

describe("ebirdFor", () => {
  const fetchMock = vi.fn();
  const savedEnv = process.env.EBIRD_API_KEY;

  beforeEach(() => {
    let delay = 30;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => {
      delay = Math.max(0, delay - 10);
      await new Promise((r) => setTimeout(r, delay));
      return new Response("[]", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.EBIRD_API_KEY = "env-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedEnv === undefined) delete process.env.EBIRD_API_KEY;
    else process.env.EBIRD_API_KEY = savedEnv;
  });

  it("keeps overlapping calls with different keys apart", async () => {
    await Promise.all([
      ebirdFor("key-one").getNearbyRecentNormalized(48.1, -123.4),
      ebirdFor("key-two").getNearbyRecentNormalized(48.1, -123.4),
      ebirdFor(undefined).getNearbyRecentNormalized(48.1, -123.4),
    ]);
    const sent = fetchMock.mock.calls.map(([, init]) => keyOf(init)).sort();
    expect(sent).toEqual(["env-key", "key-one", "key-two"]);
  });

  it("never writes the per-call key into process.env", async () => {
    const pending = ebirdFor("call-key").getNearbyRecentNormalized(48.1, -123.4);
    expect(process.env.EBIRD_API_KEY).toBe("env-key");
    await pending;
    expect(process.env.EBIRD_API_KEY).toBe("env-key");
  });

  it("treats a blank key as absent and uses the environment", async () => {
    await ebirdFor("   ").getNearbyRecentNormalized(48.1, -123.4);
    expect(keyOf(fetchMock.mock.calls[0]?.[1])).toBe("env-key");
  });
});
