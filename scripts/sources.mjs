// Buildable decks live in examples/ (explainers) or recipes/ (the component
// gallery). Names are unique across both; output is always dist/examples/<name>.
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { packageRoot, projectContext, projectRoot } from "./project.mjs";

export const ROOTS = ["examples", "recipes"];

/** Source directory for a deck name, e.g. "recipes/gallery", or null. */
export function sourceDir(name) {
  const dir = projectContext(name).sourceDir;
  return dir && existsSync(join(dir, "index.html")) ? dir : null;
}

/** Every buildable deck name. */
export function allNames() {
  const project = projectRoot();
  if (project) return existsSync(join(project, "index.html")) ? [basename(project)] : [];
  return ROOTS.flatMap((r) => {
    const root = join(packageRoot, r);
    return existsSync(root) ? readdirSync(root).filter((n) => existsSync(join(root, n, "index.html"))) : [];
  });
}
