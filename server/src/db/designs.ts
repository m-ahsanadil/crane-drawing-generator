import type { DatabaseSync } from "node:sqlite";
import type { CraneParams } from "../domain/crane.ts";

export interface StoredDesign {
  id: number;
  name: string;
  params: CraneParams;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: number;
  name: string;
  capacity_kg: number;
  span_mm: number;
  rail_height_mm: number;
  lifting_height_mm: number;
  version: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, name, capacity_kg, span_mm, rail_height_mm, lifting_height_mm, version, created_at, updated_at";

function toDesign(r: Row): StoredDesign {
  return {
    id: r.id,
    name: r.name,
    params: {
      capacityKg: r.capacity_kg,
      spanMm: r.span_mm,
      railHeightMm: r.rail_height_mm,
      liftingHeightMm: r.lifting_height_mm,
    },
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type UpdateResult =
  | { kind: "updated"; design: StoredDesign }
  | { kind: "not_found" }
  | { kind: "conflict"; currentVersion: number };

/** All SQL for designs lives here. Inputs must already be validated. */
export class DesignRepository {
  private readonly db: DatabaseSync;
  private readonly now: () => string;

  constructor(db: DatabaseSync, now: () => string = () => new Date().toISOString()) {
    this.db = db;
    this.now = now;
  }

  create(name: string, p: CraneParams): StoredDesign {
    const ts = this.now();
    const row = this.db
      .prepare(
        `INSERT INTO designs (name, capacity_kg, span_mm, rail_height_mm, lifting_height_mm, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
      )
      .get(name, p.capacityKg, p.spanMm, p.railHeightMm, p.liftingHeightMm, ts, ts) as unknown as Row;
    return toDesign(row);
  }

  get(id: number): StoredDesign | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM designs WHERE id = ?`).get(id) as unknown as Row | undefined;
    return row ? toDesign(row) : undefined;
  }

  list(limit: number, offset: number): { items: StoredDesign[]; total: number } {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM designs ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as unknown as Row[];
    const { total } = this.db.prepare("SELECT COUNT(*) AS total FROM designs").get() as { total: number };
    return { items: rows.map(toDesign), total };
  }

  /**
   * Optimistic concurrency: the write only lands if the stored version still
   * equals expectedVersion. The check and the write are one SQL statement,
   * so two editors with the same version cannot both succeed.
   */
  update(id: number, expectedVersion: number, name: string, p: CraneParams): UpdateResult {
    const row = this.db
      .prepare(
        `UPDATE designs
            SET name = ?, capacity_kg = ?, span_mm = ?, rail_height_mm = ?, lifting_height_mm = ?,
                version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?
      RETURNING ${COLUMNS}`,
      )
      .get(name, p.capacityKg, p.spanMm, p.railHeightMm, p.liftingHeightMm, this.now(), id, expectedVersion) as unknown as
      | Row
      | undefined;
    if (row) return { kind: "updated", design: toDesign(row) };
    const current = this.get(id);
    return current ? { kind: "conflict", currentVersion: current.version } : { kind: "not_found" };
  }
}
