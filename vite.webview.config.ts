import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    outDir: "dist/webview",
    emptyOutDir: true,
    assetsInlineLimit: Infinity,
    lib: {
      entry: fileURLToPath(new URL("./src/inspect/views/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "debugger.js",
      cssFileName: "debugger",
    },
  },
});
