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
    expect(tools.map((t) => t.name).sort()).toEqual(["get_nature_briefing", "get_nearby_wildlife", "get_phenology", "get_tonight_sky", "get_water_conditions"]);
  });
});

describe("injected eBird client", () => {
  async function schemaKeys(options: Parameters<typeof import("../src/lib.js").buildServer>[0]) {
    const { buildServer } = await import("../src/lib.js");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(options).connect(a);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(b);
    const { tools } = await client.listTools();
    return Object.fromEntries(
      tools.map((t) => [t.name, { props: Object.keys(t.inputSchema.properties ?? {}), description: t.description ?? "" }]),
    );
  }

  it("offers the ebird_api_key input only when no client is injected", async () => {
    const { createEbirdClient } = await import("@pondlog/source-ebird");
    const plain = await schemaKeys({});
    const injected = await schemaKeys({ ebird: createEbirdClient({ getApiKey: () => "k" }) });
    for (const name of ["get_nature_briefing", "get_nearby_wildlife"]) {
      expect(plain[name]!.props).toContain("ebird_api_key");
      expect(injected[name]!.props).not.toContain("ebird_api_key");
      expect(injected[name]!.description).not.toContain("ebird_api_key");
    }
  });

  it("get_nearby_wildlife uses the injected client's key", async () => {
    const { buildServer } = await import("../src/lib.js");
    const { createEbirdClient } = await import("@pondlog/source-ebird");
    const ebirdKeys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).includes("ebird.org")) {
          ebirdKeys.push((init?.headers as Record<string, string>)["X-eBirdApiToken"] ?? "");
        }
        return new Response("[]", { status: 200 });
      }),
    );
    try {
      const [a, b] = InMemoryTransport.createLinkedPair();
      await buildServer({ ebird: createEbirdClient({ getApiKey: () => "user-key" }) }).connect(a);
      const client = new Client({ name: "test", version: "0" });
      await client.connect(b);
      await client.callTool({
        name: "get_nearby_wildlife",
        arguments: { lat: 48.1, lng: -123.4, ebird_api_key: "ignored-input" },
      });
      expect(ebirdKeys).toEqual(["user-key"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
