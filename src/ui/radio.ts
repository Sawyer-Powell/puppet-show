import { effect } from "../core/signal.ts";
import type { Node } from "../dom/node.ts";

/** Internal APG radio navigation, in option order (also in RTL layouts). */
export function radioTarget(key: string, current: number, enabled: readonly number[]): number | undefined {
  if (!enabled.length) return;
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  const direction = key === "ArrowRight" || key === "ArrowDown" ? 1
    : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
  if (!direction) return;
  const position = enabled.indexOf(current);
  return enabled[(position + direction + enabled.length) % enabled.length];
}

/** Shared behaviour only; callers own presentation and signal-backed selection. */
export function radioGroup(o: {
  group: Node;
  label: string;
  buttons: readonly Pick<Node, "el">[];
  checked: (index: number) => boolean;
  select: (index: number) => void;
  disabled?: (index: number) => boolean;
  locked?: () => boolean;
}): void {
  const disabled = (i: number) => o.disabled?.(i) ?? false;
  const locked = () => o.locked?.() ?? false;
  const select = (i: number) => {
    if (!disabled(i) && !locked() && o.buttons[i].el.getAttribute("aria-disabled") !== "true") o.select(i);
  };
  o.group.el.setAttribute("role", "radiogroup");
  o.group.el.setAttribute("aria-label", o.label);
  effect(() => {
    const checked = o.buttons.findIndex((_, i) => o.checked(i) && !disabled(i));
    const tabstop = checked < 0 ? o.buttons.findIndex((_, i) => !disabled(i)) : checked;
    o.buttons.forEach((button, i) => {
      button.el.setAttribute("role", "radio");
      button.el.setAttribute("aria-checked", String(o.checked(i)));
      button.el.setAttribute("aria-disabled", String(disabled(i) || locked()));
      button.el.setAttribute("tabindex", i === tabstop ? "0" : "-1");
    });
  });
  o.buttons.forEach((button, i) => {
    button.el.addEventListener("click", () => select(i));
    button.el.addEventListener("keydown", (event) => {
      const e = event as KeyboardEvent;
      // Locked answers stay navigable for review, but never change selection.
      const enabled = o.buttons.flatMap((b, n) => !disabled(n) &&
        (locked() || b.el.getAttribute("aria-disabled") !== "true") ? [n] : []);
      const next = radioTarget(e.key, i, enabled);
      if (next !== undefined) {
        e.preventDefault();
        e.stopPropagation();
        select(next);
        (o.buttons[next].el as HTMLElement).focus();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault(); // avoid a second, native button click
        e.stopPropagation();
        select(i);
      }
    });
  });
}
