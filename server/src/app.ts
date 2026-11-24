import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import { openDatabase } from "./db/db.ts";
import { DesignRepository } from "./db/designs.ts";
import { ApiError, type ErrorBody, type ErrorCode } from "./errors.ts";
import { registerDesignRoutes } from "./routes/designs.ts";

export interface AppOptions {
  dbPath: string;
  /**
   * Exact Host header values ("host:port") this server answers. Required, with no
   * default, so a missing setting fails closed. Blocks DNS rebinding: a hostile page
   * whose domain re-resolves to 127.0.0.1 still sends its own name as Host.
   */
  allowedHosts: readonly string[];
  logger?: FastifyServerOptions["logger"];
}

/** Request bodies are small JSON documents; anything bigger is rejected early. */
const BODY_LIMIT_BYTES = 16 * 1024;

/** Maps framework-level 4xx errors (bad JSON, size, media type) to stable codes. */
function codeForClientError(status: number): { code: ErrorCode; message: string } {
  switch (status) {
    case 400:
      return { code: "MALFORMED_REQUEST", message: "Request body is not valid JSON" };
    case 413:
      return { code: "PAYLOAD_TOO_LARGE", message: `Request body exceeds ${BODY_LIMIT_BYTES} bytes` };
    case 415:
      return { code: "UNSUPPORTED_MEDIA_TYPE", message: "Send the request body as application/json" };
    default:
      return { code: "BAD_REQUEST", message: "Bad request" };
  }
}

export function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: BODY_LIMIT_BYTES });
  // JSON only: without this, Fastify's built-in text/plain parser turns a text body into a string.
  app.removeContentTypeParser("text/plain");
  if (opts.allowedHosts.length === 0) throw new Error("allowedHosts must name at least one host:port");
  const allowedHosts = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
  const db = openDatabase(opts.dbPath);
  const repo = new DesignRepository(db);

  // Runs before the body is parsed, so a refused request costs almost nothing.
  app.addHook("onRequest", async (req) => {
    if (!allowedHosts.has((req.headers.host ?? "").toLowerCase())) {
      throw new ApiError(403, "HOST_NOT_ALLOWED", "Host not allowed. Open the app at http://127.0.0.1:5173");
    }
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
  });
  app.addHook("onClose", async () => {
    db.close();
  });

  app.setErrorHandler((err: FastifyError | ApiError, req, reply) => {
    let status: number;
    let body: ErrorBody;
    if (err instanceof ApiError) {
      status = err.statusCode;
      body = { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
    } else if (typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500) {
      status = err.statusCode;
      body = { error: codeForClientError(status) };
    } else {
      // Unexpected: log full detail server-side, return nothing internal to the client.
      req.log.error({ err }, "unhandled error");
      status = 500;
      body = { error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } };
    }
    if (status >= 400 && status < 500) req.log.info({ code: body.error.code, status }, "request rejected");
    return reply.code(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ErrorBody = { error: { code: "ROUTE_NOT_FOUND", message: `No route for ${req.method} ${req.url.split("?")[0]}` } };
    return reply.code(404).send(body);
  });

  app.get("/api/health", async () => ({ status: "ok" }));
  registerDesignRoutes(app, repo);

  return app;
}
