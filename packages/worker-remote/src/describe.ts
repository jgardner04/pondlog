import { sanitizeToolName } from "@cloudflare/codemode";

/**
 * Compact tool listing for the `code` tool's description.
 *
 * Code Mode's default `{{types}}` prints every tool twice (an Input type with
 * each parameter documented, then a declaration repeating every parameter as
 * an @param line) plus an `Output = unknown` type per tool. With ~38 tools
 * that is ~13k tokens on every request. This renders one line per tool
 * instead, with each parameter's short description inline the first time it
 * appears, which carries the same information in roughly half the space.
 */

interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchema | JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

export interface ToolListing {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

const MAX_PARAM_NOTE = 110;

/** Resolves a local `#/...` reference, which the SDK emits for repeated subschemas. */
function resolveRef(ref: string, root: JsonSchema | undefined): JsonSchema | undefined {
  if (!root || !ref.startsWith("#/")) return undefined;
  let node: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    node = node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined;
  }
  return node && typeof node === "object" ? (node as JsonSchema) : undefined;
}

/** A TypeScript-like type for a JSON Schema node, kept short. */
export function renderType(schema: JsonSchema | undefined, depth = 0, root?: JsonSchema): string {
  if (!schema) return "unknown";
  if (schema.$ref) return depth > 4 ? "unknown" : renderType(resolveRef(schema.$ref, root), depth + 1, root);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const union = schema.anyOf ?? schema.oneOf;
  if (union) return [...new Set(union.map((s) => renderType(s, depth, root)))].join(" | ");
  const type = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (type.length > 1) return type.map((t) => renderType({ ...schema, type: t }, depth, root)).join(" | ");
  switch (type[0]) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const item = Array.isArray(schema.items) ? schema.items[0] : schema.items;
      const inner = renderType(item, depth + 1, root);
      return /[ |]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
    }
    case "object":
      return depth > 1 || !schema.properties ? "object" : renderObject(schema, depth + 1, root);
    default:
      return "unknown";
  }
}

function note(text: string | undefined, seen?: Set<string>): string {
  if (!text) return "";
  // A note already printed for an earlier tool (lat, lng, region_code...) is
  // not repeated; the model reads the whole listing.
  if (seen) {
    if (seen.has(text)) return "";
    seen.add(text);
  }
  let short = text.replace(/\s+/g, " ").replace(/\*\//g, "* /").trim();
  if (short.length > MAX_PARAM_NOTE) short = `${short.slice(0, MAX_PARAM_NOTE - 1).trimEnd()}…`;
  return ` /* ${short} */`;
}

function renderObject(schema: JsonSchema, depth: number, root: JsonSchema | undefined, seen?: Set<string>): string {
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {}).map(([key, prop]) => {
    const optional = required.has(key) ? "" : "?";
    return `${key}${optional}: ${renderType(prop, depth, root)}${seen ? note(prop.description, seen) : ""}`;
  });
  return fields.length ? `{ ${fields.join("; ")} }` : "{}";
}

/** One block per tool: its description as a comment, then its call signature. */
export function renderListing(tools: ToolListing[]): string {
  const seen = new Set<string>();
  return tools
    .map((tool) => {
      const doc = tool.description ? `// ${tool.description.replace(/\s+/g, " ").trim()}\n` : "";
      const args = Object.keys(tool.inputSchema.properties ?? {}).length ? `args: ${renderObject(tool.inputSchema, 1, tool.inputSchema, seen)}` : "";
      return `${doc}codemode.${sanitizeToolName(tool.name)}(${args})`;
    })
    .join("\n\n");
}
