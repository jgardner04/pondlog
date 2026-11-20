// Library entry: builds the server without starting a transport. Importing
// this module has no side effects; the stdio binary lives in index.ts.
export {
  buildServer,
  SERVER_NAME,
  SERVER_VERSION,
} from "./server.js";
export { registerAllTools } from "./tools.js";
