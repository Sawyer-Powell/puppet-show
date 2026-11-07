import {appendFile, mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ViewSpec} from './protocol.ts';

/** Session files are JSON, independent of VS Code and debugger adapter types. */
export interface SessionBreakpoint {
  id: string;
  file: string;
  /** Literal substring, or a /pattern/flags expression, matched against each line. */
  match?: string;
  /** One-based line; used directly without match, or as a missing-match fallback. */
  line?: number;
  condition?: string;
  kind?: 'stop' | 'probe';
  label?: string;
  note?: string;
}
export type SessionCollector = 'puppet-show' | 'source' | {id: string; kind: 'evaluate'; expr: string};
export interface SessionConfig {
  version: 1 | 2;
  name: string;
  launch: string | Record<string, unknown>;
  views?: ViewSpec[];
  maxStops?: number;
  breakpoints?: SessionBreakpoint[];
  collectors?: SessionCollector[];
  /** Keys are tested recursively. Plain patterns are case-insensitive substrings. */
  redact?: string[];
  notes?: string | string[];
}
export class SessionValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'SessionValidationError'; }
}
function fail(path: string, message: string): never {
  throw new SessionValidationError(`${path}: ${message}`);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a non-empty string');
}
function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown field');
}
/** Parse a regex literal; a non-slash-prefixed string is literal text. */
export function parsePattern(pattern: string): RegExp | undefined {
  if (!pattern.startsWith('/')) return undefined;
  const end = pattern.lastIndexOf('/');
  if (end === 0) throw new SessionValidationError(`Invalid regex pattern: ${pattern}`);
  try { return new RegExp(pattern.slice(1, end), pattern.slice(end + 1)); }
  catch { throw new SessionValidationError(`Invalid regex pattern: ${pattern}`); }
}
function pattern(value: unknown, path: string): void {
  text(value, path);
  try { parsePattern(value); } catch { fail(path, 'invalid /regex/flags pattern'); }
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}
function select(value: unknown, path: string): void {
  const paths = Array.isArray(value) ? value : [value];
  if (!paths.length) fail(path, 'expected at least one dotted path');
  paths.forEach((item, i) => {
    const location = Array.isArray(value) ? `${path}[${i}]` : path;
    text(item, location);
    if (item.split('.').some(part => !part.trim() || part.trim() !== part)) fail(location, 'expected a dotted path into stop.data');
  });
}
function validateViews(value: unknown): void {
  const ids = new Set<string>();
  array(value, 'session.views').forEach((item, i) => {
    const path = `session.views[${i}]`;
    const view = object(item, path);
    keys(view, ['id', 'kind', 'select', 'lines', 'breakpoint', 'key', 'columns', 'children', 'label', 'template'], path);
    text(view.id, `${path}.id`);
    if (ids.has(view.id)) fail(`${path}.id`, 'duplicate view id');
    ids.add(view.id);
    if (!['value', 'series', 'table', 'tree', 'events', 'puppet-show:threads'].includes(view.kind as string)) fail(`${path}.kind`, 'unknown view kind');
    if (view.select !== undefined) select(view.select, `${path}.select`);
    for (const field of ['breakpoint', 'key', 'children', 'label', 'template']) {
      if (view[field] !== undefined) text(view[field], `${path}.${field}`);
    }
    if (view.columns !== undefined) {
      const columns = array(view.columns, `${path}.columns`);
      if (!columns.length) fail(`${path}.columns`, 'expected at least one column');
      columns.forEach((column, j) => text(column, `${path}.columns[${j}]`));
    }
    if (view.lines !== undefined) {
      const lines = array(view.lines, `${path}.lines`);
      if (!lines.length) fail(`${path}.lines`, 'expected at least one line');
      lines.forEach((item, j) => {
        const location = `${path}.lines[${j}]`;
        const line = object(item, location);
        keys(line, ['select', 'label'], location);
        text(line.select, `${location}.select`);
        select(line.select, `${location}.select`);
        if (line.label !== undefined) text(line.label, `${location}.label`);
      });
    }
    if (['value', 'table', 'tree'].includes(view.kind as string) && view.select === undefined) fail(`${path}.select`, 'required for this view kind');
    if (view.kind === 'series' && view.select === undefined && view.lines === undefined) fail(path, 'series requires select or lines');
    if (view.lines !== undefined && view.kind !== 'series') fail(`${path}.lines`, 'only supported for series');
    if (view.select !== undefined && view.lines !== undefined) fail(path, 'use select or lines, not both');
  });
}
/** Effective views for legacy sessions, using collector-result paths into stop.data. */
export function sessionViews(config: SessionConfig): ViewSpec[] {
  return structuredClone(config.views ?? [
    {id: 'threads', kind: 'puppet-show:threads'},
    {id: 'nodes', kind: 'table', select: 'puppet-show.value.nodes', key: 'id', columns: ['tag', 'text', 'motion.x', 'motion.opacity']},
    {id: 'deck', kind: 'value', select: ['puppet-show.value.deck.chapter', 'puppet-show.value.deck.step', 'puppet-show.value.deck.time']},
  ]);
}
/** Maximum full stops retained in memory; validation never injects this default. */
export function sessionMaxStops(config: SessionConfig): number {
  const limit = config.maxStops === undefined ? 10_000 : config.maxStops;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000) fail('session.maxStops', 'expected an integer from 1 to 1000000');
  return limit;
}
/** Validate without coercion or defaults; returns a detached JSON-compatible value. */
export function validateSession(value: unknown): SessionConfig {
  const root = object(value, 'session');
  keys(root, ['$schema', 'version', 'name', 'launch', 'breakpoints', 'collectors', 'redact', 'notes', ...(root.version === 2 ? ['views', 'maxStops'] : [])], 'session');
  if (root.$schema !== undefined) text(root.$schema, 'session.$schema');
  if (root.version !== 1 && root.version !== 2) fail('session.version', 'expected supported version 1 or 2');
  if (root.views !== undefined) validateViews(root.views);
  if (root.maxStops !== undefined) sessionMaxStops(root as unknown as SessionConfig);
  text(root.name, 'session.name');
  if (typeof root.launch === 'string') text(root.launch, 'session.launch');
  else object(root.launch, 'session.launch');
  const ids = new Set<string>();
  if (root.breakpoints !== undefined) array(root.breakpoints, 'session.breakpoints').forEach((item, i) => {
    const path = `session.breakpoints[${i}]`;
    const bp = object(item, path);
    keys(bp, ['id', 'file', 'match', 'line', 'condition', 'kind', 'label', 'note'], path);
    text(bp.id, `${path}.id`);
    if (ids.has(bp.id)) fail(`${path}.id`, 'duplicate breakpoint id');
    ids.add(bp.id);
    text(bp.file, `${path}.file`);
    if (bp.match !== undefined) pattern(bp.match, `${path}.match`);
    if (bp.line !== undefined && (!Number.isSafeInteger(bp.line) || (bp.line as number) < 1)) fail(`${path}.line`, 'expected a positive one-based integer');
    if (bp.match === undefined && bp.line === undefined) fail(path, 'requires match or line');
    if (bp.kind !== undefined && bp.kind !== 'stop' && bp.kind !== 'probe') fail(`${path}.kind`, 'expected stop or probe');
    for (const key of ['condition', 'label', 'note']) {
      if (bp[key] !== undefined && typeof bp[key] !== 'string') fail(`${path}.${key}`, 'expected a string');
    }
  });
  const collectorIds = new Set<string>();
  if (root.collectors !== undefined) array(root.collectors, 'session.collectors').forEach((item, i) => {
    const path = `session.collectors[${i}]`;
    let id: string;
    if (typeof item === 'string') {
      if (item !== 'puppet-show' && item !== 'source') fail(path, 'unknown builtin collector');
      id = item;
    } else {
      const collector = object(item, path);
      keys(collector, ['id', 'kind', 'expr'], path);
      text(collector.id, `${path}.id`);
      text(collector.expr, `${path}.expr`);
      if (collector.kind !== 'evaluate') fail(`${path}.kind`, 'expected evaluate');
      id = collector.id;
    }
    if (collectorIds.has(id)) fail(path, 'duplicate collector id');
    collectorIds.add(id);
  });
  if (root.redact !== undefined) array(root.redact, 'session.redact').forEach((item, i) => pattern(item, `session.redact[${i}]`));
  if (root.notes !== undefined) {
    if (typeof root.notes !== 'string') array(root.notes, 'session.notes').forEach((item, i) => {
      if (typeof item !== 'string') fail(`session.notes[${i}]`, 'expected a string');
    });
  }
  // Reject values JSON would silently discard or change (inline launch objects included).
  assertJson(value, 'session', new Set());
  if (typeof root.launch !== 'string') {
    const launch = root.launch as Record<string, unknown>;
    if (root.version === 2 && launch.type === undefined && launch.request === undefined) {
      keys(launch, ['name', 'url'], 'session.launch');
      text(launch.name, 'session.launch.name');
      text(launch.url, 'session.launch.url');
    } else {
      text(launch.type, 'session.launch.type');
      if (launch.request !== 'launch' && launch.request !== 'attach') fail('session.launch.request', 'expected launch or attach');
      if (launch.name !== undefined) text(launch.name, 'session.launch.name');
    }
  }
  return JSON.parse(JSON.stringify(value)) as SessionConfig;
}
function assertJson(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value) fail(path, 'expected JSON data');
  if (seen.has(value)) fail(path, 'cyclic value');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail(path, 'expected a plain JSON object');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) assertJson(child, `${path}.${key}`, seen);
  seen.delete(value);
}
export function parseSession(json: string): SessionConfig {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new SessionValidationError('session: invalid JSON'); }
  return validateSession(value);
}

