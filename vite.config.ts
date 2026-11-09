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
const project = process.env.PUPPET_SHOW_PROJECT;
const root = project ?? resolve(import.meta.dirname, process.env.EXAMPLE_ROOT ?? (dir.includes("/recipes/") || dir.startsWith("recipes/") ? "recipes" : "examples"));

export default defineConfig({
  root,
  resolve: project ? { alias: [
    { find: /^puppet-show$/, replacement: resolve(import.meta.dirname, "src/index.ts") },
    { find: "puppet-show/style.css", replacement: resolve(import.meta.dirname, "src/ui/puppet-show.css") },
  ] } : undefined,
  server: { fs: { allow: [import.meta.dirname, ...(project ? [project] : [])] } },
  plugins: [
    // Dev server only: install the state inspector (window.__puppetShow) that the
    // VS Code debugger's collectors read. Production builds never include it.
    { name: "puppet-show-dev-inspector", apply: "serve", transform(src, id) {
      if (/\/(examples|recipes)\/[^/]+\/main\.ts$/.test(id) || (project && id === resolve(project, "main.ts"))) {
        return `import "/@fs/${resolve(import.meta.dirname, "src/inspect/dev.ts")}";\n${src}`;
      }
    } },
    viteSingleFile({ removeViteModuleLoader: true }),
  ],
  build: {
    outDir: project ? resolve(project, "dist") : resolve(import.meta.dirname, "dist/examples"),
    emptyOutDir: false,
    target: "es2022",
    rollupOptions: {
      input: { [example]: project ? resolve(project, "index.html") : resolve(import.meta.dirname, `${dir}/index.html`) },
    },
  },
});
