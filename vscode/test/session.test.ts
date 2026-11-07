import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  AnchorResolutionError, SessionValidationError, createTraceWriter, diffBreakpoints,
  parsePattern, parseSession, redactValue, renderRedacted, resolveAnchor, validateSession,
  sessionMaxStops, sessionViews,
} from '../src/session.ts';
import type {ResolvedBreakpoint} from '../src/session.ts';

const minimal = () => ({version: 1, name: 'Example', launch: 'Launch example'});

test('validates versioned session, inline launches, and all optional fields', () => {
  const input = {
    ...minimal(), launch: {type: 'node', request: 'launch', args: ['example.ts']},
    breakpoints: [{id: 'first', file: 'src/main.ts', match: '/start\\(/i', line: 8,
      condition: 'ready', kind: 'probe', label: 'Start', note: 'Inspect this'}],
    collectors: ['puppet-show', 'source', {id: 'value', kind: 'evaluate', expr: 'state.value'}],
    redact: ['password', '/token$/i'], notes: ['synthetic data'],
  };
  assert.deepEqual(validateSession(input), input);
  assert.notEqual(validateSession(input).launch, input.launch);
  assert.deepEqual(parseSession(JSON.stringify(minimal())), minimal());
  assert.equal(validateSession({...minimal(), notes: ''}).notes, '');
});

test('rejects malformed, unsupported and non-JSON sessions', () => {
  for (const value of [null, [], {}, {...minimal(), version: 3}, {...minimal(), name: ''},
    {...minimal(), launch: []}, {...minimal(), launch: {}},
    {...minimal(), launch: {type: 'node', request: 'invalid'}}, {...minimal(), unexpected: true},
    {...minimal(), breakpoints: [{id: 'b', file: 'x'}]},
    {...minimal(), breakpoints: [{id: 'b', file: 'x', line: 0}]},
    {...minimal(), breakpoints: [{id: 'b', file: 'x', line: 1.2}]},
    {...minimal(), breakpoints: [{id: 'b', file: 'x', match: '/[/'}]},
    {...minimal(), breakpoints: [{id: 'b', file: 'x', line: 1, kind: 'log'}]},
    {...minimal(), breakpoints: [{id: 'b', file: 'x', line: 1}, {id: 'b', file: 'y', line: 2}]},
    {...minimal(), collectors: ['unknown']}, {...minimal(), collectors: ['puppet-show', 'puppet-show']},
    {...minimal(), collectors: [{id: 'e', kind: 'evaluate', expr: ''}]},
    {...minimal(), collectors: [{id: 'source', kind: 'evaluate', expr: '1'}, 'source']},
    {...minimal(), redact: ['/x/zz']}, {...minimal(), notes: [7]},
    {...minimal(), launch: {bad: undefined}}, {...minimal(), launch: {bad: NaN}},
    {...minimal(), launch: {date: new Date()}},
  ]) assert.throws(() => validateSession(value), SessionValidationError);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => validateSession({...minimal(), launch: cycle}), /cyclic/);
  assert.throws(() => parseSession('{'), /invalid JSON/);
});

test('v2 accepts state-first declarations and both launch forms without injecting defaults', () => {
  const views = [
    {id: 'time', kind: 'series', label: 'Clock vs logical', breakpoint: 'frame',
      lines: [{select: 'clock', label: 'now'}, {select: 'logical'}]},
    {id: 'x', kind: 'series', select: 'x'},
    {id: 'threads', kind: 'puppet-show:threads'},
    {id: 'nodes', kind: 'table', select: 'puppet-show.value.nodes', key: 'id', columns: ['tag', 'motion.x']},
    {id: 'deck', kind: 'value', select: ['puppet-show.value.deck.chapter', 'puppet-show.value.deck.step']},
    {id: 'tree', kind: 'tree', select: 'puppet-show.value.threads', key: 'id', children: 'children'},
    {id: 'events', kind: 'events', breakpoint: 'join', template: 'joined {logical}'},
  ];
  const input = {...minimal(), version: 2, launch: {name: 'Launch example', url: 'http://localhost:5173/?autoplay=1.2'}, views, maxStops: 123};
  const config = parseSession(JSON.stringify(input));
  assert.deepEqual(config, input);
  assert.deepEqual(sessionViews(config), views);
  assert.notEqual(sessionViews(config), config.views);
  assert.equal(sessionMaxStops(config), 123);
  assert.deepEqual(validateSession({...minimal(), version: 2}), {...minimal(), version: 2});
  assert.equal(validateSession({...minimal(), version: 2, launch: {type: 'node', request: 'attach'}}).version, 2);
  assert.deepEqual(sessionViews(validateSession({...minimal(), version: 2, views: []})), []);
});

