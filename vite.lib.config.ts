import { resolve } from "node:path";
import { defineConfig } from "vite";

/** `npm run build:lib`: an ES module plus one CSS file (fonts inlined) in dist/lib. */
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, "dist/lib"),
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 100_000,
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "puppet-show",
      cssFileName: "puppet-show",
    },
  },
});
