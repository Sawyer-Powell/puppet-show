import { resolve } from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * `npm run dev` serves every explainer under examples/ (recipes: EXAMPLE_ROOT=recipes).
 * `npm run build` (scripts/build.mjs) builds each example on its own, as one
 * self-contained HTML file with JS, CSS and fonts inlined:
 * dist/examples/<name>/index.html. Set EXAMPLE=<name> to build just one.
 */
const example = process.env.EXAMPLE ?? "puppet-show-explained";
const dir = process.env.EXAMPLE_DIR ?? `${process.env.EXAMPLE_ROOT ?? "examples"}/${example}`;
const root = dir.split("/")[0];

export default defineConfig({
  root,
  plugins: [
    // Dev server only: install the state inspector (window.__puppetShow) that the
    // VS Code debugger's collectors read. Production builds never include it.
    { name: "puppet-show-dev-inspector", apply: "serve", transform(src, id) {
      if (/\/(examples|recipes)\/[^/]+\/main\.ts$/.test(id)) {
        return `import "/@fs/${resolve(import.meta.dirname, "src/inspect/dev.ts")}";\n${src}`;
      }
    } },
    viteSingleFile({ removeViteModuleLoader: true }),
  ],
  build: {
    outDir: resolve(import.meta.dirname, "dist/examples"),
    emptyOutDir: false,
    target: "es2022",
    rollupOptions: {
      input: { [example]: resolve(import.meta.dirname, `${dir}/index.html`) },
    },
  },
});
