// End-to-end check of the bundled Worker in local workerd (Miniflare).
// GitHub and eBird are mocked through Miniflare's outbound handler, so this
// runs offline. It walks the whole connector flow a Claude client performs:
// register, consent, GitHub, eBird key, token, MCP initialize/list/call.
//
//   pnpm --filter @pondlog/worker-remote e2e
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://pondlog-remote.example.workers.dev";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const GOOD_KEY = "goodkey12345";
const OWNER_ID = 397953;

let githubUserId = OWNER_ID;
const outbound = []; // every URL the Worker or sandbox tried to reach

function outboundHandler(request) {
  const url = new URL(request.url);
  outbound.push({ url: request.url, ebirdHeader: request.headers.get("x-ebirdapitoken") });
  if (url.host === "github.com" && url.pathname === "/login/oauth/access_token") {
    return Response.json({ access_token: "gho_fake", token_type: "bearer" });
  }
  if (url.host === "api.github.com" && url.pathname === "/user") {
    return Response.json({ id: githubUserId, login: githubUserId === OWNER_ID ? "jgardner04" : "stranger" });
  }
  if (url.host === "api.ebird.org") {
    if (request.headers.get("x-ebirdapitoken") !== GOOD_KEY) return new Response("Forbidden", { status: 403 });
    if (url.pathname.startsWith("/v2/ref/region/info/")) {
      return Response.json({ result: "Washington, United States", bounds: { minX: -124.8, maxX: -116.9, minY: 45.5, maxY: 49.0 } });
    }
    return Response.json([]);
  }
  return new Response(`unmocked ${url.host}`, { status: 599 });
}

function makeMf(limit = "200") {
  return new Miniflare(convertV4MiniflareOptions({
    name: "pondlog-remote",
    modules: true,
    scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
    compatibilityDate: "2026-11-01",
    compatibilityFlags: ["nodejs_compat", "nodejs_compat_do_not_populate_process_env", "global_fetch_strictly_public"],
    kvNamespaces: ["OAUTH_KV"],
    workerLoaders: { LOADER: {} },
    bindings: {
      GITHUB_CLIENT_ID: "test-client",
      GITHUB_CLIENT_SECRET: "test-secret",
      ALLOWED_GITHUB_IDS: String(OWNER_ID),
      DAILY_CODE_LIMIT: limit,
    },
    outboundService: outboundHandler,
  }));
}

const b64url = (buf) => buf.toString("base64url");
let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? `\n      ${detail}` : ""}`);
  if (!cond) failures++;
}

class Browser {
  cookies = new Map();
  constructor(mf) { this.mf = mf; }
  async fetch(path, init = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await this.mf.dispatchFetch(path.startsWith("http") ? path : ORIGIN + path, { ...init, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(";");
      const [name, ...v] = pair.split("=");
      if (attrs.some((a) => /max-age=0/i.test(a.trim()))) this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), v.join("="));
    }
    return res;
  }
  form(path, data) {
    return this.fetch(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() });
  }
}

async function register(mf) {
  const res = await mf.dispatchFetch(`${ORIGIN}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  return (await res.json()).client_id;
}

