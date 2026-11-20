import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createEbirdClient } from "@pondlog/source-ebird";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_KEY_MESSAGE } from "../src/ebird-key.js";
import { TRIMMED_TOOLS, buildUpstream } from "../src/upstream.js";

async function connect(key: string) {
  const ebird = createEbirdClient({ getApiKey: () => key, missingKeyMessage: NO_KEY_MESSAGE });
  const server = buildUpstream(ebird);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(clientT);
  return client;
}

describe("upstream server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("exposes all five servers, prefixed, without the trimmed tools", async () => {
    const { tools } = await (await connect("k")).listTools();
    const names = tools.map((t) => t.name);
    for (const prefix of ["pondlog_", "ebird_", "usgs_", "npn_", "mo_"]) {
      expect(names.some((n) => n.startsWith(prefix))).toBe(true);
    }
    for (const trimmed of TRIMMED_TOOLS) expect(names).not.toContain(trimmed);
    expect(new Set(names).size).toBe(names.length);
  });

  it("hides the per-call ebird_api_key input, since the key comes from the connection", async () => {
    const { tools } = await (await connect("k")).listTools();
    for (const tool of tools) {
      expect(Object.keys((tool.inputSchema.properties ?? {}) as object)).not.toContain("ebird_api_key");
    }
  });

  it("sends the connection's key, ignoring EBIRD_API_KEY in the environment", async () => {
    vi.stubEnv("EBIRD_API_KEY", "shared-env-key");
    const tokens: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      tokens.push(new Headers(init?.headers).get("x-ebirdapitoken"));
      return new Response(JSON.stringify({ result: "Washington" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const client = await connect("userkey123");
    const result = await client.callTool({ name: "ebird_get_region_info", arguments: { region_code: "US-WA" } });
    expect(result.isError).toBeFalsy();
    expect(tokens).toEqual(["userkey123"]);
  });

  it("explains how to add a key when the connection has none", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = await connect("");
    const result = await client.callTool({ name: "ebird_get_region_info", arguments: { region_code: "US-WA" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Reconnect the connector");
    expect(fetch).not.toHaveBeenCalled();
  });
});
