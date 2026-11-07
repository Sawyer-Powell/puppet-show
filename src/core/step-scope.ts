/** Internal run-owned cleanup at explicit scene step boundaries. */
import { getOwner, onCleanup, type OwnerHandle } from "./signal.ts";

const pending = new WeakMap<NonNullable<OwnerHandle>, Set<() => void>>();
export function atNextBeat(clear: () => void): void {
  const owner = getOwner();
  if (!owner) throw new Error("puppet-show: step emphasis needs a scene owner");
  let callbacks = pending.get(owner);
  if (!callbacks) {
    callbacks = new Set();
    pending.set(owner, callbacks);
    onCleanup(() => { pending.delete(owner); });
  }
  callbacks.add(clear);
}
export function clearStep(): void {
  const owner = getOwner();
  const callbacks = owner && pending.get(owner);
  if (!callbacks) return;
  pending.delete(owner!);
  for (const clear of [...callbacks].reverse()) clear();
}
