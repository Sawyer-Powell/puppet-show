import test from "node:test";
import { execFileSync } from "node:child_process";

test("cached pass results reproduce the pass and the pixel diff locates changes", () => {
  execFileSync(process.execPath, ["test/incremental.browser.mjs"], { stdio: "inherit", timeout: 180_000 });
});
