import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { parseApiPort } from "./config.ts";

const here = dirname(fileURLToPath(import.meta.url));

const port = parseApiPort(process.env.API_PORT);
// ":memory:" is SQLite's in-memory database (handy for a throwaway demo); anything else is a file path.
const rawDbPath = process.env.DB_PATH || resolve(here, "../data/designs.db");
const dbPath = rawDbPath === ":memory:" ? rawDbPath : resolve(rawDbPath);
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

// Direct calls and the Vite proxy (changeOrigin) both arrive with one of these Host values.
const app = buildApp({ dbPath, allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`] });

// Local tool: listen on loopback only, not on every network interface.
app.listen({ port, host: "127.0.0.1" }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
