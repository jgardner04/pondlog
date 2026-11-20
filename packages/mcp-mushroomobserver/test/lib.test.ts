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
    expect(tools.map((t) => t.name).sort()).toEqual(["get_observation", "get_recent_fungi", "search_fungal_names", "search_observations", "search_regions"]);
  });
});
