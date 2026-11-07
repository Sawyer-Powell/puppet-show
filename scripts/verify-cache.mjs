// Incremental verification cache.
//
// A step's settled state is a pure function of the sources that produce it, so
// results can be reused verbatim for byte-identical inputs. One scene edit must
// therefore re-verify that scene's steps only, not the whole deck.
//
// Invalidation unit: the scene file behind a chapter, widened to every scene
// that transitively imports a changed file, plus the first step of the chapter
// that follows a changed one (that is where the leaving flight is observed).
// A change outside every scene's import closure (shared `src/`, CSS, `main.ts`,
// `index.html`) invalidates the whole deck. Unparseable structure also
// invalidates everything: slower, never wrong.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sourceDir } from "./sources.mjs";

export const CACHE_VERSION = 1;

const sha1 = (data) => createHash("sha1").update(data).digest("hex");
const relative = (from, to) => resolve(dirname(from), to);

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

/** Content hashes of every file a deck is built from; mtime alone is not enough. */
export function sourceHashes(name) {
  const root = sourceDir(name);
  if (!root) throw new Error(`no examples/${name}/index.html or recipes/${name}/index.html`);
  const files = [...walk("src"), ...walk(root), "vite.config.ts"].filter((file) => existsSync(file));
  return Object.fromEntries(files.map((file) => [file, sha1(readFileSync(file))]));
}

const IMPORT = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

function importsOf(file) {
  const found = [];
  for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) found.push(match[1] ?? match[2] ?? match[3]);
  return found;
}

function resolveSpecifier(from, specifier) {
  const base = relative(from, specifier);
  return [base, `${base}.ts`, `${base}.mjs`, `${base}.css`, join(base, "index.ts")].find((candidate) => existsSync(candidate));
}

/** Every repo file a scene file (transitively) imports, including itself. */
export function closureOf(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const specifier of importsOf(file)) {
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveSpecifier(file, specifier);
    if (resolved) closureOf(resolved, seen);
  }
  return seen;
}

/**
 * Scene file per chapter, in deck order, parsed from the example's main.ts.
 * Returns null when the file does not follow the documented shape, which makes
 * every step dirty instead of guessing.
 */
export function chapterScenes(name) {
  const root = sourceDir(name);
  if (!root) return null;
  return parseChapterScenes(join(root, "main.ts"));
}

/** Scene file per chapter, parsed from a `main.ts` that follows the template. */
export function parseChapterScenes(main) {
  if (!existsSync(main)) return null;
  const text = readFileSync(main, "utf8");
  const imported = new Map();
  for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const file = match[2].startsWith(".") ? resolveSpecifier(main, match[2]) : undefined;
    if (!file) continue;
    for (const part of match[1].split(",")) {
      const local = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (local) imported.set(local, file);
    }
  }
  const block = text.match(/chapters:\s*\[([\s\S]*?)\n\s*\]/);
  if (!block) return null;
  const scenes = [...block[1].matchAll(/\bscene:\s*([A-Za-z_$][\w$]*)/g)].map((match) => imported.get(match[1]));
  return scenes.length && scenes.every(Boolean) ? scenes : null;
}

/**
 * Which steps must be re-verified. Returns `{ all }` or the set of 0-based
 * global step indices covered by the changed scenes.
 */
export function invalidation({ name, chapters, previous, hashes, identity, sceneMap = chapterScenes(name) }) {
  if (!previous) return { all: true, reason: "no cached results" };
  if (previous.version !== CACHE_VERSION) return { all: true, reason: "cache format changed" };
  if (JSON.stringify(previous.identity) !== JSON.stringify(identity)) return { all: true, reason: "environment changed" };
  if (JSON.stringify(previous.chapters) !== JSON.stringify(chapters)) return { all: true, reason: "deck structure changed" };

  const changed = [...new Set([...Object.keys(hashes), ...Object.keys(previous.files ?? {})])]
    .filter((file) => hashes[file] !== previous.files?.[file]);
  if (!changed.length) return { all: false, dirty: new Set(), reason: "sources unchanged" };

  const scenes = sceneMap;
  if (!scenes || scenes.length !== new Set(chapters).size) return { all: true, reason: `${changed.length} source(s) changed; scene map unavailable` };

  const closures = new Map(scenes.map((file) => [file, closureOf(file)]));
  // Hashes are repo-relative; closures are absolute. Compare in one space.
  const inside = new Set([...closures.values()].flatMap((closure) => [...closure]));
  const outside = changed.filter((file) => !inside.has(resolve(file)));
  if (outside.length) return { all: true, reason: `shared source changed (${outside.slice(0, 3).join(", ")})` };

  const touched = new Set(changed.flatMap((file) => scenes.filter((scene) => closures.get(scene).has(resolve(file)))));
  if (!touched.size) return { all: true, reason: "changed sources belong to no scene" };

  const ids = [...new Set(chapters)];
  const dirty = new Set();
  chapters.forEach((id, index) => {
    if (touched.has(scenes[ids.indexOf(id)])) dirty.add(index);
  });
  // A flight that leaves a changed chapter is observed while the next
  // chapter's first step plays, so that landing step must be re-checked even
  // though its own scene is untouched. One step only, no cascade: the flight
  // out of an unchanged chapter depends on unchanged settled states.
  for (const index of [...dirty]) {
    if (index + 1 < chapters.length && chapters[index + 1] !== chapters[index]) dirty.add(index + 1);
  }
  return { all: false, dirty, reason: `${touched.size} scene(s) changed` };
}

export const cachePath = (name) => `shots/${name}/verify-cache.json`;

export function loadCache(name) {
  try { return JSON.parse(readFileSync(cachePath(name), "utf8")); } catch { return null; }
}

/** Reusable entries for one pass key (`720`, `motion`, …), never for dirty steps. */
export function reusable({ cache, key, dirty, total, hasPng }) {
  const entries = new Map();
  for (let index = 0; index < total; index++) {
    if (dirty.all || dirty.dirty.has(index)) continue;
    const entry = cache.steps?.[key]?.[index];
    if (!entry || !hasPng(index)) continue;
    entries.set(index, entry);
  }
  return entries;
}
