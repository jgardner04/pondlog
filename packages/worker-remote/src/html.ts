export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const STYLE = `
  :root { color-scheme: light dark; --fg:#1d2320; --bg:#f7f8f6; --muted:#5b6660; --accent:#2f6f4f; --card:#fff; --border:#d7ddd9; --err:#a32020; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e6ebe8; --bg:#121614; --muted:#9aa6a0; --accent:#6cc296; --card:#1b201d; --border:#2c3430; --err:#ff8a80; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:32rem; margin:3rem auto; padding:0 16px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:1.5rem; }
  h1 { font-size:1.35rem; margin:0 0 1rem; }
  p { margin:0 0 1rem; }
  .muted { color:var(--muted); font-size:.92rem; }
  .err { color:var(--err); font-weight:600; }
  label { display:block; font-weight:600; margin-bottom:.35rem; }
  input[type=password] { width:100%; padding:.6rem .7rem; font:inherit; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--fg); }
  .row { display:flex; gap:.75rem; margin-top:1.25rem; flex-wrap:wrap; }
  button { font:inherit; padding:.6rem 1.1rem; border-radius:8px; border:1px solid var(--border); background:transparent; color:var(--fg); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  a { color:var(--accent); }
`;

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main><div class="card">${body}</div></main></body></html>`;
}

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function htmlResponse(html: string, status = 200, extra?: Headers): Response {
  const headers = new Headers(extra);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(html, { status, headers });
}

export interface ConsentFacts {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
}

export function consentPage(facts: ConsentFacts, handle: string): string {
  const name = escapeHtml(facts.clientName);
  const origin = facts.clientDomain
    ? `Published by <strong>${escapeHtml(facts.clientDomain)}</strong>.`
    : "This app registered itself, so its name is not verified.";
  const loopback = facts.redirectIsLoopback
    ? `<p class="err">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>`
    : "";
  return page(
    "Connect pondlog",
    `<h1>Connect ${name} to pondlog?</h1>
<p>${origin} Access will be sent to <strong>${escapeHtml(facts.redirectHost)}</strong>.</p>
${loopback}
<p class="muted">Next you sign in with GitHub. Only allowlisted GitHub accounts can use this server. After that you add your own eBird API key.</p>
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <div class="row">
    <button class="primary" name="decision" value="approve">Continue with GitHub</button>
    <button name="decision" value="deny">Cancel</button>
  </div>
</form>`,
  );
}

export function ebirdKeyPage(login: string, error?: string): string {
  return page(
    "Add your eBird key",
    `<h1>Add your eBird API key</h1>
<p>Signed in as <strong>${escapeHtml(login)}</strong>.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<p class="muted">Your key is stored encrypted with this connection and sent only to eBird, in a request header. Get a free key at <a href="https://ebird.org/api/keygen" rel="noreferrer" target="_blank">ebird.org/api/keygen</a>.</p>
<form method="post" action="/ebird-key" autocomplete="off">
  <label for="ebird_key">eBird API key</label>
  <input id="ebird_key" name="ebird_key" type="password" required minlength="6" maxlength="64" spellcheck="false" autocapitalize="off">
  <div class="row">
    <button class="primary" name="decision" value="save">Save and finish</button>
    <button name="decision" value="cancel" formnovalidate>Cancel</button>
  </div>
</form>`,
  );
}

export function messagePage(title: string, message: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}
