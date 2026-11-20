import { defineConfig } from "tsup";

export default defineConfig({
  // index.ts is the stdio binary (its hashbang line is kept by esbuild);
  // lib.ts is the side-effect-free library entry with buildServer().
  entry: ["src/index.ts", "src/lib.ts"],
  format: ["esm"],
  dts: { entry: "src/lib.ts" },
  clean: true,
  sourcemap: true,
  target: "es2022",
});
