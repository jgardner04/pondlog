import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetTideStationCache } from "@pondlog/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAllTools } from "../src/tools.js";

const STATIONS = {
  stations: [
    { id: "9448614", name: "Deception Pass St. Park, Bowman Bay, Fidalgo I.", lat: 48.415, lng: -122.652, type: "R", state: "WA" },
    { id: "9447995", name: "Cornet Bay, Whidbey Island, Deception Pass", lat: 48.4017, lng: -122.623, type: "S", state: "WA" },
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

describe("find_tide_stations tool", () => {
  beforeEach(() => {
    resetTideStationCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(STATIONS), { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is listed", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("find_tide_stations");
  });

  it("returns the nearest stations", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "find_tide_stations",
      arguments: { lat: 48.406, lng: -122.643, limit: 1 },
    });
    expect(res.isError).toBeFalsy();
    const body = res.structuredContent as { ok: boolean; data: { id: string; kind: string }[] };
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: "9448614", kind: "reference" });
  });
});
