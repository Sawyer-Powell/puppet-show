import {test} from 'node:test';
import assert from 'node:assert/strict';
import {History} from '../src/model.ts';
import {collectAll, type Session} from '../src/collectors/index.ts';
import {StopTracker} from '../src/tracker.ts';
import {parseResult} from '../src/collectors/puppet-show.ts';
import {evaluateCollector} from '../src/collectors/evaluate.ts';
const stop = {reason: 'step', threadId: 1, frames: [], data: {}};
test('evaluate collector preserves strings, objects and undefined across adapter quoting', async () => {
  const collector = evaluateCollector('custom', 'example');
  for (const value of ['text', {password: 'secret'}, null, 4, false, undefined]) {
    for (const quote of [false, true]) {
      const serialized = JSON.stringify({value});
      const result = await collector.collect({frame: {id: 1, name: 'x', line: 1, column: 1}, readFile: async () => '', session: {customRequest: async () => ({result: quote ? JSON.stringify(serialized) : serialized})}});
      assert.deepEqual(result, value === undefined ? {ok: false, missing: true} : {ok: true, value});
    }
  }
});
test('head and cursor are independent; compact replay has no full stops', () => {
  const h = new History({id: 'a', name: 'demo'});
  h.append(stop); h.append(stop);
  assert.equal(h.cursor, 1); assert.equal(h.head, 1);
  h.select(0); h.transition('running'); h.append(stop);
  assert.equal(h.cursor, 0); assert.equal(h.head, 2);
  h.live(); h.transition('running'); h.append(stop); assert.equal(h.cursor, 3);
  assert.equal(h.select(99)?.stop.seq, 3); assert.equal(h.select(NaN), undefined);
  assert.equal(h.replay().filter(m => m.type === 'stop').length, 0);
  h.transition('exited'); assert.equal(h.head, null);
});
test('collectors evaluate top frame and read ±12 lines', async () => {
  const session: Session = {async customRequest(command, args: any) {
    assert.equal(command, 'evaluate'); assert.equal(args.frameId, 7);
    assert.equal(args.expression, 'JSON.stringify(globalThis.__puppetShow?.snapshot())');
    assert.equal(args.context, 'clipboard');
    return {result: JSON.stringify(JSON.stringify({version: 1, nodes: []}))};
  }};
  const data = await collectAll({session, frame: {id: 7, name: 'fn', source: {path: '/file'}, line: 20, column: 1}, readFile: async () => Array.from({length: 50}, (_, i) => `${i + 1}`).join('\n')});
  assert.deepEqual(data["puppet-show"], {ok: true, value: {version: 1, nodes: []}});
  assert.deepEqual(data.source, {ok: true, value: {path: '/file', startLine: 8, line: 20, lines: Array.from({length: 25}, (_, i) => `${i + 8}`)}});
});
test('raw and js-debug quoted snapshots preserve escaped content and long strings', () => {
  const value = {caption: 'a'.repeat(4000) + "don't `stop`\\n\\\\"};
  const json = JSON.stringify(value);
  assert.deepEqual(parseResult(json), value);
  assert.deepEqual(parseResult(JSON.stringify(json)), value);
  const quoted = "'" + json.replace(/[\\\\']/g, c => '\\' + c) + "'";
  assert.deepEqual(parseResult(quoted), value);
});
test('missing, malformed, throwing and stalled collectors remain isolated', async () => {
  const ctx = {session: {customRequest: async () => ({result: 'undefined'})}, readFile: async () => ''};
  assert.deepEqual(await collectAll(ctx), {"puppet-show": {ok: false, missing: true}, source: {ok: false, missing: true}});
  const data = await collectAll(ctx, [
    {id: 'throw', timeoutMs: 20, collect: async () => {throw new Error('bad');}},
    {id: 'slow', timeoutMs: 5, collect: () => new Promise(() => {})},
  ]);
  assert.deepEqual(data.throw, {ok: false, error: 'bad'});
  assert.match((data.slow as {error: string}).error, /Timed out/);
  const malformed = await collectAll({...ctx, frame: {id: 1, name: 'x', line: 1, column: 1}, session: {customRequest: async () => ({result: 'not JSON'})}});
  assert.equal(malformed["puppet-show"]?.ok, false);
});
test('tracker threads/stack and per-session sequence, invalidates in-flight stop', async () => {
  const h = new History({id: '1', name: 'fake'});
  const calls: string[] = [];
  const tracker = new StopTracker(h, {customRequest: async command => {
    calls.push(command);
    if (command === 'threads') return {threads: [{id: 42}]};
    if (command === 'stackTrace') return {stackFrames: [{id: 3, name: 'top', line: 1, column: 2}]};
    return {result: '{"version":1}'};
  }}, async () => '', () => {});
  await tracker.stopped({reason: 'breakpoint'});
  assert.deepEqual(calls, ['threads', 'stackTrace', 'evaluate']);
  assert.equal(h.stops[0]?.threadId, 42); assert.equal(h.stops[0]?.seq, 0);
  const pending = tracker.stopped({threadId: 42}); tracker.transition('running'); await pending;
  assert.equal(h.stops.length, 1); assert.equal(h.state, 'running');
});
