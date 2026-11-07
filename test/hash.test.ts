import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chapterIds, stepIds, hashTarget } from "../src/ui/deck.ts";

test("chapter slugs dedupe including explicit ids and numeric aliases", () => {
  assert.deepEqual(chapterIds([{ title: "Hello?! World" }, { title: "Hello World" }, { title: "other", id: "hello-world-2" }, { title: "123" }]), ["hello-world", "hello-world-3", "hello-world-2", "chapter-123"]);
  assert.throws(() => chapterIds([{ title: "a", id: "1" }]));
  assert.throws(() => chapterIds([{ title: "a", id: "x" }, { title: "b", id: "x" }]));
});
test("the unique ending beat names its step; ambiguous and numeric beats use positions", () => {
  assert.deepEqual(stepIds(["first", "repeat", "repeat", "", "2", "a/b"].map(name => ({ name }))), ["first", "2", "3", "4", "5", "a/b"]);
});
test("hash readers accept names and numeric aliases, reject malformed input silently", () => {
  const ids = ["intro", "a/b"], steps = [["hello", "2"], ["end"]];
  for (const hash of ["#intro/hello", "#1/1", "#1", "#intro"]) assert.deepEqual(hashTarget(hash, ids, steps), [0, 0]);
  assert.deepEqual(hashTarget("#intro/2", ids, steps), [0, 1]);
  assert.deepEqual(hashTarget("#a%2Fb/end", ids, steps), [1, 0]);
  for (const hash of ["", "#", "#0", "#intro/0", "#intro/3", "#unknown", "#intro/no", "#%ZZ", "#1/1/1", "#1/"]) assert.equal(hashTarget(hash, ids, steps), null);
});
test("URL fragment browser integration", { timeout: 240_000 }, () => {
  execFileSync(process.execPath, ["test/hash.browser.mjs"], { stdio: "inherit", timeout: 230_000 });
});
