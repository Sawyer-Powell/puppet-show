// Build every deck in examples/ and recipes/ (or the ones named) into
// dist/examples/<name>/index.html, one self-contained file each.
//
//   node scripts/build.mjs [name ...]
import { execFileSync } from "node:child_process";
import { allNames, sourceDir } from "./sources.mjs";
import { join } from "node:path";
import { packageRoot, projectContext, viteRoot } from "./project.mjs";

const names = process.argv.slice(2).length ? process.argv.slice(2) : allNames();

for (const name of names) {
  const dir = sourceDir(name);
  if (!dir) throw new Error(`no examples/${name}/index.html or recipes/${name}/index.html`);
  execFileSync(process.execPath, [join(viteRoot, "bin/vite.js"), "build", "--config", join(packageRoot, "vite.config.ts"), "--logLevel", "warn"], {
    cwd: packageRoot, stdio: "inherit", env: { ...process.env, EXAMPLE: name, EXAMPLE_DIR: dir },
  });
  console.log(`built ${projectContext(name).distFile}`);
}
