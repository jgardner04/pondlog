# @pondlog/worker-remote (fork-only)

pondlog's five MCP servers (`mcp-pondlog`, `mcp-ebird`, `mcp-usgs`, `mcp-npn`, `mcp-mushroomobserver`) as one Cloudflare Worker that you can add to Claude as a custom connector. Claude sees a single Code Mode tool, `code`. Inside it, Claude writes JavaScript that calls the tools as `codemode.<prefix>_<tool>(...)`, with these prefixes: `pondlog_`, `ebird_`, `usgs_`, `npn_` and `mo_`.

The server is private:

- **Access.** Users sign in with GitHub, and only the GitHub user IDs listed in `ALLOWED_GITHUB_IDS` get past the callback. Everyone else gets a 403 before they see the eBird key form.
- **eBird keys.** Each user brings their own key. It is checked against eBird once, stored encrypted in the OAuth grant, and sent only to eBird in the `X-eBirdApiToken` header. There is no shared key. If an `EBIRD_API_KEY` binding exists, the Worker refuses to serve.
- **Sandbox.** The `code` sandbox runs in a Dynamic Worker with no bindings and no network. Tool calls go back to this Worker over RPC, so the key never enters the sandbox.
- **Daily cap.** Each user gets `DAILY_CODE_LIMIT` `code` runs per UTC day (default 200).

## Deploy your own copy

You need:

- a Cloudflare account on Workers Paid (Dynamic Workers run the sandbox);
- Node 20 or later and pnpm 11;
- a GitHub account.

1. **Build the workspace.**

   ```sh
   pnpm install
   pnpm build
   cd packages/worker-remote
   npx wrangler login
   ```

2. **Create the KV namespace** that holds OAuth grants, the sign-in state and the daily counters:

   ```sh
   npx wrangler kv namespace create OAUTH_KV
   ```

   Put the printed `id` into `wrangler.jsonc` in place of `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

3. **Find your Worker URL.** It is `https://pondlog-remote.<your-subdomain>.workers.dev`. Your subdomain is shown on the Workers & Pages overview in the Cloudflare dashboard.

4. **Create a GitHub OAuth app** at <https://github.com/settings/applications/new>:
   - Homepage URL: `https://pondlog-remote.<your-subdomain>.workers.dev`
   - Authorization callback URL: `https://pondlog-remote.<your-subdomain>.workers.dev/callback`

   Then generate a client secret. The Worker asks GitHub for no scopes; it reads only your public user ID and discards GitHub's token right away.

5. **Set the secrets.** Run these on your own machine and paste each value when prompted:

   ```sh
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

6. **Allowlist yourself.** In `wrangler.jsonc`, set `ALLOWED_GITHUB_IDS` to your numeric GitHub ID, which is the `id` field at `https://api.github.com/users/<your-login>`. To allow several people, separate the IDs with commas.

7. **Deploy:**

   ```sh
   npx wrangler deploy
   ```

8. **Add the connector in Claude.** In claude.ai, go to **Customize > Connectors** and choose **Add custom connector**. Give it a name, and set the URL to `https://pondlog-remote.<your-subdomain>.workers.dev/mcp`. For the OAuth client, keep the default: either Claude's published identity or automatic registration works, since the Worker supports both. You don't need a client ID or secret. Click **Add**, then **Connect**. The sign-in flow is:
   1. A consent page.
   2. GitHub sign-in.
   3. The eBird key form. You can get a free key at <https://ebird.org/api/keygen>.
   4. Back to Claude.

   Connectors are tied to your Claude account, not to one app. See [Get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

To change your eBird key, disconnect the connector and connect it again. A grant lasts at most 90 days, and it ends sooner if it goes unused for 30 days.

## Develop and test

```sh
pnpm --filter @pondlog/worker-remote test   # unit tests (node)
pnpm --filter @pondlog/worker-remote e2e    # bundles, then runs the whole connector flow in local workerd
```

The e2e script mocks GitHub and eBird through Miniflare's outbound handler, so it runs offline. It walks through:

- client registration;
- consent;
- GitHub sign-in, including a rejected non-allowlisted user;
- the eBird key form, with a bad key and then a good one;
- the token exchange;
- MCP `initialize`, `tools/list` and `tools/call`;
- the sandbox's lack of network access;
- the daily cap;
- token refresh;
- the shared-key guard.

It also prints the size of the `code` tool's description.

`npx wrangler dev` runs the Worker locally. It reads `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from a `.dev.vars` file, which is gitignored. A real GitHub sign-in against localhost needs a second OAuth app whose callback is `http://localhost:8787/callback`.

## What is left out

The Worker removes a few tools to keep the `code` tool's description small:

- `pondlog_get_phenology` (the `npn_*` tools cover it);
- `ebird_get_taxonomy_versions`;
- `ebird_get_taxa_locales`;
- `ebird_get_taxonomic_forms`;
- `ebird_get_adjacent_regions`;
- `npn_get_station_count_by_state`.

It also shortens tool and parameter descriptions. See `TRIMMED_TOOLS` and `compact()` in `src/upstream.ts`.
