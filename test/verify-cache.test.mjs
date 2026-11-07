import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CACHE_VERSION, closureOf, invalidation, parseChapterScenes } from "../scripts/verify-cache.mjs";

// Synthetic tree: chapter A imports a shared module, chapter B does not, and
// `style.css` plus `main.ts` sit outside every scene's import closure.
const root = resolve("node_modules/.cache/verify-cache-fixture");
mkdirSync(resolve(root, "scenes"), { recursive: true });
const files = {
  "main.ts": `import { deck } from "../../src/index.ts";
import "./style.css";
import { a } from "./scenes/a.ts";
import { b } from "./scenes/b.ts";
deck(document.body, {
  chapters: [
    { title: "one", scene: a },
    { title: "two", scene: b },
  ],
});`,
  "style.css": ".x { color: var(--ps-text-default); }",
  "scenes/a.ts": `import { shared } from "./shared.ts";
export function* a() { void shared; }`,
  "scenes/b.ts": `export function* b() {}`,
  "scenes/shared.ts": `export const shared = 1;`,
};
for (const [path, content] of Object.entries(files)) writeFileSync(resolve(root, path), content);

const sceneA = resolve(root, "scenes/a.ts");
const sceneB = resolve(root, "scenes/b.ts");
const sceneMap = [sceneA, sceneB];
const chapters = ["one", "one", "two"];
const identity = { cache: CACHE_VERSION, node: "test", chrome: "test", viewportHeight: 900 };
// Hashes are repo-relative, like `sourceHashes()`; closures are absolute.
const keyOf = (path) => resolve(root, path).replace(process.cwd() + "/", "");
const hashes = Object.fromEntries(Object.keys(files).map((path) => [keyOf(path), `hash:${path}`]));
const cacheFor = (overrides = {}) => ({
  version: CACHE_VERSION, identity, files: hashes, chapters, total: 3, steps: {}, ...overrides,
});
const plan = (previous, changed = {}) => invalidation({
  name: "fixture", chapters, previous, identity, sceneMap,
  hashes: { ...hashes, ...Object.fromEntries(Object.entries(changed).map(([path, hash]) => [keyOf(path), hash])) },
});

test("closures follow relative imports and keep unrelated scenes apart", () => {
  const closure = [...closureOf(sceneA)].map((file) => file.replace(root + "/", ""));
  assert.deepEqual(closure.sort(), ["scenes/a.ts", "scenes/shared.ts"]);
  assert.deepEqual([...closureOf(sceneB)].map((file) => file.replace(root + "/", "")), ["scenes/b.ts"]);
});

test("chapter scenes are read from the main.ts template in deck order", () => {
  assert.deepEqual(parseChapterScenes(resolve(root, "main.ts")), [sceneA, sceneB]);
  writeFileSync(resolve(root, "broken-main.ts"), "deck(document.body, { chapters: [inlineScene] });");
  assert.equal(parseChapterScenes(resolve(root, "broken-main.ts")), null, "unparseable structure is not guessed");
});

test("a scene edit re-verifies only that scene's steps", () => {
  const result = plan(cacheFor(), { "scenes/shared.ts": "changed" });
  assert.equal(result.all, false);
  // Chapter one's steps, plus chapter two's first step: the flight leaving the
  // changed chapter is observed while that step plays.
  assert.deepEqual([...result.dirty], [0, 1, 2]);
  assert.deepEqual([...plan(cacheFor(), { "scenes/a.ts": "changed" }).dirty], [0, 1, 2]);
  assert.deepEqual([...plan(cacheFor(), { "scenes/b.ts": "changed" }).dirty], [2], "a last chapter needs no landing step");
});

test("edits outside every scene closure, or unknown state, invalidate the deck", () => {
  for (const changed of [{ "style.css": "changed" }, { "main.ts": "changed" }, { "src/ui/tokens.ts": "changed" }]) {
    assert.equal(plan(cacheFor(), changed).all, true, Object.keys(changed).join());
  }
  assert.equal(plan(null).all, true, "no cache");
  assert.equal(plan(cacheFor({ version: CACHE_VERSION + 1 })).all, true, "cache format");
  assert.equal(plan(cacheFor({ identity: { ...identity, chrome: "updated" } })).all, true, "browser changed");
  assert.equal(plan(cacheFor({ chapters: ["one", "two", "two"] })).all, true, "deck structure changed");
});

test("unchanged sources are fully reusable", () => {
  const result = plan(cacheFor());
  assert.equal(result.all, false);
  assert.equal(result.dirty.size, 0);
  assert.match(result.reason, /unchanged/);
});
