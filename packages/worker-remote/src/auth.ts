import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
} from "@cloudflare/workers-oauth-provider";
import { isAllowed } from "./allowlist.js";
import { checkEbirdKey, normalizeKey } from "./ebird-key.js";
import type { Env, Props } from "./env.js";
import { fetchGithubUser, githubAuthorizeUrl, randomToken, s256 } from "./github.js";
import { consentPage, ebirdKeyPage, htmlResponse, messagePage } from "./html.js";
import {
  CLEAR_PENDING_COOKIE,
  MAX_KEY_ATTEMPTS,
  createPending,
  deletePending,
  loadPending,
  readPendingHandle,
  savePending,
} from "./pending.js";

/**
 * Everything that is not the MCP endpoint or an OAuth protocol endpoint:
 * the consent page, the GitHub round trip, and the eBird key form.
 *
 * Order matters for access control: the GitHub allowlist is checked at the
 * callback, before anyone sees the key form.
 */
export const authHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/authorize" && request.method === "GET") return await showConsent(request, env);
      if (url.pathname === "/authorize" && request.method === "POST") return await submitConsent(request, env);
      if (url.pathname === "/callback" && request.method === "GET") return await githubCallback(request, env);
      if (url.pathname === "/ebird-key" && request.method === "POST") return await submitEbirdKey(request, env);
      if (url.pathname === "/" && request.method === "GET") return home(url);
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) {
        return Response.redirect(error.redirectTo, 302);
      }
      if (error instanceof AuthorizationError) {
        return htmlResponse(messagePage("Sign-in could not continue", error.description || "Start connecting again from Claude."), 400);
      }
      if (error instanceof CimdFetchError) {
        return htmlResponse(messagePage("Sign-in could not continue", "This app could not be verified."), 400);
      }
      throw error;
    }
  },
};

function home(url: URL): Response {
  return htmlResponse(
    messagePage(
      "pondlog remote MCP server",
      `Private server. To use it, add ${url.origin}/mcp as a custom connector in Claude and sign in with an allowlisted GitHub account.`,
    ),
  );
}

async function showConsent(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  return htmlResponse(consentPage(details, consent.handle), 200, consent.headers);
}

async function submitConsent(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle);
  const verifier = randomToken(48);
  const { state, headers } = await oauth.beginUpstream(approved.request, {
    data: { verifier },
    headers: approved.headers,
  });
  headers.set(
    "Location",
    githubAuthorizeUrl({
      clientId: env.GITHUB_CLIENT_ID,
      redirectUri: callbackUrl(request),
      state,
      codeChallenge: await s256(verifier),
    }),
  );
  return new Response(null, { status: 302, headers });
}

async function githubCallback(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const url = new URL(request.url);
  const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request);

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) {
    headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
    return new Response(null, { status: 302, headers });
  }

  const user = await fetchGithubUser({
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    code,
    redirectUri: callbackUrl(request),
    codeVerifier: data.verifier,
  });
  if (!user) {
    return htmlResponse(messagePage("GitHub sign-in failed", "GitHub did not confirm who you are. Start connecting again from Claude."), 502, headers);
  }
  if (!isAllowed(env.ALLOWED_GITHUB_IDS, user.id)) {
    return htmlResponse(
      messagePage("Not allowed", "This pondlog server is private. You can deploy your own copy from the pondlog repository."),
      403,
      headers,
    );
  }

  const pending = await createPending(env.OAUTH_KV, { request: original, githubId: user.id, githubLogin: user.login });
  headers.append("Set-Cookie", pending.cookie);
  return htmlResponse(ebirdKeyPage(user.login), 200, headers);
}

async function submitEbirdKey(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const handle = readPendingHandle(request);
  const pending = handle ? await loadPending(env.OAUTH_KV, handle) : null;
  if (!handle || !pending) {
    return htmlResponse(messagePage("This page expired", "Start connecting again from Claude."), 400);
  }
  // Re-check in case the allowlist changed in the last few minutes.
  if (!isAllowed(env.ALLOWED_GITHUB_IDS, pending.githubId)) {
    await deletePending(env.OAUTH_KV, handle);
    return htmlResponse(messagePage("Not allowed", "This pondlog server is private."), 403, clearCookie());
  }

  const form = await request.formData();
  if (form.get("decision") === "cancel") {
    await deletePending(env.OAUTH_KV, handle);
    const headers = clearCookie();
    headers.set("Location", authorizationErrorRedirect(pending.request, "access_denied"));
    return new Response(null, { status: 302, headers });
  }

  const key = normalizeKey(form.get("ebird_key"));
  const check = key ? await checkEbirdKey(key) : "invalid";
  if (check !== "valid" || !key) {
    pending.attempts += 1;
    if (pending.attempts >= MAX_KEY_ATTEMPTS) {
      await deletePending(env.OAUTH_KV, handle);
      return htmlResponse(messagePage("Too many attempts", "Start connecting again from Claude."), 400, clearCookie());
    }
    await savePending(env.OAUTH_KV, handle, pending);
    const message =
      check === "unavailable"
        ? "eBird could not be reached to check that key. Try again in a moment."
        : "eBird did not accept that key. Check it and try again.";
    return htmlResponse(ebirdKeyPage(pending.githubLogin, message), 400);
  }

  await deletePending(env.OAUTH_KV, handle);
  const props: Props = { githubId: pending.githubId, githubLogin: pending.githubLogin, ebirdKey: key };
  const { redirectTo } = await oauth.completeAuthorization({
    request: pending.request,
    userId: String(pending.githubId),
    metadata: { githubLogin: pending.githubLogin },
    scope: pending.request.scope,
    props,
  });
  const headers = clearCookie();
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}/callback`;
}

function clearCookie(): Headers {
  const headers = new Headers();
  headers.append("Set-Cookie", CLEAR_PENDING_COOKIE);
  return headers;
}