test('v1 defaults are state-first views with bounded retention, detached per call', () => {
  const config = validateSession(minimal());
  assert.equal(sessionMaxStops(config), 10000);
  assert.equal(config.maxStops, undefined);
  const views = sessionViews(config);
  assert.deepEqual(views.map(view => view.kind), ['puppet-show:threads', 'table', 'value']);
  assert.equal(views[1].select, 'puppet-show.value.nodes');
  assert.deepEqual(views[2].select, ['puppet-show.value.deck.chapter', 'puppet-show.value.deck.step', 'puppet-show.value.deck.time']);
  views.length = 0;
  assert.equal(sessionViews(config).length, 3);
  for (const maxStops of [1, 1000000]) assert.equal(sessionMaxStops(validateSession({...minimal(), version: 2, maxStops})), maxStops);
});

test('v2 rejects malformed views, retention limits and launch overrides strictly', () => {
  const base = {...minimal(), version: 2};
  for (const maxStops of [0, -1, 1.5, 1000001, Number.MAX_SAFE_INTEGER + 1, '100', null, NaN]) {
    assert.throws(() => validateSession({...base, maxStops}), /session.maxStops/);
  }
  for (const views of [null, {}, [null], [{id: 'x', kind: 'unknown'}],
    [{id: '', kind: 'puppet-show:threads'}], [{id: 'x', kind: 'value'}],
    [{id: 'x', kind: 'series'}], [{id: 'x', kind: 'table', select: ''}],
    [{id: 'x', kind: 'value', select: []}], [{id: 'x', kind: 'value', select: ['x', 1]}],
    [{id: 'x', kind: 'value', select: 'puppet-show..nodes'}],
    [{id: 'x', kind: 'series', lines: []}],
    [{id: 'x', kind: 'series', lines: [{select: ['x']}]}],
    [{id: 'x', kind: 'series', lines: [{select: 'x', extra: true}]}],
    [{id: 'x', kind: 'series', select: 'x', lines: [{select: 'x'}]}],
    [{id: 'x', kind: 'value', select: 'x', lines: [{select: 'x'}]}],
    [{id: 'x', kind: 'table', select: 'x', columns: [1]}],
    [{id: 'x', kind: 'tree', select: 'x', children: 1}],
    [{id: 'x', kind: 'events', breakpoint: 2}],
    [{id: 'x', kind: 'events', template: false}],
    [{id: 'x', kind: 'puppet-show:threads', unknown: true}],
    [{id: 'x', kind: 'puppet-show:threads'}, {id: 'x', kind: 'events'}],
  ]) assert.throws(() => validateSession({...base, views}), SessionValidationError);
  for (const launch of [{name: 'Launch'}, {url: 'http://localhost'}, {name: '', url: 'x'},
    {name: 'Launch', url: 1}, {name: 'Launch', url: 'x', typo: true},
    {name: 'Launch', url: 'x', type: 'node'}, {name: 'Launch', request: 'launch'},
  ]) assert.throws(() => validateSession({...base, launch}), SessionValidationError);
  assert.throws(() => validateSession({...minimal(), views: []}), /unknown field/);
  assert.throws(() => validateSession({...minimal(), maxStops: 10}), /unknown field/);
  assert.throws(() => validateSession({...minimal(), launch: {name: 'Launch', url: 'x'}}), SessionValidationError);
});

test('resolves literal and regex anchors with one-based CRLF lines', () => {
  const bp = {id: 'b', file: 'x', match: 'start()'};
  assert.equal(resolveAnchor(bp, 'header\r\n  start();\r\nend').line, 2);
  assert.equal(resolveAnchor({...bp, match: '/START\\(\\)/i', line: 1}, 'header\nstart()').line, 2);
  assert.equal(resolveAnchor({...bp, match: '/^start/g'}, 'other\nstart()').line, 2);
  assert.equal(resolveAnchor({...bp, match: '/^start/y'}, 'other\nstart()').line, 2);
  assert.equal(resolveAnchor({...bp, match: 'absent', line: 2}, 'a\nb').line, 2);
  assert.equal(resolveAnchor({id: 'line', file: 'x', line: 1}, 'a').line, 1);
});

test('missing and ambiguous anchors fail; ambiguity never uses fallback', () => {
  const bp = {id: 'b', file: 'x', match: 'x'};
  assert.throws(() => resolveAnchor(bp, 'a'), (error: unknown) =>
    error instanceof AnchorResolutionError && error.reason === 'missing' && error.breakpointId === 'b');
  assert.throws(() => resolveAnchor({...bp, line: 1}, 'x\nx'), /ambiguous/);
  assert.throws(() => resolveAnchor({...bp, match: '/x/g', line: 1}, 'x\nx'), /ambiguous/);
  assert.throws(() => resolveAnchor({...bp, line: 3}, 'a\nb'), /line-out-of-range/);
  assert.throws(() => resolveAnchor({...bp, line: -1}, 'a\nb'), /line-out-of-range/);
  assert.throws(() => parsePattern('/abc/q'), /Invalid regex/);
});

