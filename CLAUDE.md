# CLAUDE.md

This fork of `andrewschristison/pondlog` exists to host five pondlog MCP servers (`mcp-pondlog`, `mcp-ebird`, `mcp-usgs`, `mcp-npn`, `mcp-mushroomobserver`) as one Cloudflare Worker behind a single Code Mode `code` tool, usable as a Claude custom connector, where each user supplies their own eBird API key.

## Two kinds of change

Every change is either **upstream** or **fork-only**. Decide which before writing code; the answer picks the branch.

### Upstream changes

Generic improvements any pondlog user would want, for example per-request eBird key injection, exporting `buildServer()`, the `@modelcontextprotocol/sdk` bump, per-key rate limiting.

- One `feat/*` branch per change, cut from `upstream/main` (never from the fork's `main`, which carries this file).
- Touch only the packages the change needs.
- Existing stdio behaviour keeps working, and so does the `process.env.EBIRD_API_KEY` fallback.
- Ships with tests.
- Matches the repo's existing style: conventional commit subjects scoped by package (`feat(source-ebird): ...`), `Result<T>` returns instead of throws, Zod-validated responses.
- Cloudflare-specific code stays out: no Worker types, Wrangler, OAuth or Code Mode imports.
- Each branch becomes one PR to `andrewschristison/pondlog`, opened only after the owner reviews it.

### Fork-only changes

Everything Cloudflare (the Worker, Wrangler config, OAuth, Code Mode) lives in `packages/worker-remote` on the `deploy/cloudflare` branch. `deploy/cloudflare` merges in the `feat/*` branches it depends on.

## Syncing upstream

- Remote `upstream` is `https://github.com/andrewschristison/pondlog`.
- Rebase `feat/*` branches onto `upstream/main`.
- Merge `upstream/main` into `deploy/cloudflare` (merge, so the deploy history stays intact).
- When upstream merges a `feat/*` PR, delete that branch and depend on the released package version instead.

## Scope

Change only the five servers above, their source clients (`source-ebird`, `source-usgs`, `source-npn`, `source-mushroomobserver`, plus `source-inaturalist` and `source-nightsky`, which `mcp-pondlog` also uses), and `core`. Every other package stays as upstream has it. `mcp-garden` is deprecated upstream; leave it alone.

## Commands

Use the root `package.json` scripts (`build`, `typecheck`, `test`); each fans out to the packages with `pnpm -r`. Smoke tests that hit live APIs are excluded from `test` and run per package with `smoke`.

## Secrets

An eBird key has exactly two sources: the user's OAuth grant props inside the Worker, or `process.env.EBIRD_API_KEY` for local stdio. Keys stay out of logs, tool results, error messages, URLs, query strings, and any code or bindings passed into the Code Mode sandbox. The key travels in the `X-eBirdApiToken` request header and nowhere else.

## Fork divergence from upstream

Upstream gitignores `CLAUDE.md` and its workspace guard (`scripts/workspace-guard.patterns`, run in CI) refuses to track it. The fork's `main` removes `CLAUDE.md` from both so this file can be committed. That edit is fork-only: it never goes into a `feat/*` branch, and when merging `upstream/main` keep the fork's version of those two files.