export interface ResolvedBreakpoint extends SessionBreakpoint { line: number; }
export class AnchorResolutionError extends Error {
  readonly breakpointId: string;
  readonly reason: 'missing' | 'ambiguous' | 'line-out-of-range';
  constructor(breakpointId: string, reason: 'missing' | 'ambiguous' | 'line-out-of-range') {
    super(`Breakpoint ${breakpointId}: ${reason}`);
    this.name = 'AnchorResolutionError';
    this.breakpointId = breakpointId;
    this.reason = reason;
  }
}
/** A fallback never masks an ambiguous anchor. Line numbers are always one-based. */
export function resolveAnchor(breakpoint: SessionBreakpoint, source: string): ResolvedBreakpoint {
  const lines = source.split(/\r\n|\n|\r/);
  if (breakpoint.match !== undefined) {
    const regex = parsePattern(breakpoint.match);
    const matches: number[] = [];
    lines.forEach((line, index) => {
      if (regex) regex.lastIndex = 0;
      if (regex ? regex.test(line) : line.includes(breakpoint.match!)) matches.push(index + 1);
    });
    if (matches.length > 1) throw new AnchorResolutionError(breakpoint.id, 'ambiguous');
    if (matches.length === 1) return {...breakpoint, line: matches[0]};
  }
  if (breakpoint.line === undefined) throw new AnchorResolutionError(breakpoint.id, 'missing');
  if (!Number.isSafeInteger(breakpoint.line) || breakpoint.line < 1 || breakpoint.line > lines.length) throw new AnchorResolutionError(breakpoint.id, 'line-out-of-range');
  return {...breakpoint, line: breakpoint.line};
}

