import { isSeeking } from "../core/player.ts";
import { onCleanup, untrack } from "../core/signal.ts";
import type { Thread } from "../core/thread.ts";
import type { Node } from "../dom/node.ts";
import type { Deck } from "../ui/deck.ts";
import { inspection, inspectionEnabled } from "./hooks.ts";
import type { PuppetShowSnapshot, ThreadInfo } from "./schema.ts";
export type * from "./schema.ts";

export interface Inspector { version: 1; snapshot(): PuppetShowSnapshot; dispose(): void }
declare global { var __puppetShow: Inspector | undefined; }

/** Opt in before creating a deck. Production explainers do not import this module. */
export function inspect(): Inspector {
  if (!inspectionEnabled) throw new Error("puppet-show: inspector hooks are compiled out; rebuild with VITE_PUPPET_SHOW_INSPECT=1");
  if (globalThis.__puppetShow) return globalThis.__puppetShow;
  let nextNode = 1, nextThread = 1;
  const nodes = new Map<number, WeakRef<Node>>();
  let active: { deck: Deck; path?: string } | null = null;
  const registerNode = (node: Node) => {
    const id = nextNode++;
    nodes.set(id, new WeakRef(node));
    onCleanup(() => nodes.delete(id));
  };
  const registerThread = (thread: Thread) => { thread.id = nextThread++; };
  const registerDeck = (deck: Deck, path?: string) => { active = { deck, path }; };
  inspection.node = registerNode;
  inspection.thread = registerThread;
  inspection.deck = registerDeck;
  const tree = (t: Thread): ThreadInfo => ({ id: t.id, label: t.label, time: t.time, done: t.done, children: t.children.map(tree) });
  const api: Inspector = {
    version: 1,
    snapshot: () => untrack(() => {
      const d = active?.deck;
      const p = d?.player.peek(false);
      const runtime = p?.inspectRuntime;
      return {
        version: 1,
        deck: d && p ? {
          ...(active?.path === undefined ? {} : { path: active.path }), chapter: d.chapter.peek(false) ?? 0,
          chapters: d.chapters.map((c, i) => ({ title: c.title, segments: d.players[i].segments.map(s => ({ ...s })) })),
          step: p.step.peek(false) ?? 0, playing: p.playing.peek(false) ?? false, speed: p.speed.peek(false) ?? 1, time: runtime?.now ?? p.time.peek(false) ?? 0,
          caption: d.caption.peek(false) ?? "", seeks: (d.seeks.peek(false) ?? []).slice(-20).map(s => ({ ...s })),
        } : null,
        threads: runtime ? tree(runtime.root) : null,
        nodes: [...nodes].flatMap(([id, ref]) => {
          const n = ref.deref();
          return n?.el.isConnected ? [n.inspectState(id)] : [];
        }).filter(n => n.motion || n.bound).slice(0, 200),
        seeking: isSeeking(),
      };
    }),
    dispose() {
      if (inspection.node === registerNode) delete inspection.node;
      if (inspection.thread === registerThread) delete inspection.thread;
      if (inspection.deck === registerDeck) delete inspection.deck;
      nodes.clear(); active = null;
      if (globalThis.__puppetShow === api) delete globalThis.__puppetShow;
    },
  };
  globalThis.__puppetShow = api;
  return api;
}
