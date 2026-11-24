import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** API_PORT is shared with web/vite.config.ts so the dev proxy always points at this server. */
function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 8787;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`API_PORT must be a whole number between 1 and 65535, got "${raw}"`);
  }
  return port;
}

const port = readPort(process.env.API_PORT);
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
