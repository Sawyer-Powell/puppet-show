// Dependency-free source scanners for the repository's CSS and TS style syntax.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function cssIssues(text, file) {
  const issues = [], stack = [];
  // Preserve offsets while removing comments. An allow comment applies to its line only.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const emit = (offset, rule, fix) => {
    const line = text.slice(0, offset).split('\n').length;
    if (/\/\*\s*lint-design:\s*allow\s+\S.+?\*\//.test(text.split('\n')[line - 1])) return;
    issues.push(`${file}:${line}: ${rule}; ${fix}`);
  };
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '{') { stack.push(clean.slice(start, i).trim()); start = i + 1; }
    else if (clean[i] === ';' || clean[i] === '}') {
      const chunk = clean.slice(start, i), colon = chunk.indexOf(':');
      if (colon >= 0) {
        const property = chunk.slice(0, colon).trim(), value = chunk.slice(colon + 1);
        const offset = start + chunk.search(/\S/);
        const token = property.startsWith('--ps-') && stack.some(s => /(^|,)\s*:root\b/.test(s) || /^@layer\s+[\w.-]*tokens\b/.test(s));
        if (!token && /#[\da-f]{3,8}\b|\brgba?\s*\(/i.test(value)) emit(offset, 'raw colour', 'use var(--ps-<semantic-role>)');
        if (/!important\b/i.test(value)) emit(offset, '!important', 'use cascade layers instead');
        if (/^(transition|animation)(-|$)/.test(property) && /(?:\d*\.)?\d+m?s\b/.test(value)) emit(offset, 'raw motion duration', 'use var(--ps-duration-*)');
        if (!token && property === 'box-shadow' && !tokenComposed(value)) emit(offset, 'box-shadow literal', 'use a shadow token var(--ps-*), or compose one only from var(--ps-*), 0, inset and transparent');
      }
      if (clean[i] === '}') stack.pop();
      start = i + 1;
    }
  }
  return issues;
}

export function tsIssues(text, file) {
  const issues = [];
  const emit = (offset, rule, fix) => {
    const line = text.slice(0, offset).split('\n').length;
    if (/\/\*\s*lint-design:\s*allow\s+\S.+?\*\//.test(text.split('\n')[line - 1])) return;
    issues.push(`${file}:${line}: ${rule}; ${fix}`);
  };
  const clean = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.startsWith('/') ? m.replace(/[^\n]/g, ' ') : m);
  const tokens = [...clean.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s]/g)].map(m => ({ text: m[0], offset: m.index }));
  const unquote = s => /^["'`]/.test(s ?? '') ? s.slice(1, -1) : s;
  const colourProperty = s => /^(?:color|background(?:color)?|border(?:top|bottom|left|right)?(?:color)?|outline(?:color)?|fill|stroke|boxshadow|textshadow|caretcolor|accentcolor|style)$/.test(unquote(s)?.replaceAll('-', '').toLowerCase());
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], prev = n => tokens[i - n]?.text;
    if (!/(?:^|\/)(?:palette|tokens)\.ts$/.test(file) && /^["'`]/.test(t.text) && /#[\da-f]{3,8}\b/i.test(t.text)) {
      const property = prev(1) === ':' && colourProperty(prev(2));
      const cssCall = prev(1) === ',' && prev(3) === '(' && prev(4) === 'css' && colourProperty(prev(2));
      const curriedCss = prev(1) === '(' && prev(2) === ')' && prev(4) === '(' && prev(5) === 'css' && colourProperty(prev(3));
      if (property || cssCall || curriedCss) emit(t.offset, 'inline style colour literal', 'use palette.<role>');
    }
    if (!['el', 'Node'].includes(t.text) || tokens[i + 1]?.text !== '(' || !/^button(?:[.#]|$)/.test(unquote(tokens[i + 2]?.text)) || tokens[i + 4]?.text !== '{') continue;
    let depth = 0;
    for (let j = i + 4; j < tokens.length; j++) {
      const s = tokens[j].text;
      if (s === '{') depth++;
      if (s === '}' && --depth === 0) break;
      if (depth === 1 && unquote(s) === 'class' && tokens[j + 1]?.text === ':') {
        for (let k = j + 2; k < tokens.length && ![',', '}'].includes(tokens[k].text); k++) {
          if (/^["'`]/.test(tokens[k].text) && /\bps-(hot|live|dim|bad|ok)\b/.test(tokens[k].text)) { emit(tokens[j].offset, 'state class on button', 'use aria-checked/data-state, not content state classes'); break; }
        }
      }
    }
  }
  return issues;
}

// Keep this adapter small: accepts reordered declarations, aliases and token layers.
/** A shadow built only from tokens (plus 0/inset/transparent) carries no raw geometry or colour. */
export function tokenComposed(value) {
  let v = value, prev;
  do { prev = v; v = v.replace(/var\(--ps-[\w-]+\)/g, ' '); } while (v !== prev);
  return /^[\s,]*((none|inherit|initial|unset|revert(-layer)?|inset|transparent|0)[\s,]*)*$/.test(v);
}
/**
 * Token sync: every declaration in the canonical src/ui/tokens.ts must appear
 * verbatim as --ps-<name> in puppet-show.css. palette.ts derives from tokens.ts, so it
 * cannot drift on its own. Kept in one fn so a future token format is easy to adapt.
 */
export function tokenMismatches(css, source, file = 'src/ui/tokens.ts') {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  source = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const norm = (v) => v.trim().replace(/\s+/g, ' ').toLowerCase();
  // First declaration is the base value; later ones (e.g. reduced-motion media overrides) are variants.
  const vars = new Map();
  for (const m of css.matchAll(/(--ps-[\w-]+)\s*:\s*([^;{}]+)\s*[;}]/g)) if (!vars.has(m[1])) vars.set(m[1], norm(m[2]));
  const entries = [...source.matchAll(/(?:^|[\s{,])"?([a-z][\w-]*)"?\s*:\s*(["'])(.*?)\2/gi)];
  if (!entries.length) return [`${file}: no token declarations parsed; adapt tokenMismatches() to the new token format (do not silently skip token sync)`];
  return entries.flatMap(([, name, , value]) => {
    const actual = vars.get(`--ps-${name}`);
    if (actual === undefined) return [`${file}: token ${name} has no --ps-${name} in src/ui/puppet-show.css; declare it in the tokens layer`];
    return actual === norm(value) ? [] : [`${file}: token ${name}=${value}, src/ui/puppet-show.css --ps-${name}=${actual}; synchronize puppet-show.css with tokens.ts`];
  });
}
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }
export function lintDesign() {
  const css = ['src/ui/puppet-show.css', ...['examples', 'recipes'].flatMap(r => files(r).filter(f => new RegExp(`^${r}/[^/]+/style\\.css$`).test(f)))];
  return [...css.flatMap(f => cssIssues(readFileSync(f, 'utf8'), f)), ...files('src').filter(f => f.endsWith('.ts')).flatMap(f => tsIssues(readFileSync(f, 'utf8'), f)), ...tokenMismatches(readFileSync('src/ui/puppet-show.css', 'utf8'), readFileSync('src/ui/tokens.ts', 'utf8'))];
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const issues = lintDesign();
  issues.forEach(i => console.error(i));
  console.log(`${issues.length ? 'FAIL' : 'PASS'} design lint (${issues.length} issues)`);
  process.exitCode = issues.length ? 1 : 0;
}
