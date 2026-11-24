import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/db.ts";
import { DesignRepository } from "../src/db/designs.ts";

const params = { capacityKg: 10_000, spanMm: 25_000, railHeightMm: 8_321, liftingHeightMm: 7_900 };

test("cursor paging is exact when many designs share the same timestamp", () => {
  const db = openDatabase(":memory:");
  // Frozen clock: every row gets the same updated_at, so only the id breaks ties.
  const repo = new DesignRepository(db, () => "2026-11-25T00:00:00.000Z");
  for (let i = 1; i <= 7; i++) repo.create(`d${i}`, params);
  const seen: number[] = [];
  let cursor: { updatedAt: string; id: number } | undefined;
  for (let guard = 0; guard < 10; guard++) {
    const page = repo.list(3, cursor);
    seen.push(...page.items.map((d) => d.id));
    if (!page.next) break;
    cursor = page.next;
  }
  db.close();
  assert.deepEqual(seen, [7, 6, 5, 4, 3, 2, 1]);
});

test("cursor pages use the index instead of scanning the table", () => {
  const db = openDatabase(":memory:");
  const plan = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM designs WHERE (updated_at, id) < (?, ?) ORDER BY updated_at DESC, id DESC LIMIT 101`,
    )
    .all("2026-11-25T00:00:00.000Z", 1) as { detail: string }[];
  db.close();
  const detail = plan.map((r) => r.detail).join(" | ");
  assert.match(detail, /SEARCH designs USING (COVERING )?INDEX designs_updated_at/, detail);
});

function withTempDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "crane-db-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a fresh database is migrated to the current schema", () => {
  withTempDir((dir) => {
    const db = openDatabase(join(dir, "fresh.db"));
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    db.close();
    assert.equal(user_version, 1);
  });
});

test("reopening an up-to-date database does not re-run migrations", () => {
  withTempDir((dir) => {
    const path = join(dir, "again.db");
    openDatabase(path).close();
    assert.doesNotThrow(() => openDatabase(path).close());
  });
});

test("a database from a newer app version is refused, not silently used", () => {
  withTempDir((dir) => {
    const path = join(dir, "newer.db");
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    assert.throws(() => openDatabase(path), /schema version 99 is newer than this app supports \(1\)/);
  });
});
