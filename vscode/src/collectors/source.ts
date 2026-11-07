import type {Collector} from './index.ts';
export const source: Collector = {
  id: 'source', timeoutMs: 1500,
  async collect({frame, readFile}) {
    const path = frame?.source?.path;
    if (!path || !frame || frame.line < 1) return {ok: false, missing: true};
    const lines = (await readFile(path)).split(/\r?\n/);
    const startLine = Math.max(1, frame.line - 12);
    return {ok: true, value: {path, startLine, lines: lines.slice(startLine - 1, frame.line + 12), line: frame.line}};
  },
};
