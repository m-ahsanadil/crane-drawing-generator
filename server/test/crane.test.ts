import { test } from "node:test";
import assert from "node:assert/strict";
import {
  craneParamsSchema,
  deriveGeometry,
  LIMITS,
  REFERENCE,
  type CraneParams,
} from "../src/domain/crane.ts";

// Inputs read from the reference drawing (10 t, 25 m span, 7.9 m lift, rail top 8321 mm).
const referenceParams: CraneParams = {
  capacityKg: 10_000,
  spanMm: 25_000,
  railHeightMm: 8_321,
  liftingHeightMm: 7_900,
};

function issuesFor(input: unknown): string[] {
  const result = craneParamsSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => i.path.join("."));
}

test("reference drawing inputs are valid", () => {
  assert.deepEqual(issuesFor(referenceParams), []);
});

test("derived geometry reproduces the reference drawing dimensions", () => {
  const g = deriveGeometry(referenceParams);
  assert.equal(g.bridgeOverallLengthMm, 25_270);
  assert.equal(g.wheelbaseMm, 3_800);
  assert.equal(g.endCarriageLengthMm, 4_310);
  assert.equal(g.craneHeightAboveRailMm, 1_369);
  assert.equal(g.hookApproachLeftMm, 920);
  assert.equal(g.hookApproachRightMm, 1_150);
  assert.equal(g.minEndClearanceMm, 235);
  assert.equal(g.minTopClearanceMm, 200);
  // rail top + crane height + top clearance
  assert.equal(g.minBuildingClearHeightMm, 8_321 + 1_369 + 200);
  assert.equal(g.hookCoverageMm, 25_000 - 920 - 1_150);
  // Reference: highest hook 7900 above floor and 7.9 m lift, so the hook reaches the floor.
  assert.equal(g.hookHighestAboveFloorMm, 7_900);
  assert.equal(g.hookLowestAboveFloorMm, 0);
});

test("a shorter lift leaves the lowest hook position above the floor", () => {
  const g = deriveGeometry({ ...referenceParams, liftingHeightMm: 5_000 });
  assert.equal(g.hookHighestAboveFloorMm, 7_900);
  assert.equal(g.hookLowestAboveFloorMm, 2_900);
});

test("span limits are inclusive", () => {
  assert.deepEqual(issuesFor({ ...referenceParams, spanMm: LIMITS.spanMm.min }), []);
  assert.deepEqual(issuesFor({ ...referenceParams, spanMm: LIMITS.spanMm.max }), []);
  assert.deepEqual(issuesFor({ ...referenceParams, spanMm: LIMITS.spanMm.min - 1 }), ["spanMm"]);
  assert.deepEqual(issuesFor({ ...referenceParams, spanMm: LIMITS.spanMm.max + 1 }), ["spanMm"]);
});

test("rail height limits are inclusive", () => {
  const atMin = { ...referenceParams, railHeightMm: LIMITS.railHeightMm.min, liftingHeightMm: LIMITS.liftingHeightMm.min };
  assert.deepEqual(issuesFor(atMin), []);
  assert.deepEqual(issuesFor({ ...referenceParams, railHeightMm: LIMITS.railHeightMm.max }), []);
  assert.deepEqual(issuesFor({ ...atMin, railHeightMm: LIMITS.railHeightMm.min - 1 }), ["railHeightMm"]);
  assert.deepEqual(issuesFor({ ...referenceParams, railHeightMm: LIMITS.railHeightMm.max + 1 }), ["railHeightMm"]);
});

test("lifting height must leave room for the hook below the rail", () => {
  const highest = referenceParams.railHeightMm - REFERENCE.hookTopBelowRailMm;
  assert.deepEqual(issuesFor({ ...referenceParams, liftingHeightMm: highest }), []);
  assert.deepEqual(issuesFor({ ...referenceParams, liftingHeightMm: highest + 1 }), ["liftingHeightMm"]);
  assert.deepEqual(issuesFor({ ...referenceParams, liftingHeightMm: LIMITS.liftingHeightMm.min - 1 }), ["liftingHeightMm"]);
});

test("capacity must be one of the listed standard capacities", () => {
  assert.deepEqual(issuesFor({ ...referenceParams, capacityKg: 5_000 }), []);
  assert.deepEqual(issuesFor({ ...referenceParams, capacityKg: 7_000 }), ["capacityKg"]);
  assert.deepEqual(issuesFor({ ...referenceParams, capacityKg: 0 }), ["capacityKg"]);
});

test("rejects non-integers, non-numbers, missing and unknown fields", () => {
  assert.deepEqual(issuesFor({ ...referenceParams, spanMm: 25_000.5 }), ["spanMm"]);
  assert.deepEqual(issuesFor({ ...referenceParams, spanMm: "25000" }), ["spanMm"]);
  assert.deepEqual(issuesFor({ ...referenceParams, spanMm: Number.NaN }), ["spanMm"]);
  assert.deepEqual(issuesFor({ ...referenceParams, spanMm: null }), ["spanMm"]);
  const { spanMm: _omit, ...missingSpan } = referenceParams;
  assert.deepEqual(issuesFor(missingSpan), ["spanMm"]);
  assert.ok(issuesFor({ ...referenceParams, isAdmin: true }).length > 0);
  assert.ok(issuesFor(null).length > 0);
  assert.ok(issuesFor([]).length > 0);
});

test("wheelbase never goes below the minimum on short spans", () => {
  const g = deriveGeometry({ ...referenceParams, spanMm: LIMITS.spanMm.min });
  assert.equal(g.wheelbaseMm, REFERENCE.minWheelbaseMm);
});

test("derived values are whole millimetres and positive across the input range", () => {
  for (const spanMm of [LIMITS.spanMm.min, 12_345, LIMITS.spanMm.max]) {
    const g = deriveGeometry({ ...referenceParams, spanMm });
    for (const [key, value] of Object.entries(g)) {
      // The lowest hook position is exactly 0 when the hook reaches the floor; every other value must be > 0.
      const min = key === "hookLowestAboveFloorMm" ? 0 : 1;
      assert.ok(Number.isInteger(value) && value >= min, `${key}=${value} at span ${spanMm}`);
    }
  }
});
