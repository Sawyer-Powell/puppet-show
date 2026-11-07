import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { radioTarget } from "../src/ui/radio.ts";

test("radio navigation wraps, skips disabled options, and handles boundaries", () => {
  const enabled = [0, 2, 3];
  for (const key of ["ArrowRight", "ArrowDown"]) {
    assert.equal(radioTarget(key, 0, enabled), 2);
    assert.equal(radioTarget(key, 3, enabled), 0);
  }
  for (const key of ["ArrowLeft", "ArrowUp"]) {
    assert.equal(radioTarget(key, 0, enabled), 3);
    assert.equal(radioTarget(key, 3, enabled), 2);
  }
  assert.equal(radioTarget("Home", 2, enabled), 0);
  assert.equal(radioTarget("End", 0, enabled), 3);
  assert.equal(radioTarget("Tab", 0, enabled), undefined);
  assert.equal(radioTarget("ArrowDown", 0, []), undefined);
  assert.equal(radioTarget("ArrowDown", 2, [2]), 2);
});

test("real keyboard radio behaviour in built examples and disabled fixture", { timeout: 120_000 }, () => {
  execFileSync(process.execPath, ["test/radio.browser.mjs"], { stdio: "inherit", timeout: 115_000 });
});
