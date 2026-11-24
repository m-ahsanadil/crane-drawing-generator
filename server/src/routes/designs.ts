import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CAPACITIES_KG, craneParamsSchema, deriveGeometry, LIMITS, REFERENCE } from "../domain/crane.ts";
import { renderDrawing } from "../domain/drawing.ts";
import type { DesignRepository, ListCursor, StoredDesign } from "../db/designs.ts";
import { ApiError, parseOrThrow } from "../errors.ts";

const nameSchema = z
  .string({ error: "Name must be text" })
  .trim()
  .min(1, { error: "Name is required" })
  .max(100, { error: "Name must be at most 100 characters" })
  // Control characters break SQLite length() and XML; lone surrogates get silently replaced on storage.
  .refine((s) => s.isWellFormed() && !/\p{Cc}/u.test(s), {
    error: "Name contains control characters or invalid Unicode",
  });

const createBody = z.strictObject({ name: nameSchema, params: craneParamsSchema });
const updateBody = z.strictObject({
  name: nameSchema,
  params: craneParamsSchema,
  version: z.int({ error: "Version must be a whole number" }).min(1, { error: "Version must be at least 1" }),
});
const previewBody = z.strictObject({ params: craneParamsSchema });

// Path and query values arrive as strings. 15 digits keeps ids inside Number.MAX_SAFE_INTEGER.
const idParams = z.object({
  id: z.string().regex(/^[1-9][0-9]{0,14}$/, { error: "Design id must be a positive whole number" }).transform(Number),
});
const limitParam = z
  .string()
  .regex(/^[0-9]{1,3}$/, { error: "limit must be a whole number" })
  .transform(Number)
  .pipe(z.int().min(1, { error: "limit must be at least 1" }).max(100, { error: "limit must be at most 100" }));

/** Cursor = base64url("<updatedAt ISO>|<id>"). Opaque to clients; strictly checked here. */
const CURSOR_BODY = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([1-9][0-9]{0,14})$/;

export function encodeCursor(c: ListCursor): string {
  return Buffer.from(`${c.updatedAt}|${c.id}`).toString("base64url");
}

function decodeCursor(raw: string): ListCursor | undefined {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return undefined;
  const m = CURSOR_BODY.exec(Buffer.from(raw, "base64url").toString("utf8"));
  if (!m) return undefined;
  const [, updatedAt, id] = m as unknown as [string, string, string];
  // Rejects impossible dates like month 13 that still match the pattern.
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t) || new Date(t).toISOString() !== updatedAt) return undefined;
  return { updatedAt, id: Number(id) };
}

const cursorParam = z
  .string()
  .refine((s) => decodeCursor(s) !== undefined, { error: "cursor is not valid; use nextCursor from a previous page" })
  .transform((s) => decodeCursor(s) as ListCursor);

// Strict: a removed or misspelled parameter (e.g. the old "offset") fails loudly instead of being ignored.
const listQuery = z.strictObject({
  limit: limitParam.optional(),
  cursor: cursorParam.optional(),
});

function withGeometry(d: StoredDesign) {
  return { ...d, geometry: deriveGeometry(d.params) };
}

function notFound(id: number): never {
  throw new ApiError(404, "DESIGN_NOT_FOUND", `Design ${id} does not exist`);
}

export function registerDesignRoutes(app: FastifyInstance, repo: DesignRepository) {
  // The UI reads its hints from here so the limits live only in domain/crane.ts.
  app.get("/api/crane-options", async () => ({
    capacitiesKg: CAPACITIES_KG,
    limits: LIMITS,
    hookTopBelowRailMm: REFERENCE.hookTopBelowRailMm,
  }));

  app.get("/api/designs", async (req) => {
    const q = parseOrThrow(listQuery, req.query);
    const { items, next } = repo.list(q.limit ?? 50, q.cursor);
    return { items, nextCursor: next ? encodeCursor(next) : null };
  });

  app.post("/api/designs", async (req, reply) => {
    const body = parseOrThrow(createBody, req.body);
    const design = repo.create(body.name, body.params);
    return reply.code(201).header("location", `/api/designs/${design.id}`).send(withGeometry(design));
  });

  app.get("/api/designs/:id", async (req) => {
    const { id } = parseOrThrow(idParams, req.params);
    return withGeometry(repo.get(id) ?? notFound(id));
  });

  app.put("/api/designs/:id", async (req) => {
    const { id } = parseOrThrow(idParams, req.params);
    const body = parseOrThrow(updateBody, req.body);
    const result = repo.update(id, body.version, body.name, body.params);
    if (result.kind === "not_found") notFound(id);
    if (result.kind === "conflict") {
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        `Design ${id} was changed by someone else (now version ${result.currentVersion}). Reload it and apply your edit again.`,
      );
    }
    return withGeometry(result.design);
  });

  app.get("/api/designs/:id/drawing.svg", async (req, reply) => {
    const { id } = parseOrThrow(idParams, req.params);
    const d = repo.get(id) ?? notFound(id);
    const svg = renderDrawing({
      name: d.name,
      params: d.params,
      geometry: deriveGeometry(d.params),
      saved: { id: d.id, version: d.version },
    });
    return reply
      .type("image/svg+xml; charset=utf-8")
      .header("content-disposition", `attachment; filename="design-${d.id}-v${d.version}.svg"`)
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
      .send(svg);
  });

  app.post("/api/preview", async (req) => {
    const body = parseOrThrow(previewBody, req.body);
    const geometry = deriveGeometry(body.params);
    // The preview carries no user text, so a fixed name is used.
    return { geometry, svg: renderDrawing({ name: "Unsaved preview", params: body.params, geometry }) };
  });
}