test('breakpoint diff reuses only supplied owned handles and replaces changed locations', () => {
  const spec = (id: string, line: number): ResolvedBreakpoint => ({id, file: 'x', line});
  const keep = {spec: spec('keep', 1), handle: {id: 'owned-1'}};
  const changed = {spec: spec('changed', 2), handle: {id: 'owned-2'}};
  const removed = {spec: spec('gone', 3), handle: {id: 'owned-3'}};
  const user = {id: 'user-breakpoint'}; // deliberately never enters the ownership ledger
  const desired = [{...spec('keep', 1), label: 'renamed', kind: 'stop' as const}, spec('changed', 4), spec('new', 5)];
  const diff = diffBreakpoints([keep, changed, removed], desired);
  assert.deepEqual(diff.retain, [{spec: desired[0], handle: keep.handle}]);
  assert.equal(diff.retain[0].handle, keep.handle);
  assert.deepEqual(diff.remove, [changed, removed]);
  assert.deepEqual(diff.add, desired.slice(1));
  assert.ok(!diff.remove.some(entry => entry.handle === user));
  assert.equal(keep.spec.label, undefined);
  assert.equal(diffBreakpoints([keep], [{...keep.spec, condition: 'x'}]).remove.length, 1);
  assert.equal(diffBreakpoints([keep], [{...keep.spec, kind: 'probe'}]).remove.length, 1);
  assert.throws(() => diffBreakpoints([keep, keep], []), /Duplicate/);
  assert.throws(() => diffBreakpoints([], [keep.spec, keep.spec]), /Duplicate/);
});

test('redacts nested keys and arrays before rendering without mutating input', () => {
  const input = {password: 'secret', nested: [{API_TOKEN: 'hidden', safe: 3}, {API_TOKEN: 'also hidden'}],
    text: 'password as a value is not a key', tokenSuffix: 'visible'};
  const patterns = ['passWORD', '/_TOKEN$/gi'];
  const result = redactValue(input, patterns);
  assert.deepEqual(result, {password: '[REDACTED]', nested: [{API_TOKEN: '[REDACTED]', safe: 3}, {API_TOKEN: '[REDACTED]'}],
    text: input.text, tokenSuffix: 'visible'});
  assert.equal(input.password, 'secret');
  const rendered = renderRedacted(input, patterns, true);
  assert.ok(!rendered.includes('hidden'));
  assert.deepEqual(JSON.parse(rendered), result);
  const circular: Record<string, unknown> = {safe: 1}; circular.self = circular;
  assert.deepEqual(redactValue(circular), {safe: 1, self: '[Circular]'});
  const protoKey = JSON.parse('{"__proto__":{"password":"secret"}}');
  assert.equal(renderRedacted(protoKey, ['password']), '{"__proto__":{"password":"[REDACTED]"}}');
});

test('trace writes ordered complete redacted JSONL and atomic status snapshots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'puppet-show-session-'));
  try {
    const writer = createTraceWriter({directory: join(directory, 'nested'), redact: ['secret', '/token/i']});
    const first = {index: 1, secret: 'never-on-disk', nested: {token: 'never-on-disk'}};
    const writes = [writer.append(first), writer.writeStatus({phase: 'running', secret: 'never-on-disk'})];
    first.index = 99; // snapshots are serialized at invocation, not when the queue runs
    for (let index = 2; index <= 30; index++) writes.push(writer.append({index}));
    writes.push(writer.writeStatus({phase: 'done', token: 'never-on-disk'}));
    await Promise.all(writes);
    await writer.flush();
    const text = await readFile(writer.tracePath, 'utf8');
    assert.ok(text.endsWith('\n'));
    assert.ok(!text.includes('never-on-disk'));
    const records = text.trimEnd().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(records.map(record => record.index), Array.from({length: 30}, (_, index) => index + 1));
    assert.equal(records[0].secret, '[REDACTED]');
    assert.equal(records[0].nested.token, '[REDACTED]');
    assert.deepEqual(JSON.parse(await readFile(writer.statusPath, 'utf8')), {phase: 'done', token: '[REDACTED]'});
    assert.deepEqual((await readdir(join(directory, 'nested'))).sort(), ['status.json', 'trace.jsonl']);
    const overridden = createTraceWriter({directory,
      tracePath: join(directory, 'traces', 'session-id.jsonl'),
      statusPath: join(directory, 'status', 'current.json'), redact: ['secret']});
    await Promise.all([overridden.append({secret: 'hidden'}), overridden.writeStatus({done: true})]);
    assert.equal(await readFile(overridden.tracePath, 'utf8'), '{"secret":"[REDACTED]"}\n');
    assert.deepEqual(JSON.parse(await readFile(overridden.statusPath, 'utf8')), {done: true});
  } finally { await rm(directory, {recursive: true, force: true}); }
});