/** This ledger must contain only handles created by this session, never user breakpoints. */
export interface OwnedBreakpoint<Handle> { spec: ResolvedBreakpoint; handle: Handle; }
export interface BreakpointDiff<Handle> {
  retain: OwnedBreakpoint<Handle>[];
  remove: OwnedBreakpoint<Handle>[];
  add: ResolvedBreakpoint[];
}
/** Reuse unchanged owned handles; metadata-only edits update the retained specification. */
export function diffBreakpoints<Handle>(owned: readonly OwnedBreakpoint<Handle>[], desired: readonly ResolvedBreakpoint[]): BreakpointDiff<Handle> {
  const old = new Map(owned.map(entry => [entry.spec.id, entry]));
  if (old.size !== owned.length || new Set(desired.map(bp => bp.id)).size !== desired.length) throw new Error('Duplicate breakpoint id');
  const retain: OwnedBreakpoint<Handle>[] = [];
  const add: ResolvedBreakpoint[] = [];
  for (const spec of desired) {
    const prior = old.get(spec.id);
    if (prior && prior.spec.file === spec.file && prior.spec.line === spec.line &&
      prior.spec.condition === spec.condition && (prior.spec.kind ?? 'stop') === (spec.kind ?? 'stop')) {
      retain.push({spec, handle: prior.handle});
      old.delete(spec.id);
    } else add.push(spec);
  }
  return {retain, remove: [...old.values()], add};
}

