import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";

const params = { capacityKg: 10_000, spanMm: 25_000, railHeightMm: 8_321, liftingHeightMm: 7_900 };

// app.inject() sends "Host: localhost:80" by default.
const TEST_HOSTS = ["localhost:80"];

let app: FastifyInstance;

beforeEach(async () => {
  app = buildApp({ dbPath: ":memory:", logger: false, allowedHosts: TEST_HOSTS });
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

test("requests with a foreign Host header are refused (DNS rebinding)", async () => {
  // Found by security review: a page whose domain re-resolves to 127.0.0.1 could read and write designs.
  // (A missing Host cannot be tested here: inject() fills in "localhost:80" when it is empty.)
  for (const host of ["evil.example", "evil.example:80", "localhost:81", "127.0.0.1:80", "localhost"]) {
    const read = await app.inject({ method: "GET", url: "/api/designs", headers: { host } });
    assert.equal(read.statusCode, 403, `GET host=${host}`);
    assert.equal(read.json().error.code, "HOST_NOT_ALLOWED", `GET host=${host}`);
    const write = await app.inject({
      method: "POST",
      url: "/api/designs",
      headers: { host },
      payload: { name: "x", params },
    });
    assert.equal(write.statusCode, 403, `POST host=${host}`);
  }
  const list = await app.inject({ method: "GET", url: "/api/designs" });
  assert.equal(list.json().items.length, 0);
  // Host names are case-insensitive.
  const upper = await app.inject({ method: "GET", url: "/api/health", headers: { host: "LOCALHOST:80" } });
  assert.equal(upper.statusCode, 200);
});

test("crane options expose the server's own limits so the UI does not duplicate them", async () => {
  const res = await app.inject({ method: "GET", url: "/api/crane-options" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.capacitiesKg.includes(10_000));
  assert.deepEqual(body.limits.spanMm, { min: 5_000, max: 30_000 });
  assert.equal(body.hookTopBelowRailMm, 421);
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

const names = (body: { items: { name: string }[] }) => body.items.map((d) => d.name);

test("list returns saved designs, newest first, and no cursor when everything fits", async () => {
  await create("A");
  await create("B");
  const res = await app.inject({ method: "GET", url: "/api/designs" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(names(body), ["B", "A"]);
  assert.equal(body.nextCursor, null);
});

test("list pages with a cursor: every design exactly once, in order", async () => {
  for (const n of ["A", "B", "C", "D", "E"]) await create(n);
  const seen: string[] = [];
  let url = "/api/designs?limit=2";
  for (let guard = 0; guard < 10; guard++) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.items.length <= 2);
    seen.push(...names(body));
    if (body.nextCursor === null) break;
    url = `/api/designs?limit=2&cursor=${encodeURIComponent(body.nextCursor)}`;
  }
  assert.deepEqual(seen, ["E", "D", "C", "B", "A"]);
});

test("an exactly full last page still reports no further cursor", async () => {
  for (const n of ["A", "B"]) await create(n);
  const res = await app.inject({ method: "GET", url: "/api/designs?limit=2" });
  assert.equal(res.json().nextCursor, null);
});

test("list rejects bad paging values, malformed cursors and unknown query keys", async () => {
  const garbage = Buffer.from("not-a-cursor").toString("base64url");
  const badDate = Buffer.from("2026-13-99T99:99:99.999Z|1").toString("base64url");
  const badId = Buffer.from("2026-11-25T00:00:00.000Z|0").toString("base64url");
  for (const q of [
    "limit=0",
    "limit=101",
    "limit=abc",
    "limit=",
    "cursor=",
    `cursor=${garbage}`,
    `cursor=${badDate}`,
    `cursor=${badId}`,
    `cursor=${"A".repeat(200)}`,
    "offset=2", // removed parameter must fail loudly, not be ignored
  ]) {
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
  assert.equal(list.json().items.length, 0);
});

test("name is required, trimmed and length-limited", async () => {
  for (const name of ["", "   ", "x".repeat(101)]) {
    const res = await create(name);
    assert.equal(res.statusCode, 400, JSON.stringify(name));
  }
  assert.equal((await create("x".repeat(100))).statusCode, 201);
});

test("name with control characters or broken Unicode is rejected with 400, never stored", async () => {
  // Found by adversarial review: NUL first gave 500, embedded NUL broke the SVG, a lone surrogate was silently changed.
  for (const name of ["\u0000abc", "ab\u0000cd", "a\u0001\u001bb", "tab\there", "del\u007f", "x\uD800y", "y\uDC00"]) {
    const res = await create(name);
    assert.equal(res.statusCode, 400, JSON.stringify(name));
    assert.equal(res.json().error.code, "VALIDATION_FAILED", JSON.stringify(name));
    assert.equal(res.json().error.details[0].path, "name", JSON.stringify(name));
  }
  const list = await app.inject({ method: "GET", url: "/api/designs" });
  assert.equal(list.json().items.length, 0);
  // Normal non-ASCII names still work.
  assert.equal((await create("Kran Halle 2 ü الرافعة \u{1F3D7}")).statusCode, 201);
});

test("names with invisible or format characters are rejected (display spoofing)", async () => {
  // Found by security review: a bidi override showed "\u202Eexe.gnp" as "png.exe"; zero-width chars make look-alike names.
  const cases: [string, string][] = [
    ["bidi override", "\u202Eexe.gnp"],
    ["zero-width space", "Ba\u200By"],
    ["zero-width joiner", "a\u200Db"],
    ["line separator", "a\u2028b"],
    ["paragraph separator", "a\u2029b"],
    ["tag character", "a\u{E0041}b"],
    ["noncharacter U+FFFF", "a\uFFFFb"],
    ["noncharacter U+FDD0", "a\uFDD0b"],
    // A leading BOM is whitespace to trim(), so test it inside the name.
    ["byte order mark", "na\uFEFFme"],
  ];
  for (const [label, name] of cases) {
    const res = await create(name);
    assert.equal(res.statusCode, 400, label);
    assert.equal(res.json().error.details[0].path, "name", label);
  }
  const list = await app.inject({ method: "GET", url: "/api/designs" });
  assert.equal(list.json().items.length, 0);
});

test("update also rejects control characters in the name", async () => {
  await create();
  const res = await app.inject({ method: "PUT", url: "/api/designs/1", payload: { name: "\u0000x", params, version: 1 } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "VALIDATION_FAILED");
});

test("non-JSON bodies, including text/plain, get 415", async () => {
  for (const type of ["text/plain", "application/x-www-form-urlencoded"]) {
    const res = await app.inject({ method: "POST", url: "/api/designs", headers: { "content-type": type }, payload: "a=b" });
    assert.equal(res.statusCode, 415, type);
    assert.equal(res.json().error.code, "UNSUPPORTED_MEDIA_TYPE", type);
  }
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
  const local = buildApp({ dbPath: ":memory:", logger: false, allowedHosts: TEST_HOSTS });
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
  assert.equal(list.json().items.length, 0);
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
