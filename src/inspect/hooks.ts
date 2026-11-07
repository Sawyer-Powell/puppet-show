/** Inert registration points. No registries or inspector are allocated unless opted in. */
import type { Node } from "../dom/node.ts";
import type { Deck } from "../ui/deck.ts";
import type { Thread } from "../core/thread.ts";
/** Folded to false in browser production builds; Node tests retain opt-in hooks. */
export const inspectionEnabled = import.meta.env ? import.meta.env.DEV || import.meta.env.VITE_PUPPET_SHOW_INSPECT === "1" : true;
export const inspection: {
  node?: (node: Node) => void;
  deck?: (deck: Deck, path?: string) => void;
  thread?: (thread: Thread) => void;
} = {};
