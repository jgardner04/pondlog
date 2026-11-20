import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAllTools } from "../src/tools.js";

const TIDES = {
  predictions: [
    { t: "2026-11-21 13:02", v: "8.912", type: "H" },
    { t: "2026-11-21 19:39", v: "0.149", type: "L" },
  ],
};

async function connect(): Promise<Client> {
  const server = new McpServer({ name: "test", version: "0" }, { capabilities: { tools: {} } });
  registerAllTools(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}

type Body = { ok: boolean; data: { tides: unknown; streamflow: unknown; errors: { source: string }[] } };

describe("get_water_conditions", () => {
  beforeEach(() => {
    vi.stubEnv("USGS_SITE", "");
    vi.stubEnv("NOAA_STATION", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(TIDES), { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does not report the source that was left out", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "get_water_conditions", arguments: { noaa_station: "9448614", date: "2026-11-21" } });
    const body = res.structuredContent as Body;
    expect(body.data.tides).not.toBeNull();
    expect(body.data.streamflow).toBeNull();
    expect(body.data.errors).toEqual([]);
  });

  it("explains both missing sources when neither is given", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "get_water_conditions", arguments: {} });
    const body = res.structuredContent as Body;
    expect(body.data.errors.map((e) => e.source).sort()).toEqual(["noaa", "usgs"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says tide times are station-local", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "get_water_conditions")?.description).toMatch(/station's local time/);
  });
});
