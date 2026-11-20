import { DynamicWorkerExecutor, type Executor } from "@cloudflare/codemode";
import { codeMcpServer } from "@cloudflare/codemode/mcp";
import { createEbirdClient } from "@pondlog/source-ebird";
import { createLegacyMcpHandler } from "agents/mcp";
import { isAllowed } from "./allowlist.js";
import { parseLimit, withDailyCap } from "./cap.js";
import { NO_KEY_MESSAGE } from "./ebird-key.js";
import type { Env, Props } from "./env.js";
import { buildUpstream } from "./upstream.js";

export const CODE_DESCRIPTION = `Run JavaScript against pondlog's nature-data tools: eBird (ebird_*), USGS water data (usgs_*), USA National Phenology Network (npn_*), Mushroom Observer (mo_*), and combined place briefings, tides and night sky (pondlog_*).

Write one async arrow function that calls tools as \`await codemode.<tool>(args)\` and returns what you need. Combine several calls in one run and return only the fields that answer the question, since results are truncated at about 6,000 tokens.

A successful call returns \`{ ok: true, data }\`. A failed call throws an Error whose message is JSON \`{ ok: false, error: { source, message, statusCode? } }\`; wrap calls in try/catch when one failure should not stop the rest. The sandbox has no network access except through these tools.

Plain JavaScript only: no TypeScript syntax, no imports.

Available:
{{types}}

{{example}}`;

/** Builds the per-user MCP server: five upstream servers behind one `code` tool. */
export async function buildCodeServer(options: { ebirdKey: string; executor: Executor }) {
  const ebird = createEbirdClient({
    getApiKey: () => options.ebirdKey,
    missingKeyMessage: NO_KEY_MESSAGE,
  });
  return codeMcpServer({
    server: buildUpstream(ebird),
    executor: options.executor,
    description: CODE_DESCRIPTION,
  });
}

/**
 * The MCP endpoint. OAuthProvider calls this only with a valid token and
 * puts the grant's decrypted props on ctx.props. Nothing here logs props,
 * headers or tool arguments.
 */
export const mcpHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const props = (ctx as ExecutionContext & { props?: Partial<Props> }).props ?? {};
    if (!isAllowed(env.ALLOWED_GITHUB_IDS, props.githubId)) {
      return Response.json({ error: "forbidden", error_description: "This account is not allowed on this server." }, { status: 403 });
    }

    // Sandbox: no bindings, no network (globalOutbound null), 30 s per run.
    // Tool calls go back to this Worker over RPC, so the key never enters it.
    const sandbox = new DynamicWorkerExecutor({ loader: env.LOADER, globalOutbound: null, timeout: 30_000 });
    const executor = withDailyCap({
      executor: sandbox,
      kv: env.OAUTH_KV,
      userId: String(props.githubId),
      limit: parseLimit(env.DAILY_CODE_LIMIT),
    });

    const server = await buildCodeServer({ ebirdKey: typeof props.ebirdKey === "string" ? props.ebirdKey : "", executor });
    return createLegacyMcpHandler(server as never, { route: "/mcp" })(request, env, ctx);
  },
};
