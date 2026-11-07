// Also run by incremental.test.ts / npm run check.
// Cached entries must reproduce a pass verbatim: same signatures, same issues,
// and no re-capture. The pixel diff must find where a step moved.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { chrome, endpoints, motion } from "../scripts/verify-browser.mjs";
import { diffPngs } from "../scripts/pixels.mjs";

const name = "puppet-show-explained";
execFileSync(process.execPath, ["scripts/build.mjs", name], { stdio: "inherit", timeout: 60_000 });
const file = `dist/examples/${name}/index.html`;
const out = "node_modules/.cache/incremental/720";
const motionOut = "node_modules/.cache/incremental/motion";
mkdirSync(out, { recursive: true });
mkdirSync(motionOut, { recursive: true });
const browser = await chrome();
const reuseOf = (captured) => new Map(Object.entries(captured).map(([index, entry]) => [Number(index), entry]));
const mtimes = (dir, total) => Array.from({ length: total }, (_, index) =>
  statSync(resolve(dir, `${String(index + 1).padStart(2, "0")}.png`)).mtimeMs);

try {
  const first = await endpoints(browser, { file, out, width: 720, a11y: false });
  assert.equal(Object.keys(first.captured).length, first.total, "a cold pass captures every step");
  const before = mtimes(out, first.total);
  const second = await endpoints(browser, { file, out, width: 720, a11y: false, reuse: reuseOf(first.captured) });
  assert.deepEqual(second.signatures, first.signatures, "reused steps keep their exact state");
  assert.equal(Object.keys(second.captured).length, 0, "nothing is re-captured");
  assert.equal(second.reused.length, first.total);
  assert.deepEqual(mtimes(out, first.total), before, "cached steps keep their PNGs");

  const live = await motion(browser, { file, out: motionOut, width: 720 });
  const replay = await motion(browser, { file, out: motionOut, width: 720, reuse: reuseOf(live.captured) });
  assert.deepEqual(replay.signatures, live.signatures);
  assert.deepEqual(replay.issues, live.issues, "flight and layout issues survive the cache");
  assert.equal(Object.keys(replay.captured).length, 0);

  // A move is found, measured and located; an identical pair is silent.
  const page = await browser.newPage({ viewport: { width: 300, height: 200 } });
  const shot = async (text) => {
    await page.setContent(`<style>body{background:#000;color:#fff;font:24px monospace;margin:0}</style><div style="position:absolute;left:40px;top:60px">${text}</div>`);
    return (await page.screenshot()).toString("base64");
  };
  try {
    const alpha = await shot("alpha");
    const beta = await shot("BETA!");
    assert.equal((await diffPngs(browser, { before: alpha, after: alpha })).pct, 0);
    const moved = await diffPngs(browser, { before: alpha, after: beta });
    assert.ok(moved.pct > 0.0001, "changed pixels are counted");
    assert.ok(moved.bbox && moved.bbox.x >= 35 && moved.bbox.x <= 50, `bbox starts at the text: ${JSON.stringify(moved.bbox)}`);
    assert.ok(moved.bbox.y >= 55 && moved.bbox.y <= 95, "bbox covers the text line, not the whole page");
    assert.ok(moved.bbox.width >= 40 && moved.bbox.height >= 16, "bbox is not a single pixel");
    assert.match(moved.png, /^data:image\/png;base64,/, "a cropped diff image is produced");
  } finally { await page.close(); }
  assert.ok(readFileSync(resolve(out, "01.png")).length > 0);
} finally { await browser.close(); }