export const REDACTED = '[REDACTED]';
/** Redact by key before any rendering/persistence, without mutating the input. */
export function redactValue(value: unknown, patterns: readonly string[] = []): unknown {
  const matchers = patterns.map(item => {
    const regex = parsePattern(item);
    return (key: string) => {
      if (!regex) return key.toLowerCase().includes(item.toLowerCase());
      regex.lastIndex = 0;
      return regex.test(key);
    };
  });
  const ancestors = new Set<object>();
  function visit(input: unknown): unknown {
    if (input === null || typeof input !== 'object') return input;
    if (ancestors.has(input)) return '[Circular]';
    ancestors.add(input);
    let result: unknown;
    if (Array.isArray(input)) result = input.map(visit);
    else result = Object.fromEntries(Object.entries(input).map(([key, child]) =>
      [key, matchers.some(matches => matches(key)) ? REDACTED : visit(child)]));
    ancestors.delete(input);
    return result;
  }
  return visit(value);
}
export function renderRedacted(value: unknown, patterns: readonly string[] = [], pretty = false): string {
  return JSON.stringify(redactValue(value, patterns), null, pretty ? 2 : undefined) ?? 'null';
}
export interface TraceWriterOptions {
  directory: string;
  redact?: readonly string[];
  /** Overrides are used verbatim, not resolved relative to directory. */
  tracePath?: string;
  statusPath?: string;
}
export interface TraceWriter {
  readonly tracePath: string;
  readonly statusPath: string;
  /** Serializes each complete JSONL record into one append; status is atomic rename. */
  append(record: unknown): Promise<void>;
  writeStatus(status: unknown): Promise<void>;
  flush(): Promise<void>;
}
/** One writer per directory. Ordered within this writer; callers own directory isolation. */
export function createTraceWriter(options: TraceWriterOptions): TraceWriter {
  const tracePath = options.tracePath ?? join(options.directory, 'trace.jsonl');
  const statusPath = options.statusPath ?? join(options.directory, 'status.json');
  const patterns = [...(options.redact ?? [])];
  // Compile/validate immediately, even before the first write.
  patterns.forEach(parsePattern);
  let pending = Promise.resolve();
  function enqueue(operation: () => Promise<void>): Promise<void> {
    const next = pending.then(operation);
    pending = next.catch(() => {});
    return next;
  }
  return {
    tracePath, statusPath,
    append(record) {
      const serialized = renderRedacted(record, patterns) + '\n';
      return enqueue(async () => {
        await mkdir(dirname(tracePath), {recursive: true});
        await appendFile(tracePath, serialized, {encoding: 'utf8', mode: 0o600});
      });
    },
    writeStatus(status) {
      const serialized = renderRedacted(status, patterns, true) + '\n';
      return enqueue(async () => {
        await mkdir(dirname(statusPath), {recursive: true});
        const temporary = `${statusPath}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, serialized, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
          await rename(temporary, statusPath);
        } finally { await rm(temporary, {force: true}); }
      });
    },
    flush() { return pending; },
  };
}
