import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGeometry, LIMITS, type CraneParams } from "../src/domain/crane.ts";
import { renderDrawing } from "../src/domain/drawing.ts";

const params: CraneParams = { capacityKg: 10_000, spanMm: 25_000, railHeightMm: 8_321, liftingHeightMm: 7_900 };

function render(p: CraneParams = params, name = "Bay 1 crane") {
  return renderDrawing({ name, params: p, geometry: deriveGeometry(p) });
}

test("renders a standalone SVG document", () => {
  const svg = render();
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<\/svg>$/);
});

test("labels every input and derived dimension", () => {
  const svg = render();
  for (const label of [
    ">25000<", // span
    ">8321<", // rail height
    ">7900<", // lifting height
    ">1369<", // crane height above rail
    ">25270<", // bridge overall length
    ">3800<", // wheelbase
    ">4310<", // end carriage length
    ">Min. 920<",
    ">Min. 1150<",
    ">Min. 235<",
    ">Min. 200<",
    ">10 t<",
  ]) {
    assert.ok(svg.includes(label), `missing ${label}`);
  }
});

test("marks the drawing as an estimate, not for construction", () => {
  assert.match(render(), /NOT FOR CONSTRUCTION/);
});

test("escapes the user-supplied design name", () => {
  const svg = render(params, `<script>alert("x")</script> & 'q'`);
  assert.ok(!svg.includes("<script"), "raw script tag leaked into SVG");
  assert.ok(svg.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;"));
});

test("is deterministic", () => {
  assert.equal(render(), render());
});

test("produces finite coordinates at the edges of the input range", () => {
  const cases: CraneParams[] = [
    { capacityKg: 1_000, spanMm: LIMITS.spanMm.min, railHeightMm: LIMITS.railHeightMm.min, liftingHeightMm: LIMITS.liftingHeightMm.min },
    { capacityKg: 20_000, spanMm: LIMITS.spanMm.max, railHeightMm: LIMITS.railHeightMm.max, liftingHeightMm: LIMITS.railHeightMm.max - 421 },
    { capacityKg: 3_200, spanMm: LIMITS.spanMm.max, railHeightMm: LIMITS.railHeightMm.min, liftingHeightMm: LIMITS.liftingHeightMm.min },
  ];
  for (const p of cases) {
    const svg = render(p);
    assert.ok(!/NaN|Infinity|undefined/.test(svg), JSON.stringify(p));
  }
});

test("formats fractional tonnes without trailing noise", () => {
  assert.ok(render({ ...params, capacityKg: 3_200 }).includes(">3.2 t<"));
  assert.ok(render({ ...params, capacityKg: 12_500 }).includes(">12.5 t<"));
});
