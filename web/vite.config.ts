import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Same parser as the server, so a port spelling one accepts the other cannot reject.
import { parseApiPort } from "../server/src/config.ts";

// The dev server proxies /api to the backend, so the browser talks to one origin.
const apiPort = parseApiPort(process.env.API_PORT);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // changeOrigin sends "Host: 127.0.0.1:<apiPort>", which the API's Host allowlist accepts.
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } },
  },
});
