import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createEbirdClient, type EbirdClient } from "@pondlog/source-ebird";
import { registerHotspotTools } from "./tools/hotspots.js";
import { registerObservationTools } from "./tools/observations.js";
import { registerProductTools } from "./tools/product.js";
import { registerRegionTools } from "./tools/regions.js";
import { registerTaxonomyTools } from "./tools/taxonomy.js";

export interface RegisterToolsOptions {
  /**
   * eBird client the tools call. Defaults to one that reads
   * `process.env.EBIRD_API_KEY` on every call. Pass
   * `createEbirdClient({ getApiKey })` to serve each caller with their own key.
   */
  ebird?: EbirdClient;
}

export function registerAllTools(server: McpServer, options: RegisterToolsOptions = {}): void {
  const ebird = options.ebird ?? createEbirdClient();
  registerObservationTools(server, ebird);
  registerProductTools(server, ebird);
  registerHotspotTools(server, ebird);
  registerTaxonomyTools(server, ebird);
  registerRegionTools(server, ebird);
}
