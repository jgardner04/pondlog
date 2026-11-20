import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools, type RegisterToolsOptions } from "./tools.js";

export const SERVER_NAME = "pondlog-mcp-pondlog";
export const SERVER_VERSION = "0.4.0";

export type BuildServerOptions = RegisterToolsOptions;

export function buildServer(options: BuildServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  registerAllTools(server, options);
  return server;
}
