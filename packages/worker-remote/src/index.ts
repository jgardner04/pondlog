import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { authHandler } from "./auth.js";
import type { Env } from "./env.js";
import { mcpHandler } from "./mcp.js";

/**
 * One provider per origin, so the resource URL in OAuth metadata matches
 * whatever hostname the Worker is served on (workers.dev, a custom domain,
 * or localhost under `wrangler dev`) without hard-coding it.
 */
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpHandler as never,
      defaultHandler: authHandler as never,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/register",
      clientIdMetadataDocumentEnabled: true,
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "pondlog" },
      // A grant lasts up to 90 days and ends after 30 idle days; reconnecting
      // asks for the eBird key again.
      refreshTokenTTL: 60 * 60 * 24 * 90,
      refreshTokenIdleTTL: 60 * 60 * 24 * 30,
    });
    if (providers.size > 8) providers.clear();
    providers.set(origin, provider);
  }
  return provider;
}

/**
 * Refuses to serve if a shared eBird key was ever bound to the Worker.
 * Every user brings their own key; there is no shared key.
 */
export function assertNoSharedKey(env: Record<string, unknown>): void {
  if ("EBIRD_API_KEY" in env) {
    throw new Error("EBIRD_API_KEY must not be bound to this Worker. Remove it with `wrangler secret delete EBIRD_API_KEY`.");
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    try {
      assertNoSharedKey(env as unknown as Record<string, unknown>);
    } catch {
      return new Response("Server misconfigured: a shared eBird key is bound. See the README.", { status: 500 });
    }
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
