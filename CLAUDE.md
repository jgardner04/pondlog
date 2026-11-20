# CLAUDE.md

This fork of `andrewschristison/pondlog` exists to host five pondlog MCP servers (`mcp-pondlog`, `mcp-ebird`, `mcp-usgs`, `mcp-npn`, `mcp-mushroomobserver`) as one Cloudflare Worker behind a single Code Mode `code` tool, usable as a Claude custom connector, where each user supplies their own eBird API key.

## Two kinds of change

Every change is either **upstream** or **fork-only**. Decide which before writing code; the answer picks the branch.

### Upstream changes

Generic improvements any pondlog user would want, for example per-request eBird key injection, exporting `buildServer()`, the `@modelcontextprotocol/sdk` bump, per-key rate limiting.

- One `feat/*` branch per change, cut from `upstream/main` (never from `deploy/cloudflare`, which carries this file and the Worker).
- Touch only the packages the change needs.
- Existing stdio behaviour keeps working, and so does the `process.env.EBIRD_API_KEY` fallback.
- Ships with tests.
- Matches the repo's existing style: conventional commit subjects scoped by package (`feat(source-ebird): ...`), `Result<T>` returns instead of throws, Zod-validated responses.
- Cloudflare-specific code stays out of every branch except `feat/worker-remote`: no Worker types, Wrangler, OAuth or Code Mode imports.
- Each branch becomes one PR to `andrewschristison/pondlog`, opened only after the owner reviews it.
- No CHANGELOG entries on these branches. Each PR description ends with a "Suggested changelog entry" section the upstream maintainer can copy.

### The upstream Worker branch

`feat/worker-remote` offers `packages/worker-remote` upstream, for the maintainer to take or decline. It is stacked on `feat/export-build-server` and carries the same package as `deploy/cloudflare` with nothing specific to this deployment: `wrangler.jsonc` has a placeholder KV id and an empty `ALLOWED_GITHUB_IDS`, and the tests use made-up GitHub IDs. Port Worker changes to it after they land on `deploy/cloudflare`.

### Fork-only changes

Everything Cloudflare (the Worker, Wrangler config, OAuth, Code Mode) lives in `packages/worker-remote` on the `deploy/cloudflare` branch. `deploy/cloudflare` merges in the `feat/*` and `fix/*` branches it depends on. Its `wrangler.jsonc` keeps this deployment's real KV id and allowlist; never bring the placeholders from `feat/worker-remote` into it.

### Deploying

- Cloudflare Workers Builds deploys every push to `deploy/cloudflare`. A merge is a deploy, so the owner's merge is the deploy approval.
- A GitHub ruleset on `deploy/cloudflare` requires a pull request and the `deploy-checks` job (`.github/workflows/deploy-checks.yml`, fork-only), and blocks force pushes. Never push to it directly. Put each change on a short-lived branch (`chore/*`, `docs/*`, or a `fix/*` that also goes upstream) and open a PR into `deploy/cloudflare`.
- Don't deploy with a local `wrangler deploy` unless the owner asks. It bundles whatever `dist/` folders are on disk, which once shipped stale code.

## Syncing upstream

- Remote `upstream` is `https://github.com/andrewschristison/pondlog`.
- Rebase `feat/*` branches onto `upstream/main`.
- Merge `upstream/main` into `deploy/cloudflare` (merge, so the deploy history stays intact).
- When upstream merges a `feat/*` PR, delete that branch and depend on the released package version instead.

## Scope

Change only the five servers above, their source clients (`source-ebird`, `source-usgs`, `source-npn`, `source-mushroomobserver`, plus `source-inaturalist` and `source-nightsky`, which `mcp-pondlog` also uses), `core`, `worker-remote`, and the root files the Worker needs (`package.json` scripts, `pnpm-workspace.yaml`, the lockfile) plus `docs/ARCHITECTURE.md` and the root README where a change makes them wrong. Every other package stays as upstream has it. `mcp-garden` is deprecated upstream; leave it alone.

## Commands

Use the root `package.json` scripts (`build`, `typecheck`, `test`); each fans out to the packages with `pnpm -r`. Smoke tests that hit live APIs are excluded from `test` and run per package with `smoke`.

For the Worker: `pnpm build:worker` builds it and the packages it depends on, `pnpm --filter @pondlog/worker-remote test` runs its unit tests, and `pnpm --filter @pondlog/worker-remote e2e` runs the whole connector flow offline in local workerd. The e2e also fails if the `code` tool's description passes about 10k tokens. `pnpm deploy:worker` is what Workers Builds runs.

## Secrets

An eBird key has exactly two sources: the user's OAuth grant props inside the Worker, or `process.env.EBIRD_API_KEY` for local stdio. Keys stay out of logs, tool results, error messages, URLs, query strings, and any code or bindings passed into the Code Mode sandbox. The key travels in the `X-eBirdApiToken` request header and nowhere else.

## Branches in this fork

- `deploy/cloudflare` is the default branch. It holds this file, the Worker and everything deployed.
- `main` is a plain mirror of `upstream/main`, kept current with GitHub's Sync fork button. Nothing is developed or merged there, and it does not carry this file.

## Fork divergence from upstream

Upstream gitignores `CLAUDE.md` and its workspace guard (`scripts/workspace-guard.patterns`, run in CI) refuses to track it. `deploy/cloudflare` removes `CLAUDE.md` from both so this file can be committed. That edit is fork-only: it never goes into a `feat/*` branch, and when merging `upstream/main` keep the fork's version of those two files.
