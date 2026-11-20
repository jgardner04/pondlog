import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools as registerEbird } from "@pondlog/mcp-ebird";
import { registerAllTools as registerMushroomObserver } from "@pondlog/mcp-mushroomobserver";
import { registerAllTools as registerNpn } from "@pondlog/mcp-npn";
import { registerAllTools as registerPondlog } from "@pondlog/mcp-pondlog";
import { registerAllTools as registerUsgs } from "@pondlog/mcp-usgs";
import type { EbirdClient } from "@pondlog/source-ebird";

/**
 * Tools left out of the Code Mode surface to keep the `code` tool's
 * description small. Each is rarely useful in conversation or duplicated
 * by another tool (pondlog_get_phenology wraps the same NPN data as npn_*).
 */
export const TRIMMED_TOOLS: ReadonlySet<string> = new Set([
  "pondlog_get_phenology",
  "ebird_get_taxonomy_versions",
  "ebird_get_taxa_locales",
  "ebird_get_taxonomic_forms",
  "ebird_get_adjacent_regions",
  "npn_get_station_count_by_state",
]);

type Register = (server: never, options?: never) => void;

const SENTENCE_BREAK = /(?<!\b(?:e\.g|i\.e|etc|vs|Co)\.)(?<=[.!?])\s+(?=[A-Z(`'"]|[ei][A-Z])/;

/**
 * Shortens a description for the `code` tool's listing, which is sent on
 * every request. Keeps the first
 * `sentences` sentences plus short "Default ..." notes and short pointers to
 * other tools, and drops examples.
 */
export function compact(text: string | undefined, sentences: number, maxChars: number): string | undefined {
  if (!text) return text;
  const parts = text.trim().split(SENTENCE_BREAK);
  const kept = parts.slice(0, sentences).filter((p) => !/^(Example|E\.g\.)\b/i.test(p));
  for (const part of parts.slice(sentences)) {
    if (/^Defaults?\b/.test(part) && part.length <= 60) kept.push(part);
    else if (/`[a-z0-9_]+`/.test(part) && part.length <= 90) kept.push(part); // "Use `find_tide_stations` ..."
  }
  let out = kept.join(" ").replace(/\s*Example: [^.]*\./g, "").trim();
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1).trimEnd()}…`;
  return out;
}

interface Describable {
  description?: string;
  describe?: (description: string) => unknown;
}

/** Returns a copy of a Zod raw shape with each field's description compacted. */
function compactShape(shape: unknown, prefix: string): unknown {
  if (!shape || typeof shape !== "object") return shape;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape as Record<string, unknown>)) {
    const f = field as Describable;
    const short = withPrefix(compact(f?.description, 1, 140), prefix);
    out[key] = short && typeof f.describe === "function" ? f.describe(short) : field;
  }
  return out;
}

/** Rewrites `get_x`-style tool references in a description to their prefixed names. */
export function withPrefix(text: string | undefined, prefix: string): string | undefined {
  const prefixed = text?.replace(/`((?:get|find|search)_[a-z0-9_]+)`/g, (_match, name: string) => `\`${prefix}_${name}\``);
  // Drop sentences that point at a tool this Worker leaves out.
  return prefixed
    ?.split(SENTENCE_BREAK)
    .filter((sentence) => ![...TRIMMED_TOOLS].some((tool) => sentence.includes(`\`${tool}\``)))
    .join(" ");
}

function compactConfig(config: unknown, prefix: string): unknown {
  if (!config || typeof config !== "object") return config;
  const c = config as { description?: string; inputSchema?: unknown };
  return {
    ...c,
    description: withPrefix(compact(c.description, 2, 320), prefix),
    inputSchema: compactShape(c.inputSchema, prefix),
  };
}

/**
 * Registers every tool on `server` under a prefix, skipping TRIMMED_TOOLS
 * and compacting descriptions.
 * The packages were built against their own SDK copy; registerTool has the
 * same shape in both, so the proxy only renames.
 */
function prefixed(server: McpServer, prefix: string): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (name: string, config: unknown, ...rest: unknown[]) => {
          const full = `${prefix}_${name}`;
          if (TRIMMED_TOOLS.has(full)) return undefined;
          return (target.registerTool as (...args: unknown[]) => unknown).call(target, full, compactConfig(config, prefix), ...rest);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** All five pondlog servers on one MCP server, with eBird bound to one user's key. */
export function buildUpstream(ebird: EbirdClient): McpServer {
  const server = new McpServer({ name: "pondlog-remote", version: "0.1.0" }, { capabilities: { tools: {} } });
  const use = (register: unknown, prefix: string, options?: unknown) =>
    (register as Register)(prefixed(server, prefix) as never, options as never);
  use(registerPondlog, "pondlog", { ebird });
  use(registerEbird, "ebird", { ebird });
  use(registerUsgs, "usgs");
  use(registerNpn, "npn");
  use(registerMushroomObserver, "mo");
  return server;
}
