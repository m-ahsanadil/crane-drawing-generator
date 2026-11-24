import { DatabaseSync } from "node:sqlite";

/**
 * Ordered schema migrations. The index + 1 is stored in PRAGMA user_version,
 * so each migration runs exactly once. Never edit a shipped migration; add a new one.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE designs (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     name              TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
     capacity_kg       INTEGER NOT NULL CHECK (capacity_kg > 0),
     span_mm           INTEGER NOT NULL CHECK (span_mm > 0),
     rail_height_mm    INTEGER NOT NULL CHECK (rail_height_mm > 0),
     lifting_height_mm INTEGER NOT NULL CHECK (lifting_height_mm > 0),
     version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
     created_at        TEXT    NOT NULL,
     updated_at        TEXT    NOT NULL
   );
   CREATE INDEX designs_updated_at ON designs (updated_at DESC, id DESC);`,
];

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  try {
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

function migrate(db: DatabaseSync) {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  // A newer schema may have columns or rules this code does not know; writing to it could corrupt data.
  if (row.user_version > MIGRATIONS.length) {
    throw new Error(
      `Database schema version ${row.user_version} is newer than this app supports (${MIGRATIONS.length}). Use a newer app version or another DB_PATH.`,
    );
  }
  for (let i = row.user_version; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
