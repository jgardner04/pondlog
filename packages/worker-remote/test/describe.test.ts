import { describe, expect, it, vi } from "vitest";

// The package root imports `cloudflare:workers`, which Node cannot load.
vi.mock("@cloudflare/codemode", () => ({ sanitizeToolName: (n: string) => n.replace(/[^a-zA-Z0-9_$]/g, "_") }));
import { renderListing, renderType } from "../src/describe.js";

describe("renderType", () => {
  it("renders scalars, enums, unions and arrays", () => {
    expect(renderType({ type: "integer" })).toBe("number");
    expect(renderType({ enum: ["a", "b"] })).toBe('"a" | "b"');
    expect(renderType({ anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] })).toBe("string | string[]");
    expect(renderType({ type: "array", items: { enum: ["x", "y"] } })).toBe('("x" | "y")[]');
  });

  it("resolves local $ref against the root schema", () => {
    const root = {
      type: "object",
      properties: {
        a: { type: "array", items: { type: "string", enum: ["obs", "hot"] } },
        b: { type: "array", items: { $ref: "#/properties/a/items" } },
      },
    };
    expect(renderType(root.properties.b, 0, root)).toBe('("obs" | "hot")[]');
    expect(renderType({ $ref: "#/missing" }, 0, root)).toBe("unknown");
  });
});

describe("renderListing", () => {
  it("prints one signature per tool, marks optional args and dedupes notes", () => {
    const out = renderListing([
      {
        name: "ebird_recent",
        description: "Recent sightings.",
        inputSchema: {
          type: "object",
          required: ["lat"],
          properties: {
            lat: { type: "number", description: "Latitude." },
            back: { type: "integer", description: "Days back." },
          },
        },
      },
      {
        name: "usgs_sites",
        inputSchema: { type: "object", properties: { lat: { type: "number", description: "Latitude." } } },
      },
      { name: "pondlog_ping", inputSchema: { type: "object" } },
    ]);
    expect(out).toBe(
      [
        "// Recent sightings.",
        "codemode.ebird_recent(args: { lat: number /* Latitude. */; back?: number /* Days back. */ })",
        "",
        "codemode.usgs_sites(args: { lat?: number })",
        "",
        "codemode.pondlog_ping()",
      ].join("\n"),
    );
  });

  it("shortens long notes and neutralises comment terminators", () => {
    const long = `${"word ".repeat(40)}*/ end`;
    const out = renderListing([
      { name: "t", inputSchema: { type: "object", properties: { x: { type: "string", description: long } } } },
    ]);
    const note = out.match(/\/\* (.*) \*\//)?.[1] ?? "";
    expect(note.length).toBeLessThanOrEqual(110);
    expect(note.endsWith("…")).toBe(true);
    expect(out.match(/\*\//g)).toHaveLength(1);
  });
});