/** Runs consent + GitHub; returns the browser and the response after the callback. */
async function signIn(mf, clientId, verifier) {
  const browser = new Browser(mf);
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "client-state", resource: `${ORIGIN}/mcp` });
  const consent = await browser.fetch(`/authorize?${q}`);
  const html = await consent.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  check("consent page renders with a handle", consent.status === 200 && !!handle, `status ${consent.status}`);
  check("consent page cannot be framed", (consent.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"));
  const approve = await browser.form("/authorize", { handle, decision: "approve" });
  const gh = new URL(approve.headers.get("location") ?? "about:blank");
  check("approve redirects to GitHub with PKCE", gh.host === "github.com" && gh.searchParams.get("code_challenge_method") === "S256" && !!gh.searchParams.get("state"));
  check("GitHub redirect carries no client secret", !approve.headers.get("location").includes("test-secret"));
  const callback = await browser.fetch(`/callback?code=ghcode&state=${encodeURIComponent(gh.searchParams.get("state"))}`);
  return { browser, callback };
}

async function mcp(mf, token, body, sessionHeaders = {}) {
  const res = await mf.dispatchFetch(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2025-06-18", ...sessionHeaders },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const dataLine = text.split("\n").filter((l) => l.startsWith("data:")).pop();
  try {
    return { status: res.status, json: JSON.parse(dataLine ? dataLine.slice(5) : text) };
  } catch {
    return { status: res.status, json: null, text };
  }
}

async function main() {
  const mf = makeMf("3");
  try {
    // 1. Unauthenticated MCP gets the Bearer challenge Claude needs.
    const anon = await mf.dispatchFetch(`${ORIGIN}/mcp`, { method: "POST", body: "{}" });
    check("unauthenticated /mcp returns 401 with resource_metadata", anon.status === 401 && (anon.headers.get("www-authenticate") ?? "").includes("resource_metadata="));

    const clientId = await register(mf);
    check("dynamic client registration works", typeof clientId === "string");

    // 2. A GitHub account outside the allowlist is stopped before the key form.
    githubUserId = 1;
    const stranger = await signIn(mf, clientId, b64url(randomBytes(32)));
    const strangerHtml = await stranger.callback.text();
    check("non-allowlisted GitHub user gets 403", stranger.callback.status === 403);
    check("non-allowlisted user never sees the key form", !strangerHtml.includes("ebird_key"));
    githubUserId = OWNER_ID;

    // 3. Owner signs in, enters a bad key, then a good one.
    const verifier = b64url(randomBytes(32));
    const owner = await signIn(mf, clientId, verifier);
    const ownerHtml = await owner.callback.text();
    check("allowlisted user gets the eBird key form", owner.callback.status === 200 && ownerHtml.includes('name="ebird_key"'));
    const bad = await owner.browser.form("/ebird-key", { ebird_key: "wrongkey999", decision: "save" });
    check("rejected eBird key re-renders the form", bad.status === 400 && (await bad.text()).includes("did not accept"));
    const good = await owner.browser.form("/ebird-key", { ebird_key: GOOD_KEY, decision: "save" });
    const back = new URL(good.headers.get("location") ?? "about:blank");
    check("valid key redirects back to Claude with a code", good.status === 302 && back.origin + back.pathname === REDIRECT && !!back.searchParams.get("code"));
    check("redirect keeps the client's state", back.searchParams.get("state") === "client-state");
    check("redirect URL does not contain the eBird key", !good.headers.get("location").includes(GOOD_KEY));

    // 4. Token exchange, form-encoded like Claude sends it.
    const tokenRes = await mf.dispatchFetch(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: `${ORIGIN}/mcp` }).toString(),
    });
    const tokens = await tokenRes.json();
    check("token endpoint issues access and refresh tokens", !!tokens.access_token && !!tokens.refresh_token, JSON.stringify(tokens));
    check("token response does not contain the eBird key", !JSON.stringify(tokens).includes(GOOD_KEY));

    // 5. MCP over the token.
    const init = await mcp(mf, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } } });
    check("initialize succeeds", init.json?.result?.serverInfo != null, JSON.stringify(init).slice(0, 300));
    const list = await mcp(mf, tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = list.json?.result?.tools ?? [];
    check("exactly one tool, named code", tools.length === 1 && tools[0].name === "code", JSON.stringify(tools.map((t) => t.name)));
    const desc = tools[0]?.description ?? "";
    const toolCount = (desc.match(/^\s+[a-z]+_[a-z0-9_]+: \(/gm) ?? []).length;
    if (process.env.DUMP_DESC) (await import("node:fs")).writeFileSync(process.env.DUMP_DESC, desc);
    console.log(`INFO  code tool description: ${desc.length} chars (~${Math.round(desc.length / 4)} tokens by chars/4), ~${toolCount} tool signatures`);
    check("trimmed tools are absent", !/ebird_get_taxa_locales|pondlog_get_phenology|npn_get_station_count_by_state/.test(desc));
    check("find_tide_stations is present", desc.includes("pondlog_find_tide_stations"));
    check("description does not contain the eBird key", !desc.includes(GOOD_KEY));

    const call = (id, code) => mcp(mf, tokens.access_token, { jsonrpc: "2.0", id, method: "tools/call", params: { name: "code", arguments: { code } } });

    outbound.length = 0;
    const region = await call(3, `async () => { const r = await codemode.ebird_get_region_info({ region_code: "US-WA" }); return r; }`);
    const regionText = region.json?.result?.content?.[0]?.text ?? "";
    check("code run reaches eBird with the user's key", regionText.includes("Washington") && region.json?.result?.isError !== true, regionText.slice(0, 300));
    const ebirdCalls = outbound.filter((o) => o.url.includes("api.ebird.org"));
    check("eBird call carried the key in the header", ebirdCalls.length > 0 && ebirdCalls.every((o) => o.ebirdHeader === GOOD_KEY));
    check("eBird key never appears in an outbound URL", outbound.every((o) => !o.url.includes(GOOD_KEY)));
    check("code result does not contain the eBird key", !regionText.includes(GOOD_KEY));

    const sandboxFetch = await call(4, `async () => { try { await fetch("https://example.com/"); return "reached network"; } catch (e) { return "blocked"; } }`);
    check("sandbox has no network access", (sandboxFetch.json?.result?.content?.[0]?.text ?? "").includes("blocked"), JSON.stringify(sandboxFetch.json).slice(0, 300));

    const sandboxEnv = await call(5, `async () => JSON.stringify({ env: typeof env, process: typeof process === "undefined" ? "none" : JSON.stringify(process.env ?? {}) })`);
    const envText = sandboxEnv.json?.result?.content?.[0]?.text ?? "";
    check("sandbox sees no key or secrets", !envText.includes(GOOD_KEY) && !envText.includes("test-secret"), envText.slice(0, 300));

    // Limit is 3 for this run: calls 3, 4, 5 used it up.
    const capped = await call(6, `async () => 1`);
    check("daily cap stops the fourth run", capped.json?.result?.isError === true && (capped.json?.result?.content?.[0]?.text ?? "").includes("Daily limit"), JSON.stringify(capped.json).slice(0, 300));

    // 6. Refresh keeps the key in props.
    const refreshed = await (await mf.dispatchFetch(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }).toString(),
    })).json();
    check("refresh token works", !!refreshed.access_token, JSON.stringify(refreshed));
  } finally {
    await mf.dispose();
  }

  // 7. A shared key binding stops the Worker from serving.
  const bad = new Miniflare(convertV4MiniflareOptions({
    name: "pondlog-remote",
    modules: true,
    scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
    compatibilityDate: "2026-11-01",
    compatibilityFlags: ["nodejs_compat", "nodejs_compat_do_not_populate_process_env", "global_fetch_strictly_public"],
    kvNamespaces: ["OAUTH_KV"],
    workerLoaders: { LOADER: {} },
    bindings: { GITHUB_CLIENT_ID: "x", GITHUB_CLIENT_SECRET: "y", ALLOWED_GITHUB_IDS: "1", EBIRD_API_KEY: "shared" },
  }));
  try {
    const res = await bad.dispatchFetch(`${ORIGIN}/`);
    check("EBIRD_API_KEY binding makes the Worker refuse to serve", res.status === 500);
  } finally {
    await bad.dispose();
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
