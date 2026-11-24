import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_API_PORT, parseApiPort } from "../src/config.ts";

test("API_PORT defaults when unset or empty", () => {
  assert.equal(parseApiPort(undefined), DEFAULT_API_PORT);
  assert.equal(parseApiPort(""), DEFAULT_API_PORT);
});

test("API_PORT accepts plain decimal ports 1-65535", () => {
  assert.equal(parseApiPort("1"), 1);
  assert.equal(parseApiPort("8787"), 8787);
  assert.equal(parseApiPort("65535"), 65535);
});

test("API_PORT refuses every other spelling, so server and Vite proxy cannot disagree (V6)", () => {
  for (const raw of ["0x1F90", "1e3", "8787.0", " 8787", "8787 ", "+8787", "08787", "0", "65536", "-1", "abc"]) {
    assert.throws(() => parseApiPort(raw), /API_PORT/, JSON.stringify(raw));
  }
});
