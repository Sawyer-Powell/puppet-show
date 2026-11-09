// Shared paths for repository decks and standalone projects. No cwd assumptions.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const viteRoot = dirname(require.resolve("vite/package.json"));

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function projectRoot() {
  const root = process.env.PUPPET_SHOW_PROJECT;
  if (root && !isAbsolute(root)) throw new Error("PUPPET_SHOW_PROJECT must be an absolute path");
  return root ? resolve(root) : null;
}

export function projectContext(name) {
  const root = projectRoot();
  if (root) return {
    sourceDir: root,
    distFile: join(root, "dist/index.html"),
    artifactDir: join(root, ".puppet-show"),
    cacheDir: join(root, ".puppet-show/cache"),
  };
  const source = ["examples", "recipes"].map((dir) => join(packageRoot, dir, name))
    .find((dir) => existsSync(join(dir, "index.html"))) ?? null;
  return {
    sourceDir: source,
    distFile: join(packageRoot, "dist/examples", name, "index.html"),
    artifactDir: join(packageRoot, "shots", name),
    cacheDir: join(packageRoot, "node_modules/.cache/puppet-show", name),
  };
}

/** Generate a scoped incremental config using this installation's compiler. */
export function typecheckConfig(root, cacheDir = join(root, ".puppet-show/cache")) {
  mkdirSync(cacheDir, { recursive: true });
  const config = join(cacheDir, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    include: [join(packageRoot, "src"), join(root, "**/*.ts")],
    exclude: [join(root, "node_modules"), join(root, "dist"), join(root, ".puppet-show")],
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      lib: ["ES2023", "DOM", "DOM.Iterable"], strict: true, noEmit: true,
      allowImportingTsExtensions: true, erasableSyntaxOnly: true, verbatimModuleSyntax: true,
      noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true,
      incremental: true, tsBuildInfoFile: join(cacheDir, "tsconfig.tsbuildinfo"),
      types: [join(viteRoot, "client")],
      paths: { "puppet-show": [join(packageRoot, "src/index.ts")] },
    },
  }, null, 2));
  return config;
}
export const typescriptBin = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
export function typecheckProject(root) {
  execFileSync(process.execPath, [typescriptBin, "--noEmit", "-p", typecheckConfig(resolve(root))], {
    cwd: packageRoot, stdio: "pipe", encoding: "utf8", timeout: 60_000,
  });
}
