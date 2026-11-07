import type {Collector} from './index.ts';
export const stageCollector: Collector = {
  id: 'puppet-show', timeoutMs: 1500,
  async collect({session, frame}) {
    if (!frame) return {ok: false, missing: true};
    const response = await session.customRequest('evaluate', {
      // js-debug's clipboard context returns complete, unquoted strings; watch
      // truncates to 1000 characters, which corrupts real snapshots.
      expression: 'JSON.stringify(globalThis.__puppetShow?.snapshot())', frameId: frame.id, context: 'clipboard',
    });
    if (response.result === 'undefined' || response.result === undefined) return {ok: false, missing: true};
    return {ok: true, value: parseResult(response.result)};
  },
};

/** Decode js-debug's JS string preview without executing debuggee-supplied text. */
export function parseResult(result: string): unknown {
  let text = result;
  if ((text[0] === "'" || text[0] === '`') && text.at(-1) === text[0]) {
    text = text.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, escape: string) => {
      if (escape.startsWith('u') || escape.startsWith('x')) return String.fromCharCode(parseInt(escape.slice(1), 16));
      const escapes: Record<string, string> = {n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0'};
      return escapes[escape] ?? escape;
    });
  }
  const value: unknown = JSON.parse(text);
  return typeof value === 'string' ? JSON.parse(value) : value;
}
