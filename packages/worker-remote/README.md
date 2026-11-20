# @pondlog/worker-remote

pondlog's five MCP servers (`mcp-pondlog`, `mcp-ebird`, `mcp-usgs`, `mcp-npn`, `mcp-mushroomobserver`) as one Cloudflare Worker that you can add to Claude as a custom connector. Claude sees a single Code Mode tool, `code`. Inside it, Claude writes JavaScript that calls the tools as `codemode.<prefix>_<tool>(...)`, with these prefixes: `pondlog_`, `ebird_`, `usgs_`, `npn_` and `mo_`.

This package is not published to npm. Each person deploys their own copy to their own Cloudflare account.

Each deployment is private:

- **Access.** Users sign in with GitHub, and only the GitHub user IDs listed in `ALLOWED_GITHUB_IDS` get past the callback. Everyone else gets a 403 before they see the eBird key form. The list is empty by default, so nobody can sign in until you add yourself.
- **eBird keys.** Each user brings their own key. It is checked against eBird once, stored encrypted in the OAuth grant, and sent only to eBird in the `X-eBirdApiToken` header. There is no shared key. If an `EBIRD_API_KEY` binding exists, the Worker refuses to serve.
- **Sandbox.** The `code` sandbox runs in a Dynamic Worker with no bindings and no network. Tool calls go back to this Worker over RPC, so the key never enters the sandbox.
- **Daily cap.** Each user gets `DAILY_CODE_LIMIT` `code` runs per UTC day (default 200).

## Deploy your own copy

You need:

- a Cloudflare account on Workers Paid (Dynamic Workers run the sandbox);
- Node 20 or later and pnpm 11;
- a GitHub account.

### First deploy

You do this once.

1. **Build the workspace.**

   ```sh
   pnpm install
   pnpm build:worker
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

   Then generate a client secret. The Worker asks GitHub for no scopes. It reads only your public user ID and discards GitHub's token right away.

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

   `wrangler deploy` bundles whatever is in each package's `dist/` folder at that moment. If you have pulled changes since your last build, run `pnpm build:worker` from the repo root first, or the deploy ships old code.

8. **Add the connector in Claude.** In claude.ai, go to **Customize > Connectors** and choose **Add custom connector**. Give it a name, and set the URL to `https://pondlog-remote.<your-subdomain>.workers.dev/mcp`. You don't need a client ID or secret, so keep the default OAuth client setting: the Worker supports both Claude's published identity and automatic registration. Click **Add**, then **Connect**. The sign-in flow is:
   1. A consent page.
   2. GitHub sign-in.
   3. The eBird key form. You can get a free key at <https://ebird.org/api/keygen>.
   4. Back to Claude.

   Connectors are tied to your Claude account, not to one app, so the connector also works on mobile. See [Get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### Later deploys (Cloudflare Workers Builds)

After the first deploy, let Cloudflare build and deploy from Git, so each deploy starts from a clean checkout and stale `dist/` folders can't ship. Set it up once in the Cloudflare dashboard:

1. Open the `pondlog-remote` Worker, then go to **Settings > Build** and connect your repository.
2. Set **Git branch** to the branch you deploy from.
3. Leave **Root directory** empty, which means the repo root. The pnpm lockfile and the `packageManager` field live at the root.
4. Set **Build command** to `pnpm install --frozen-lockfile && pnpm build:worker`.
5. Set **Deploy command** to `pnpm deploy:worker`.

Keep `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as Worker secrets under **Settings > Variables & Secrets**. Builds never see them.

Once this is set up, every push to that branch is a deploy. To review each change before it goes live, protect the branch on GitHub: require a pull request, and require a check that runs `pnpm build`, `pnpm typecheck`, `pnpm test` and `pnpm --filter @pondlog/worker-remote e2e`.

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

It also prints the size of the `code` tool's description. Set `DUMP_DESC=/path/to/file` to write the full description out.

`npx wrangler dev` runs the Worker locally. It reads `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from a `.dev.vars` file, which is gitignored. A real GitHub sign-in against localhost needs a second OAuth app whose callback is `http://localhost:8787/callback`.

## Adding or changing a tool

The Worker registers every tool from the five servers, so a new tool in any of them shows up here after the next build. The `code` tool's description is sent with every request, so it is kept small:

- `src/describe.ts` lists each tool as one line, `codemode.<name>(args: { key?: type /* note */ })`, with each parameter note shown once and capped at 110 characters.
- `compact()` in `src/upstream.ts` keeps the first sentence or two of each tool and parameter description.
- `TRIMMED_TOOLS` in `src/upstream.ts` leaves a few tools out:
  - `pondlog_get_phenology` (the `npn_*` tools cover it);
  - `ebird_get_taxonomy_versions`;
  - `ebird_get_taxa_locales`;
  - `ebird_get_taxonomic_forms`;
  - `ebird_get_adjacent_regions`;
  - `npn_get_station_count_by_state`.

The e2e run fails if the description grows past about 10,000 tokens (counted as characters / 4). Put the important point first in a new description, since later sentences may be dropped.

## Troubleshooting

- **A fix doesn't show up after a deploy.** A local `wrangler deploy` used old `dist/` folders. Run `pnpm build:worker` from the repo root and deploy again, or deploy through Workers Builds.
- **"Not allowed" after GitHub sign-in.** Your numeric GitHub ID isn't in `ALLOWED_GITHUB_IDS`. Add it and deploy.
- **The server answers with a 500 that mentions a shared eBird key.** An `EBIRD_API_KEY` var or secret is bound. Remove it with `npx wrangler secret delete EBIRD_API_KEY`, or delete it from `vars`.
- **Changing your eBird key.** Disconnect the connector in Claude and connect it again. A grant lasts at most 90 days, and it ends sooner if it goes unused for 30 days.
