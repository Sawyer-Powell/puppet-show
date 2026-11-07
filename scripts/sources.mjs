// Buildable decks live in examples/ (explainers) or recipes/ (the component
// gallery). Names are unique across both; output is always dist/examples/<name>.
import { existsSync, readdirSync } from "node:fs";

export const ROOTS = ["examples", "recipes"];

/** Source directory for a deck name, e.g. "recipes/gallery", or null. */
export function sourceDir(name) {
  const root = ROOTS.find((r) => existsSync(`${r}/${name}/index.html`));
  return root ? `${root}/${name}` : null;
}

/** Every buildable deck name. */
export function allNames() {
  return ROOTS.flatMap((r) => (existsSync(r) ? readdirSync(r).filter((n) => existsSync(`${r}/${n}/index.html`)) : []));
}
