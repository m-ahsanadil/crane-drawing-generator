import type { CraneGeometry, CraneParams } from "./crane.ts";

/**
 * Renders a dimensioned 2D drawing (front elevation + plan view + data table)
 * as a standalone SVG string. Pure function: same input, same output.
 *
 * Main members are drawn to a uniform scale per view. Hoist, hook, wheels and
 * walls are schematic symbols; only the dimension labels carry real values.
 */

export interface DrawingInput {
  name: string;
  params: CraneParams;
  geometry: CraneGeometry;
  /** Present for saved designs; omitted for unsaved previews. */
  saved?: { id: number; version: number };
}

const W = 1600;
const H = 1000;
const FONT = "Arial, Helvetica, sans-serif";
const CHAR_W = 7; // approximate width of a 13px character, used to decide label placement

// Escapes markup and drops characters XML 1.0 forbids, so the SVG stays parseable whatever text it gets.
const esc = (s: string) =>
  s
    .toWellFormed()
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
/**
 * Cuts by user-visible characters (graphemes), never inside one: slicing UTF-16 units
 * split emoji into a lone surrogate, which then showed as U+FFFD.
 */
function shorten(s: string, max: number): string {
  const parts = Array.from(graphemes.segment(s), (g) => g.segment);
  return parts.length > max ? `${parts.slice(0, max - 1).join("")}…` : s;
}
const n = (v: number) => String(Math.round(v * 10) / 10);
const tonnes = (kg: number) => `${kg / 1000} t`;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Maps world millimetres (y up) into a pixel box (y down) with one uniform scale. */
function viewport(world: { xMin: number; xMax: number; yMin: number; yMax: number }, box: Box) {
  const s = Math.min(box.w / (world.xMax - world.xMin), box.h / (world.yMax - world.yMin));
  const offX = box.x + (box.w - (world.xMax - world.xMin) * s) / 2;
  const offY = box.y + box.h - (box.h - (world.yMax - world.yMin) * s) / 2;
  return {
    s,
    x: (mm: number) => offX + (mm - world.xMin) * s,
    y: (mm: number) => offY - (mm - world.yMin) * s,
  };
}

class Svg {
  private parts: string[] = [];

  add(el: string) {
    this.parts.push(el);
  }

