import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { craneParamsSchema, deriveGeometry } from "../domain/crane.ts";
import { renderDrawing } from "../domain/drawing.ts";
import type { DesignRepository, StoredDesign } from "../db/designs.ts";
import { ApiError, parseOrThrow } from "../errors.ts";

const nameSchema = z
  .string({ error: "Name must be text" })
  .trim()
  .min(1, { error: "Name is required" })
  .max(100, { error: "Name must be at most 100 characters" });

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
const pageNumber = (min: number, max: number, label: string) =>
  z
    .string()
    .regex(/^[0-9]{1,6}$/, { error: `${label} must be a whole number` })
    .transform(Number)
    .pipe(z.int().min(min, { error: `${label} must be at least ${min}` }).max(max, { error: `${label} must be at most ${max}` }));
const listQuery = z.object({
  limit: pageNumber(1, 100, "limit").optional(),
  offset: pageNumber(0, 1_000_000, "offset").optional(),
});

function withGeometry(d: StoredDesign) {
  return { ...d, geometry: deriveGeometry(d.params) };
}

function notFound(id: number): never {
  throw new ApiError(404, "DESIGN_NOT_FOUND", `Design ${id} does not exist`);
}

export function registerDesignRoutes(app: FastifyInstance, repo: DesignRepository) {
  app.get("/api/designs", async (req) => {
    const q = parseOrThrow(listQuery, req.query);
    const { items, total } = repo.list(q.limit ?? 50, q.offset ?? 0);
    return { items, total };
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
