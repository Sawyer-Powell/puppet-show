import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("conditional chrome, typed cursor and single-line keyboard chapter tabs", { timeout: 90_000 }, () => {
  execFileSync(process.execPath, ["test/chrome.browser.mjs"], { stdio: "inherit", timeout: 85_000 });
});

test("chapter tabs never double-number titles", async () => {
  const { tabLabel } = await import("../src/ui/deck.ts");
  assert.equal(tabLabel(0, "run a task"), "01 run a task");
  assert.equal(tabLabel(11, "go back"), "12 go back");
  assert.equal(tabLabel(0, "1 · run a task"), "1 · run a task");
  assert.equal(tabLabel(2, "03 go back"), "03 go back");
});
