// Starts the API (default port 8787) and the web dev server (port 5173) together.
// Ctrl+C stops both. If either process exits, the other is stopped too.
import { spawn, spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

const procs = [
  { name: "server", command: "npm run dev --workspace server" },
  { name: "web", command: "npm run dev --workspace web" },
].map(({ name, command }) => {
  // Fixed command strings (no user input), run through a shell so npm.cmd works on Windows.
  const child = spawn(command, { stdio: "inherit", shell: true });
  child.on("exit", (code) => {
    if (!stopping) console.log(`[dev] ${name} exited with code ${code ?? "null"}; stopping the rest.`);
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    if (p.exitCode !== null || p.pid === undefined) continue;
    // On Windows, killing the shell leaves node running; kill the whole process tree instead.
    if (isWindows) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else p.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`[dev] API on http://127.0.0.1:${process.env.API_PORT || 8787}, open the app at http://127.0.0.1:5173`);
