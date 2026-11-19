import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { codeMcpServer } from "@cloudflare/codemode/mcp";
import { createLegacyMcpHandler } from "agents/mcp";
import { buildUpstream } from "./upstream.js";

interface Env { LOADER: WorkerLoader }

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const server = await codeMcpServer({
      server: buildUpstream(),
      executor: new DynamicWorkerExecutor({ loader: env.LOADER }),
    });
    return createLegacyMcpHandler(server, { route: "/mcp" })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
