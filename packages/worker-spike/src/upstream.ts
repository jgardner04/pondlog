import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools as pondlog } from "../../mcp-pondlog/src/tools.js";
import { registerAllTools as ebird } from "../../mcp-ebird/src/tools.js";
import { registerAllTools as usgs } from "../../mcp-usgs/src/tools.js";
import { registerAllTools as npn } from "../../mcp-npn/src/tools.js";
import { registerAllTools as mo } from "../../mcp-mushroomobserver/src/tools.js";

const SKIP = new Set(["pondlog_get_phenology"]);

function prefixed(server: McpServer, prefix: string): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (name: string, ...rest: unknown[]) => {
          const full = `${prefix}_${name}`;
          if (SKIP.has(full)) return undefined;
          return (target.registerTool as (...a: unknown[]) => unknown)(full, ...rest);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function buildUpstream(): McpServer {
  const server = new McpServer(
    { name: "pondlog-remote", version: "0.0.0-spike" },
    { capabilities: { tools: {} } },
  );
  pondlog(prefixed(server, "pondlog"));
  ebird(prefixed(server, "ebird"));
  usgs(prefixed(server, "usgs"));
  npn(prefixed(server, "npn"));
  mo(prefixed(server, "mo"));
  return server;
}
