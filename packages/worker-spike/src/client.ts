import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const url = new URL(process.argv[2] ?? "http://localhost:8798/mcp");
const c = new Client({ name: "spike", version: "0" });
const t = new StreamableHTTPClientTransport(url);
await c.connect(t);
console.log("session:", t.sessionId);
const { tools } = await c.listTools();
console.log("tools:", tools.map((x) => x.name));
const code = `async () => {
  const sky = await codemode.pondlog_get_tonight_sky({ lat: 48.406, lng: -122.643, date: "2026-11-21" });
  let bad; try { await codemode.ebird_get_nearby_notable({ lat: 48.406, lng: -122.643 }); } catch (e) { bad = String(e).slice(0, 200); }
  let invalid; try { await codemode.pondlog_get_tonight_sky({ lat: 999, lng: 0 }); } catch (e) { invalid = String(e).slice(0, 200); }
  let net; try { await fetch("https://example.com"); net = "fetch allowed"; } catch (e) { net = "fetch blocked: " + String(e).slice(0, 80); }
  return { keys: Object.keys(sky), sun: sky.sun ?? sky.data?.sun, bad, invalid, net };
}`;
for (let i = 0; i < 2; i++) {
  const r = await c.callTool({ name: "code", arguments: { code } });
  console.log(`call ${i}:`, JSON.stringify(r).slice(0, 1500));
}
await c.close();
