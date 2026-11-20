import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

describe("library entry", () => {
  it("imports without starting a transport or exiting", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const stdinListeners = process.stdin.listenerCount("data");
    try {
      const lib = await import("../src/lib.js");
      expect(typeof lib.buildServer).toBe("function");
      expect(typeof lib.registerAllTools).toBe("function");
      expect(process.stdin.listenerCount("data")).toBe(stdinListeners);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it("buildServer() exposes the same tools as the stdio binary", async () => {
    const { buildServer } = await import("../src/lib.js");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer().connect(a);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(b);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_adjacent_regions", "get_checklist", "get_historic_on_date", "get_hotspot_info", "get_hotspots_in_region", "get_nearby_hotspots", "get_nearby_notable", "get_nearby_of_species", "get_nearby_recent", "get_recent_checklists", "get_recent_notable", "get_recent_observations", "get_recent_of_species", "get_region_info", "get_sub_regions", "get_taxa_locales", "get_taxonomic_forms", "get_taxonomic_groups", "get_taxonomy", "get_taxonomy_versions", "get_top_100"]);
  });
});

describe("injected eBird client", () => {
  it("tools call the injected client instead of reading the environment", async () => {
    const { buildServer } = await import("../src/lib.js");
    const { createEbirdClient } = await import("@pondlog/source-ebird");
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      calls.push((init?.headers as Record<string, string>)["X-eBirdApiToken"] ?? "");
      return new Response("[]", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const saved = process.env.EBIRD_API_KEY;
    process.env.EBIRD_API_KEY = "env-key";
    try {
      const server = buildServer({ ebird: createEbirdClient({ getApiKey: () => "user-key" }) });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a);
      const client = new Client({ name: "test", version: "0" });
      await client.connect(b);
      const res = await client.callTool({ name: "get_nearby_recent", arguments: { lat: 48.1, lng: -123.4 } });
      expect(res.isError).toBeFalsy();
      expect(calls).toEqual(["user-key"]);
    } finally {
      vi.unstubAllGlobals();
      if (saved === undefined) delete process.env.EBIRD_API_KEY;
      else process.env.EBIRD_API_KEY = saved;
    }
  });
});
