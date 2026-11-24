/**
 * Shared by the server (src/index.ts) and the Vite proxy (web/vite.config.ts), so
 * both read API_PORT with the same rule and cannot disagree. No Node-only imports.
 */
export const DEFAULT_API_PORT = 8787;

/** Plain decimal 1-65535 only; "0x1F90", "1e3", "8787.0" or " 8787" are errors, not guesses. */
export function parseApiPort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_API_PORT;
  const port = /^[1-9][0-9]{0,4}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(port >= 1 && port <= 65_535)) {
    throw new Error(`API_PORT must be a plain whole number from 1 to 65535, got ${JSON.stringify(raw)}`);
  }
  return port;
}
