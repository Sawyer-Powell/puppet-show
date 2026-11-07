import type {Collector} from './index.ts';
import {parseResult} from './puppet-show.ts';

/** A wrapper disambiguates serialized string results from adapter quoting. */
export function evaluateCollector(id: string, expr: string): Collector {
  return {id, timeoutMs: 1500, async collect({session, frame}) {
    if (!frame) return {ok: false, missing: true};
    const response = await session.customRequest('evaluate', {
      expression: `JSON.stringify({value: (${expr})})`, frameId: frame.id, context: 'clipboard',
    });
    if (response.result === 'undefined') return {ok: false, missing: true};
    const wrapped = parseResult(response.result) as {value?: unknown};
    return Object.hasOwn(wrapped, 'value') ? {ok: true, value: wrapped.value} : {ok: false, missing: true};
  }};
}
