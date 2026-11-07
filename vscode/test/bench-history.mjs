// node --expose-gc --experimental-strip-types test/bench-history.mjs <test-trace>
import {readFileSync} from 'node:fs';
import {History} from '../src/model.ts';
import {sessionViews, parseSession} from '../src/session.ts';
const trace = process.argv[2];
if (!trace) throw new Error('Pass a synthetic e2e trace path');
const records = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
// Use the largest captured snapshot rather than an unrealistically empty stop.
const representative = records.reduce((a, b) => JSON.stringify(a).length > JSON.stringify(b).length ? a : b);
const config = parseSession(readFileSync(new URL('../../docs/debugger/logical-time.puppet-show-session.json', import.meta.url), 'utf8'));
const h = new History({id: 'bench', name: '5k retained snapshots'}, sessionViews(config), 5000);
records.length = 0;
global.gc?.();
const before = process.memoryUsage();
let start = performance.now();
for (let i = 0; i < 5000; i++) h.append(structuredClone(representative));
const appendMs = performance.now() - start;
global.gc?.();
const at5k = process.memoryUsage();
start = performance.now();
let checksum = 0;
for (let i = 0; i < 100000; i++) checksum += h.fetch((i * 7919) % 5000)?.stop.seq ?? 0;
const scrubMs = performance.now() - start;
for (let i = 0; i < 10000; i++) h.append(structuredClone(representative));
global.gc?.();
const afterEviction = process.memoryUsage();
console.log(JSON.stringify({retained: h.size, first: h.first, total: h.total, sampleBytes: Buffer.byteLength(JSON.stringify(representative)), nodes: representative.data["puppet-show"]?.value?.nodes?.length, heapAt5kMiB: +(at5k.heapUsed / 2**20).toFixed(2), heapDelta5kMiB: +((at5k.heapUsed - before.heapUsed) / 2**20).toFixed(2), rssAt5kMiB: +(at5k.rss / 2**20).toFixed(2), heapAfter15kMiB: +(afterEviction.heapUsed / 2**20).toFixed(2), appendStopsPerSecond: Math.round(5000 / appendMs * 1000), scrub100kMs: +scrubMs.toFixed(2), checksum}, null, 2));
