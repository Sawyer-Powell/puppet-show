import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Intentionally low-level ownership/scheduling plumbing, not author-facing API.
export const undocumented = new Map([
  ['getOwner', 'Reactive owner plumbing for adapters'],
  ['runWithOwner', 'Reactive owner plumbing for adapters'],
]);
export function apiDocIssues(index, docs) {
  const clean = index.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
  const issues = [];
  for (const statement of clean.matchAll(/\bexport\s+(type\s+)?\{([^}]+)\}/g)) {
    if (statement[1]) continue;
    for (const item of statement[2].split(',')) {
      if (/^\s*type\s/.test(item)) continue;
      const name = item.trim().split(/\s+as\s+/).at(-1);
      if (!name || undocumented.has(name)) continue;
      if (!new RegExp(`(?<![\\w])${name}(?![\\w])`).test(docs)) {
        const line = clean.slice(0, statement.index + statement[0].indexOf(item)).split('\n').length;
        issues.push(`src/index.ts:${line}: undocumented value export ${name}; add its signature and usage to docs/API.md (or justify a low-level exception in scripts/check-api-docs.mjs)`);
      }
    }
  }
  return issues;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const issues = apiDocIssues(readFileSync('src/index.ts', 'utf8'), readFileSync('docs/API.md', 'utf8'));
  issues.forEach(i => console.error(i));
  console.log(`${issues.length ? 'FAIL' : 'PASS'} API export docs (${issues.length} issues)`);
  process.exitCode = issues.length ? 1 : 0;
}
