import type {Collected} from '../protocol.ts';
import {stageCollector} from './puppet-show.ts';
import {source} from './source.ts';
export interface Frame {id: number; name: string; source?: {path?: string}; line: number; column: number}
export interface Session {customRequest(command: string, args?: unknown): PromiseLike<any>}
export interface CollectorContext {
  session: Session;
  frame?: Frame;
  readFile(path: string): Promise<string>;
}
export interface Collector {id: string; timeoutMs: number; collect(context: CollectorContext): Promise<Collected>}
export const collectors: Collector[] = [stageCollector, source];
export async function collectAll(context: CollectorContext, list = collectors): Promise<Record<string, Collected>> {
  return Object.fromEntries(await Promise.all(list.map(async collector => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => collector.collect(context)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out after ${collector.timeoutMs}ms`)), collector.timeoutMs); }),
      ]);
      return [collector.id, value];
    } catch (error) {
      return [collector.id, {ok: false, error: error instanceof Error ? error.message : String(error)}];
    } finally { clearTimeout(timer); }
  })));
}
