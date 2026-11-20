/**
 * GitHub sign-in, used only to learn who the person is. The Worker asks for
 * no scopes (public profile only) and discards GitHub's token right after
 * reading the user's numeric ID.
 */

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const USER_AGENT = "pondlog-remote";

export interface GithubUser {
  id: number;
  login: string;
}

export function githubAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * Exchanges GitHub's code for a token and returns the signed-in user, or
 * null when GitHub refuses. The client secret travels only in the POST body.
 */
export async function fetchGithubUser(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetcher?: typeof fetch;
}): Promise<GithubUser | null> {
  const doFetch = options.fetcher ?? fetch;
  const tokenRes = await doFetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier,
    }),
  });
  if (!tokenRes.ok) return null;
  const token = (await tokenRes.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!token || typeof token.access_token !== "string") return null;

  const userRes = await doFetch(USER_URL, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
  });
  if (!userRes.ok) return null;
  const user = (await userRes.json().catch(() => null)) as { id?: unknown; login?: unknown } | null;
  if (!user || typeof user.id !== "number" || typeof user.login !== "string") return null;
  return { id: user.id, login: user.login };
}
