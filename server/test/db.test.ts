import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/db.ts";

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
