import { z } from "zod";

/**
 * Domain model for a single-girder overhead (EOT) crane.
 *
 * Every number here is either a user input or a constant read from the
 * reference drawing supplied with the brief (10 t, 25 m span). Nothing is a
 * structural calculation. Each constant says where it came from and whether
 * it is a direct reading or an estimate; README.md lists them again for
 * reviewers.
 *
 * All lengths are whole millimetres, the unit used on the reference drawing.
 */

/** Hoist capacities offered, in kg. ASSUMPTION: common catalogue steps (1-20 t). */
export const CAPACITIES_KG = [1_000, 2_000, 3_200, 5_000, 6_300, 8_000, 10_000, 12_500, 16_000, 20_000] as const;

/** Input ranges. ESTIMATES chosen to cover typical single-girder cranes around the reference; not from a standard. */
export const LIMITS = {
  spanMm: { min: 5_000, max: 30_000 },
  railHeightMm: { min: 3_000, max: 20_000 },
  liftingHeightMm: { min: 1_000 },
} as const;

/** Constants read from the reference drawing. See README "Where the numbers come from". */
export const REFERENCE = {
  /** Reference: span 25000, overall bridge length 25270 -> 135 mm past each rail centre. Direct reading. */
  endOverhangMm: 135,
  /** Reference: wheelbase 3800 at span 25000. ESTIMATE: assumed to scale linearly with span. */
  wheelbaseAtReferenceSpanMm: 3_800,
  referenceSpanMm: 25_000,
  /** ESTIMATE (no source): keeps short-span end carriages from becoming unrealistically short. */
  minWheelbaseMm: 2_000,
  /** Reference: end carriage 4310 overall vs 3800 wheelbase -> 510 mm. Direct reading. */
  endCarriageExtraMm: 510,
  /** Reference: crane top is 1369 above rail top at span 25000. ESTIMATE: assumed to scale linearly with span. */
  craneHeightAtReferenceSpanMm: 1_369,
  /** ESTIMATE (no source): lower bound for crane height above rail on short spans. */
  minCraneHeightAboveRailMm: 500,
  /** Reference: rail top 8321, highest hook 7900 -> hook stops 421 below rail top. Direct reading, valid for that hoist only. */
  hookTopBelowRailMm: 421,
  /** Reference: "Min.920" left and "Min.1150" right hook approach from rail centre. Direct reading, valid for that hoist only. */
  hookApproachLeftMm: 920,
  hookApproachRightMm: 1_150,
  /** Reference: "Min.235" rail centre to wall. Direct reading. */
  minEndClearanceMm: 235,
  /** Reference: 200 between crane top and roof. Direct reading. */
  minTopClearanceMm: 200,
} as const;

const mm = (field: string, min: number, max?: number) => {
  const range = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
  const message = `${field} must be a whole number of millimetres ${range}`;
  const base = z.int({ error: message }).min(min, { error: message });
  return max === undefined ? base : base.max(max, { error: message });
};

export const craneParamsSchema = z
  .strictObject({
    capacityKg: z.int({ error: "Capacity must be a whole number of kg" }).refine(
      (v) => (CAPACITIES_KG as readonly number[]).includes(v),
      { error: `Capacity must be one of: ${CAPACITIES_KG.join(", ")} kg` },
    ),
    spanMm: mm("Span", LIMITS.spanMm.min, LIMITS.spanMm.max),
    railHeightMm: mm("Rail height", LIMITS.railHeightMm.min, LIMITS.railHeightMm.max),
    liftingHeightMm: mm("Lifting height", LIMITS.liftingHeightMm.min),
  })
  .superRefine((p, ctx) => {
    const highestHook = p.railHeightMm - REFERENCE.hookTopBelowRailMm;
    if (p.liftingHeightMm > highestHook) {
      ctx.addIssue({
        code: "custom",
        path: ["liftingHeightMm"],
        message: `Lifting height can be at most ${highestHook} mm for this rail height (hook stops ${REFERENCE.hookTopBelowRailMm} mm below rail top)`,
      });
    }
  });

export type CraneParams = z.infer<typeof craneParamsSchema>;

export interface CraneGeometry {
  bridgeOverallLengthMm: number;
  wheelbaseMm: number;
  endCarriageLengthMm: number;
  craneHeightAboveRailMm: number;
  hookApproachLeftMm: number;
  hookApproachRightMm: number;
  hookTravelMm: number;
  minEndClearanceMm: number;
  minTopClearanceMm: number;
  minBuildingClearHeightMm: number;
}

const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step;

/** Derives the drawing dimensions from already-validated inputs. Pure and deterministic. */
export function deriveGeometry(p: CraneParams): CraneGeometry {
  const r = REFERENCE;
  const wheelbaseMm = Math.max(
    r.minWheelbaseMm,
    ceilTo((p.spanMm * r.wheelbaseAtReferenceSpanMm) / r.referenceSpanMm, 100),
  );
  const craneHeightAboveRailMm = Math.max(
    r.minCraneHeightAboveRailMm,
    Math.ceil((p.spanMm * r.craneHeightAtReferenceSpanMm) / r.referenceSpanMm),
  );
  return {
    bridgeOverallLengthMm: p.spanMm + 2 * r.endOverhangMm,
    wheelbaseMm,
    endCarriageLengthMm: wheelbaseMm + r.endCarriageExtraMm,
    craneHeightAboveRailMm,
    hookApproachLeftMm: r.hookApproachLeftMm,
    hookApproachRightMm: r.hookApproachRightMm,
    hookTravelMm: p.spanMm - r.hookApproachLeftMm - r.hookApproachRightMm,
    minEndClearanceMm: r.minEndClearanceMm,
    minTopClearanceMm: r.minTopClearanceMm,
    minBuildingClearHeightMm: p.railHeightMm + craneHeightAboveRailMm + r.minTopClearanceMm,
  };
}
