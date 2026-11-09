import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const packageRoot = path.resolve(import.meta.dirname, '..');
const designRoot = path.join(packageRoot, 'skills/explainer-design');
const recipesRoot = path.join(packageRoot, 'recipes/gallery/scenes');

function text(file) {
  return readFileSync(file, 'utf8');
}

function portableRecipe(file) {
  return text(file).replaceAll('../../../src/index.ts', 'puppet-show');
}

function safeFile(root, name, extension) {
  // Accept a single packaged filename, never a path or encoded path.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || !name.endsWith(extension)) {
    throw new Error(`Invalid documentation filename: ${name}`);
  }
  const file = path.join(root, name);
  const canonicalRoot = realpathSync(root);
  const canonicalFile = realpathSync(file);
  if (path.dirname(canonicalFile) !== canonicalRoot) {
    throw new Error('Documentation path escapes the package');
  }
  return canonicalFile;
}

/** Return installed documentation as printable text; never reads the caller's cwd. */
export function printDocs(topic = 'authoring') {
  if (topic === 'authoring') return text(path.join(packageRoot, 'docs/authoring.md'));
  if (topic === 'api') {
    return 'Portable projects import from "puppet-show". Use `npx github:Sawyer-Powell/puppet-show docs authoring` for the portable CLI workflow; repository npm scripts below are contributor tooling.\n\n'
      + text(path.join(packageRoot, 'docs/API.md'));
  }
  if (topic === 'design') {
    return text(path.join(designRoot, 'SKILL.md')) + '\n\n## Installed design references\n\n'
      + readdirSync(path.join(designRoot, 'references')).filter(name => name.endsWith('.md')).sort()
        .map(name => `- npx github:Sawyer-Powell/puppet-show docs design/${name}`).join('\n') + '\n';
  }
  if (topic.startsWith('design/')) {
    const name = topic.slice('design/'.length);
    return text(safeFile(path.join(designRoot, 'references'), name.endsWith('.md') ? name : `${name}.md`, '.md'));
  }
  if (topic === 'recipes') {
    return '# Packaged recipes\n\n' + readdirSync(recipesRoot).filter(name => name.endsWith('.ts')).sort()
      .map(name => `- npx github:Sawyer-Powell/puppet-show docs recipes/${name}`).join('\n') + '\n';
  }
  if (topic.startsWith('recipes/')) {
    return portableRecipe(safeFile(recipesRoot, topic.slice('recipes/'.length), '.ts'));
  }
  if (topic === 'all') {
    const refs = readdirSync(path.join(designRoot, 'references')).filter(name => name.endsWith('.md')).sort();
    const recipes = readdirSync(recipesRoot).filter(name => name.endsWith('.ts')).sort();
    return ['authoring', 'api', 'design', ...refs.map(name => `design/${name}`), 'recipes', ...recipes.map(name => `recipes/${name}`)]
      .map(name => `<!-- ${name} -->\n${printDocs(name)}`).join('\n\n');
  }
  throw new Error(`Unknown docs topic: ${topic}. Choose authoring, api, design, recipes, all, design/<ref>, or recipes/<file>.`);
}

/** Scaffold a new or empty directory without overwriting any existing content. */
export async function initProject(dir, { title = 'My explainer' } = {}) {
  if (typeof dir !== 'string' || !dir.trim()) throw new Error('A project directory is required');
  if (typeof title !== 'string' || !title.trim()) throw new Error('Title must be a nonempty string');
  const target = path.resolve(dir);
  let existing;
  try { existing = await lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isDirectory() || (await readdir(target)).length)) {
    throw new Error(`Refusing to overwrite nonempty directory or non-directory: ${target}`);
  }
  const htmlTitle = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const files = {
    'index.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${htmlTitle}</title>\n</head>\n<body>\n  <script type="module" src="/main.ts"></script>\n</body>\n</html>\n`,
    'main.ts': `import { deck } from "puppet-show";
import "puppet-show/style.css";
import "./style.css";
import { value } from "./scenes/01-value.ts";
import { delivery } from "./scenes/02-delivery.ts";

deck(document.body, {
  captionMotion: "none",
  chapters: [
    { id: "value", title: "A changing value", scene: value },
    { id: "delivery", title: "Deliver a value", scene: delivery },
  ],
});
`,
    'style.css': `.x-stack { display: grid; gap: var(--ps-space-16); }
.x-message { color: var(--ps-text-muted); }
`,
    'scenes/01-value.ts': `import { beat, el, narrate, panel, readout, signal, type Task, type View } from "puppet-show";

// Scene-owned motion resets on replay. Only durable learner input belongs outside.
export function* value(view: View): Task {
  const count = signal(0);
  view.add(panel("A signal", {},
    readout("value", () => Math.round(count())),
    el("p.x-message", "A signal is a value the page follows."),
  ));
  yield* narrate("The displayed value starts at 0.");
  yield* beat("start");
  // A duration returns a tween task; yield* runs it to completion.
  yield* narrate("A tween changes the signal over time. The display follows it.", count(3, 0.7));
}
`,
    'scenes/02-delivery.ts': `import { beat, box, el, fly, narrate, panel, signal, type Task, type View } from "puppet-show";

export function* delivery(view: View): Task {
  const source = box("source", "3");
  const received = signal(false);
  const destination = box("destination", () => received() ? "received 3" : "waiting");
  // Both endpoints are mounted before the flight; text keeps its layout slot.
  view.add(panel("Delivery", {}, el("div.x-stack", source, destination)));
  yield* narrate("The source holds 3. The destination has not received it yet.");
  yield* beat("ready");
  yield* narrate("The token shows a copy traveling from source to destination.",
    fly(source, destination, "3", { arc: 0 }),
  );
  received(true);
  destination.flag("ps-ok")(true);
}
`,
    'README.md': `# ${title.replaceAll('\n', ' ')}\n\nA synthetic, four-step starter: a signal changes, then its value is delivered.\n\nBuild with \`npx github:Sawyer-Powell/puppet-show build\`; use\n\`npx github:Sawyer-Powell/puppet-show check\` for the default fast check. Read\n\`npx github:Sawyer-Powell/puppet-show docs authoring\` and\n\`npx github:Sawyer-Powell/puppet-show docs design\` before expanding it.\n`, 
    'AGENTS.md': `# Explainer authoring\n\nRead \`npx github:Sawyer-Powell/puppet-show docs authoring\`,\n\`npx github:Sawyer-Powell/puppet-show docs api\`, and\n\`npx github:Sawyer-Powell/puppet-show docs design\` before editing.\nUse only synthetic data.\n\`npx github:Sawyer-Powell/puppet-show check\` is the default fast gate.\nInspect shots and sheets; slow \`check --deep\` is rarely needed, only to\ninvestigate user reports not explained by check, shot, or sheets.\n`,
    '.gitignore': 'dist/\n.puppet-show/\n',
  };
  await mkdir(target, { recursive: true });
  await mkdir(path.join(target, 'scenes'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(target, name), content, { flag: 'wx' });
  }
  return { dir: target, files: Object.keys(files) };
}
