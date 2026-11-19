import { codeMcpServer } from "@cloudflare/codemode/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildUpstream } from "./upstream.js";

const executor = { execute: async () => ({ result: null }) } as never;
const server = await codeMcpServer({ server: buildUpstream(), executor });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: "measure", version: "0" });
await client.connect(b);
const { tools } = await client.listTools();
for (const t of tools) {
  const json = JSON.stringify(t);
  console.log(t.name, "chars:", json.length, "approx tokens:", Math.round(json.length / 3.5));
}
const desc = tools[0]?.description ?? "";
const names = desc.match(/^\s*(\w+)\s*[:(]/gm)?.length;
console.log("methods-ish lines:", names);
await import("node:fs").then((fs) => fs.writeFileSync("/tmp/claude-0/code-tool.txt", desc));
