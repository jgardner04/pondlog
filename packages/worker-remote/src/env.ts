import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  LOADER: WorkerLoader;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_GITHUB_IDS: string;
  DAILY_CODE_LIMIT?: string;
}

/** What the grant stores, encrypted, and hands the MCP handler as ctx.props. */
export interface Props extends Record<string, unknown> {
  githubId: number;
  githubLogin: string;
  ebirdKey: string;
}
