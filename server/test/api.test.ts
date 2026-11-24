import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";

const params = { capacityKg: 10_000, spanMm: 25_000, railHeightMm: 8_321, liftingHeightMm: 7_900 };

let app: FastifyInstance;

beforeEach(async () => {
  app = buildApp({ dbPath: ":memory:", logger: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function create(name = "Bay 1 crane", p: object = params) {
  return app.inject({ method: "POST", url: "/api/designs", payload: { name, params: p } });
}

test("health check responds", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok" });
});

test("create returns 201 with the stored design and derived geometry", async () => {
  const res = await create("  Bay 1 crane  ");
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.id, 1);
  assert.equal(body.name, "Bay 1 crane"); // trimmed
  assert.equal(body.version, 1);
  assert.deepEqual(body.params, params);
  assert.equal(body.geometry.bridgeOverallLengthMm, 25_270);
  assert.match(body.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(res.headers.location, "/api/designs/1");
});

test("list returns saved designs, newest first, with total", async () => {
  await create("A");
  await create("B");
  const res = await app.inject({ method: "GET", url: "/api/designs" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.total, 2);
  assert.deepEqual(body.items.map((d: { name: string }) => d.name), ["B", "A"]);
});

test("list is paginated and rejects bad paging values", async () => {
  for (const n of ["A", "B", "C"]) await create(n);
  const page = await app.inject({ method: "GET", url: "/api/designs?limit=2&offset=2" });
  assert.equal(page.statusCode, 200);
  assert.deepEqual(page.json().items.map((d: { name: string }) => d.name), ["A"]);
  assert.equal(page.json().total, 3);
  for (const q of ["limit=0", "limit=101", "limit=abc", "offset=-1", "limit="]) {
    const res = await app.inject({ method: "GET", url: `/api/designs?${q}` });
    assert.equal(res.statusCode, 400, q);
    assert.equal(res.json().error.code, "VALIDATION_FAILED", q);
  }
});

test("get reopens a saved design", async () => {
  await create();
  const res = await app.inject({ method: "GET", url: "/api/designs/1" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().params, params);
});

test("get unknown id is 404 and malformed id is 400", async () => {
  const missing = await app.inject({ method: "GET", url: "/api/designs/999" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "DESIGN_NOT_FOUND");
  for (const id of ["abc", "0", "-1", "1.5", "99999999999999999999"]) {
    const res = await app.inject({ method: "GET", url: `/api/designs/${id}` });
    assert.equal(res.statusCode, 400, id);
    assert.equal(res.json().error.code, "VALIDATION_FAILED", id);
  }
});

test("update edits the design and bumps the version", async () => {
  await create();
  const res = await app.inject({
    method: "PUT",
    url: "/api/designs/1",
    payload: { name: "Bay 1 crane rev B", params: { ...params, spanMm: 20_000 }, version: 1 },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.version, 2);
  assert.equal(body.name, "Bay 1 crane rev B");
  assert.equal(body.params.spanMm, 20_000);
  const reopened = await app.inject({ method: "GET", url: "/api/designs/1" });
  assert.equal(reopened.json().params.spanMm, 20_000);
});

test("update with a stale version is rejected with 409 and does not overwrite", async () => {
  await create();
  const first = await app.inject({
    method: "PUT",
    url: "/api/designs/1",
    payload: { name: "first editor", params, version: 1 },
  });
  assert.equal(first.statusCode, 200);
  const second = await app.inject({
    method: "PUT",
    url: "/api/designs/1",
    payload: { name: "second editor", params, version: 1 },
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, "VERSION_CONFLICT");
  const reopened = await app.inject({ method: "GET", url: "/api/designs/1" });
  assert.equal(reopened.json().name, "first editor");
});

test("update of an unknown id is 404", async () => {
  const res = await app.inject({ method: "PUT", url: "/api/designs/5", payload: { name: "x", params, version: 1 } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, "DESIGN_NOT_FOUND");
});

test("invalid params are rejected with field-level details and nothing is stored", async () => {
  const res = await create("bad", { ...params, spanMm: 40_000, liftingHeightMm: "high" });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error.code, "VALIDATION_FAILED");
  const paths = body.error.details.map((d: { path: string }) => d.path).sort();
  assert.deepEqual(paths, ["params.liftingHeightMm", "params.spanMm"]);
  const list = await app.inject({ method: "GET", url: "/api/designs" });
  assert.equal(list.json().total, 0);
});

test("name is required, trimmed and length-limited", async () => {
  for (const name of ["", "   ", "x".repeat(101)]) {
    const res = await create(name);
    assert.equal(res.statusCode, 400, JSON.stringify(name));
  }
  assert.equal((await create("x".repeat(100))).statusCode, 201);
});

test("unknown fields are rejected, including attempts to set id or version on create", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/designs",
    payload: { name: "x", params, id: 42, version: 7 },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "VALIDATION_FAILED");
});

test("malformed JSON, missing body and oversized body get stable error codes", async () => {
  const malformed = await app.inject({
    method: "POST",
    url: "/api/designs",
    headers: { "content-type": "application/json" },
    payload: "{not json",
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.code, "MALFORMED_REQUEST");

  const missing = await app.inject({ method: "POST", url: "/api/designs" });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, "VALIDATION_FAILED");

  const huge = await create("x".repeat(64 * 1024));
  assert.equal(huge.statusCode, 413);
  assert.equal(huge.json().error.code, "PAYLOAD_TOO_LARGE");
});

test("unexpected errors return 500 without leaking internals", async () => {
  const local = buildApp({ dbPath: ":memory:", logger: false });
  local.get("/api/boom", async () => {
    throw new Error("SQLITE_CORRUPT at C:\\secret\\path.db");
  });
  const res = await local.inject({ method: "GET", url: "/api/boom" });
  await local.close();
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } });
  assert.ok(!res.body.includes("secret"));
});

test("unknown routes return the same error envelope", async () => {
  const res = await app.inject({ method: "GET", url: "/api/nope" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, "ROUTE_NOT_FOUND");
});

test("preview validates and returns geometry without saving", async () => {
  const ok = await app.inject({ method: "POST", url: "/api/preview", payload: { params } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().geometry.wheelbaseMm, 3_800);
  assert.match(ok.json().svg, /^<svg /);

  const bad = await app.inject({ method: "POST", url: "/api/preview", payload: { params: { ...params, spanMm: 1 } } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.details[0].path, "params.spanMm");

  const list = await app.inject({ method: "GET", url: "/api/designs" });
  assert.equal(list.json().total, 0);
});

test("saved design drawing is served as a downloadable SVG with safe headers", async () => {
  await create();
  const res = await app.inject({ method: "GET", url: "/api/designs/1/drawing.svg" });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /^image\/svg\+xml/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.match(String(res.headers["content-security-policy"]), /default-src 'none'/);
  assert.match(String(res.headers["content-disposition"]), /^attachment; filename="design-1-v1\.svg"$/);
  assert.match(res.body, /^<svg /);
});