  line(x1: number, y1: number, x2: number, y2: number, cls = "") {
    this.add(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"${cls ? ` class="${cls}"` : ""}/>`);
  }

  rect(x: number, y: number, w: number, h: number, cls = "") {
    const [rx, rw] = w < 0 ? [x + w, -w] : [x, w];
    const [ry, rh] = h < 0 ? [y + h, -h] : [y, h];
    this.add(`<rect x="${n(rx)}" y="${n(ry)}" width="${n(rw)}" height="${n(rh)}"${cls ? ` class="${cls}"` : ""}/>`);
  }

  text(x: number, y: number, label: string, opts: { anchor?: "start" | "middle" | "end"; cls?: string; rotate?: boolean } = {}) {
    const anchor = opts.anchor ?? "middle";
    const rot = opts.rotate ? ` transform="rotate(-90 ${n(x)} ${n(y)})"` : "";
    const cls = opts.cls ? ` class="${opts.cls}"` : "";
    this.add(`<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}"${cls}${rot}>${esc(label)}</text>`);
  }

  /** Horizontal dimension between x1 and x2 at height y; extension lines start at fromY1/fromY2. */
  dimH(x1: number, x2: number, y: number, label: string, fromY1 = y, fromY2 = y) {
    const dir1 = Math.sign(y - fromY1) || 1;
    const dir2 = Math.sign(y - fromY2) || 1;
    if (fromY1 !== y) this.line(x1, fromY1, x1, y + 4 * dir1, "ext");
    if (fromY2 !== y) this.line(x2, fromY2, x2, y + 4 * dir2, "ext");
    this.add(`<line x1="${n(x1)}" y1="${n(y)}" x2="${n(x2)}" y2="${n(y)}" class="dim"/>`);
    if (Math.abs(x2 - x1) > label.length * CHAR_W + 12) {
      this.text((x1 + x2) / 2, y - 5, label);
    } else {
      this.text(Math.max(x1, x2) + 6, y + 4, label, { anchor: "start" });
    }
  }

  /** Vertical dimension between y1 and y2 at x; extension lines start at fromX1/fromX2. */
  dimV(y1: number, y2: number, x: number, label: string, fromX1 = x, fromX2 = x) {
    const dir1 = Math.sign(x - fromX1) || 1;
    const dir2 = Math.sign(x - fromX2) || 1;
    if (fromX1 !== x) this.line(fromX1, y1, x + 4 * dir1, y1, "ext");
    if (fromX2 !== x) this.line(fromX2, y2, x + 4 * dir2, y2, "ext");
    this.add(`<line x1="${n(x)}" y1="${n(y1)}" x2="${n(x)}" y2="${n(y2)}" class="dim"/>`);
    if (Math.abs(y2 - y1) > label.length * CHAR_W + 12) {
      this.text(x - 5, (y1 + y2) / 2, label, { rotate: true });
    } else {
      this.text(x + 6, (y1 + y2) / 2 + 4, label, { anchor: "start" });
    }
  }

  toString() {
    return this.parts.join("");
  }
}

function frontElevation(svg: Svg, p: CraneParams, g: CraneGeometry, box: Box) {
  const wall = 400; // schematic wall thickness, mm
  const clear = g.minBuildingClearHeightMm;
  const v = viewport(
    { xMin: -g.minEndClearanceMm - wall, xMax: p.spanMm + g.minEndClearanceMm + wall, yMin: -300, yMax: clear + 150 },
    box,
  );
  const { x, y } = v;
  const ch = g.craneHeightAboveRailMm;
  const railTop = p.railHeightMm;
  const girderBottom = railTop + ch * 0.35;
  const mid = p.spanMm / 2;

  svg.text(box.x, box.y - 12, "FRONT ELEVATION", { anchor: "start", cls: "title" });

  // Floor, walls, roof line
  svg.line(x(-g.minEndClearanceMm - wall), y(0), x(p.spanMm + g.minEndClearanceMm + wall), y(0), "thick");
  svg.rect(x(-g.minEndClearanceMm - wall), y(0), wall * v.s, -(clear * v.s), "wall");
  svg.rect(x(p.spanMm + g.minEndClearanceMm), y(0), wall * v.s, -(clear * v.s), "wall");
  // Dashed line = minimum clear height (roof or lowest obstruction).
  svg.line(x(-g.minEndClearanceMm), y(clear), x(p.spanMm + g.minEndClearanceMm), y(clear), "hidden");
  svg.text(x(mid), y(0) + 16, "Floor ±0", { cls: "note" });

  // Runway beams (schematic) under each rail
  for (const rx of [0, p.spanMm]) {
    svg.rect(x(rx - 150), y(railTop), 300 * v.s, 350 * v.s, "member");
  }

  // End carriages and girder
  for (const rx of [0, p.spanMm]) {
    svg.rect(x(rx - 135), y(railTop), 270 * v.s, -(ch * 0.55 * v.s), "member");
  }
  svg.rect(x(-135), y(railTop + ch), g.bridgeOverallLengthMm * v.s, (ch * 0.65) * v.s, "member");
  svg.text(x(mid), y(railTop + ch * 0.68) + 4, tonnes(p.capacityKg), { cls: "load" });

  // Hoist under the girder (schematic). Hook drawn at its highest position;
  // the lowest position is a dashed line. Lifting height = travel between them.
  const hookTop = g.hookHighestAboveFloorMm;
  const hookLow = g.hookLowestAboveFloorMm;
  const hoistBottom = hookTop + 250;
  const hook = (atMm: number) =>
    svg.add(`<path d="M${n(x(mid))} ${n(y(atMm))} q0 7 -5 7 q-5 0 -5 -5" class="thin"/>`);
  svg.rect(x(mid - 600), y(girderBottom), 1200 * v.s, (girderBottom - hoistBottom) * v.s, "member");
  svg.line(x(mid), y(hoistBottom), x(mid), y(hookTop), "thin");
  hook(hookTop);
  if (hookLow > 0) {
    svg.line(x(mid - 900), y(hookLow), x(mid + 900), y(hookLow), "hidden");
    // Skip the label when it would sit on the floor line; the dimension still shows the travel.
    if (y(0) - y(hookLow) > 14) {
      svg.text(x(mid + 900) + 4, y(hookLow) + 4, "Lowest hook position", { anchor: "start", cls: "note" });
    }
  }

  // Hook approach limits
  const leftHook = g.hookApproachLeftMm;
  const rightHook = p.spanMm - g.hookApproachRightMm;
  svg.line(x(leftHook), y(girderBottom), x(leftHook), y(0), "hidden");
  svg.line(x(rightHook), y(girderBottom), x(rightHook), y(0), "hidden");

  // Centre lines of the rails
  svg.line(x(0), y(clear) - 10, x(0), y(0) + 4, "center");
  svg.line(x(p.spanMm), y(clear) - 10, x(p.spanMm), y(0) + 4, "center");

  // Dimensions
  const top = y(clear) - 30;
  svg.dimH(x(0), x(p.spanMm), top, String(p.spanMm), y(railTop), y(railTop));
  svg.dimH(x(-g.minEndClearanceMm), x(0), top + 20, `Min. ${g.minEndClearanceMm}`);
  svg.dimH(x(p.spanMm), x(p.spanMm + g.minEndClearanceMm), top + 20, `Min. ${g.minEndClearanceMm}`);

  const left = x(-g.minEndClearanceMm - wall) - 18;
  svg.dimV(y(0), y(railTop), left, String(railTop), x(0) - 150 * v.s, x(0) - 150 * v.s);

  const liftX = x(mid - 900);
  svg.dimV(y(hookLow), y(hookTop), liftX, String(p.liftingHeightMm), x(mid - 900), x(mid));

  const right = x(p.spanMm + g.minEndClearanceMm + wall) + 22;
  svg.dimV(y(railTop), y(railTop + ch), right, String(ch), x(p.spanMm + 135), x(p.spanMm + 135));
  svg.dimV(y(railTop + ch), y(clear), right + 44, `Min. ${g.minTopClearanceMm}`, x(p.spanMm + 135), x(p.spanMm + g.minEndClearanceMm));

  const hookY = y(p.liftingHeightMm / 2);
  svg.dimH(x(0), x(leftHook), hookY, `Min. ${g.hookApproachLeftMm}`);
  svg.dimH(x(rightHook), x(p.spanMm), hookY, `Min. ${g.hookApproachRightMm}`);
}

function planView(svg: Svg, p: CraneParams, g: CraneGeometry, box: Box) {
  const half = g.endCarriageLengthMm / 2;
  const v = viewport({ xMin: -400, xMax: p.spanMm + 400, yMin: -half - 600, yMax: half + 600 }, box);
  const { x, y } = v;
  const girderHalf = 250; // schematic girder width, mm

  svg.text(box.x, box.y - 12, "PLAN VIEW", { anchor: "start", cls: "title" });

  // Runway rails run perpendicular to the bridge
  for (const rx of [0, p.spanMm]) svg.line(x(rx), y(half + 500), x(rx), y(-half - 500), "center");

  // Girder, end carriages, wheels, trolley
  svg.rect(x(-135), y(girderHalf), g.bridgeOverallLengthMm * v.s, 2 * girderHalf * v.s, "member");
  for (const rx of [0, p.spanMm]) {
    svg.rect(x(rx - 135), y(half), 270 * v.s, g.endCarriageLengthMm * v.s, "member");
    for (const wy of [g.wheelbaseMm / 2, -g.wheelbaseMm / 2]) {
      svg.rect(x(rx) - 4, y(wy) - 6, 8, 12, "wheel");
    }
  }
  svg.rect(x(p.spanMm / 2 - 600), y(600), 1200 * v.s, 1200 * v.s, "member");

  // Dimensions
  const below = y(-half) + 30;
  svg.dimH(x(-135), x(p.spanMm + 135), below, String(g.bridgeOverallLengthMm), y(-half), y(-half));
  svg.dimH(x(0), x(p.spanMm), y(half) - 22, String(p.spanMm), y(half), y(half));
  const right = x(p.spanMm + 135) + 24;
  svg.dimV(y(-g.wheelbaseMm / 2), y(g.wheelbaseMm / 2), right, String(g.wheelbaseMm), x(p.spanMm), x(p.spanMm));
  svg.dimV(y(-half), y(half), right + 34, String(g.endCarriageLengthMm), x(p.spanMm + 135), x(p.spanMm + 135));
}

function dataTable(svg: Svg, input: DrawingInput, box: Box) {
  const { params: p, geometry: g } = input;
  const rows: [string, string][] = [
    ["Design", input.name],
    ["Revision", input.saved ? `#${input.saved.id} v${input.saved.version}` : "unsaved preview"],
    ["Type", "Single-girder EOT crane"],
    ["Rated load", `${tonnes(p.capacityKg)} (${p.capacityKg} kg)`],
    ["Span (rail centres)", `${p.spanMm}`],
    ["Rail top above floor", `${p.railHeightMm}`],
    ["Lifting height (hook travel)", `${p.liftingHeightMm}`],
    ["Highest hook above floor *", `${g.hookHighestAboveFloorMm}`],
    ["Lowest hook above floor *", `${g.hookLowestAboveFloorMm}`],
    ["Bridge overall length", `${g.bridgeOverallLengthMm}`],
    ["End carriage wheelbase *", `${g.wheelbaseMm}`],
    ["End carriage length *", `${g.endCarriageLengthMm}`],
    ["Crane height above rail *", `${g.craneHeightAboveRailMm}`],
    ["Hook coverage across span *", `${g.hookCoverageMm}`],
    ["Min. building clear height *", `${g.minBuildingClearHeightMm}`],
  ];
  svg.text(box.x, box.y, "TECHNICAL DATA", { anchor: "start", cls: "title" });
  svg.line(box.x, box.y + 6, box.x + box.w, box.y + 6);
  rows.forEach(([k, val], i) => {
    const ry = box.y + 30 + i * 24;
    svg.text(box.x, ry, k, { anchor: "start" });
    // Long names are cut so they cannot run off the sheet; the full name is stored in the database.
    svg.text(box.x + box.w, ry, shorten(val, 28), { anchor: "end" });
    svg.line(box.x, ry + 7, box.x + box.w, ry + 7, "row");
  });

  const notes = [
    "All dimensions in mm.",
    "* ESTIMATE: scaled from one reference drawing",
    "  (10 t, 25 m span). Hook limits are for the",
    "  reference hoist. See README for sources.",
    "No structural design was performed.",
    "NOT FOR CONSTRUCTION. DO NOT SCALE.",
  ];
  notes.forEach((line, i) => {
    svg.text(box.x, box.y + 30 + rows.length * 24 + 24 + i * 18, line, { anchor: "start", cls: i === notes.length - 1 ? "warn" : "note" });
  });
}

export function renderDrawing(input: DrawingInput): string {
  const svg = new Svg();
  svg.add(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`);
  svg.add(`<rect x="10" y="10" width="${W - 20}" height="${H - 20}" class="frame"/>`);
  frontElevation(svg, input.params, input.geometry, { x: 70, y: 70, w: 1000, h: 520 });
  planView(svg, input.params, input.geometry, { x: 70, y: 680, w: 1060, h: 280 });
  dataTable(svg, input, { x: 1210, y: 70, w: 350, h: 800 });

  const style = [
    `text{font-family:${FONT};font-size:13px;fill:#111}`,
    ".title{font-size:15px;font-weight:bold}",
    ".note{font-size:12px;fill:#444}",
    ".warn{font-size:12px;font-weight:bold;fill:#b00020}",
    ".load{font-size:14px;font-weight:bold}",
    "line,path,rect{fill:none;stroke:#111;stroke-width:1}",
    ".frame{stroke-width:2}",
    ".thick{stroke-width:2}",
    ".thin{stroke-width:1.2}",
    ".member{fill:#f2f2f2;stroke-width:1.5}",
    ".wheel{fill:#111}",
    ".wall{fill:#e6e1d8;stroke:#8a8070}",
    ".ext,.row{stroke:#999;stroke-width:0.7}",
    ".dim{stroke:#0b57d0;marker-start:url(#arrow);marker-end:url(#arrow)}",
    ".hidden{stroke:#666;stroke-dasharray:6 4}",
    ".center{stroke:#666;stroke-dasharray:14 3 2 3;stroke-width:0.8}",
  ].join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`Crane drawing: ${input.name}`)}">` +
    `<style>${style}</style>` +
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#0b57d0" stroke="none"/></marker></defs>` +
    svg.toString() +
    `</svg>`
  );
}
