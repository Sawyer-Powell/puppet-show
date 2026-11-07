import test from "node:test";
import { execFileSync } from "node:child_process";

test("step addresses deep-link to the walked deck state and shots write PNGs", () => {
  execFileSync(process.execPath, ["test/frames.browser.mjs"], { stdio: "inherit", timeout: 120_000 });
});
