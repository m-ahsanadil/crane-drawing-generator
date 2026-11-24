import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";

const here = dirname(fileURLToPath(import.meta.url));

function readPort(raw: string | undefined): number {
  if (raw === undefined) return 3001;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be a whole number between 1 and 65535, got "${raw}"`);
  }
  return port;
}

const port = readPort(process.env.PORT);
const dbPath = resolve(process.env.DB_PATH ?? resolve(here, "../data/designs.db"));
mkdirSync(dirname(dbPath), { recursive: true });

const app = buildApp({ dbPath });

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
