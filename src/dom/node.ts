/**
 * DOM nodes with animatable signal properties.
 *
 *   const box = el("div.box", { x: 0, opacity: 0 }, "box");
 *   view.add(box);
 *   yield* box.opacity(1, 0.3);
 *   yield* all(box.x(240, 1), box.text("moved", 0.4));
 *
 * Layout stays in CSS. Motion is expressed with transform and opacity
 * signals, plus any CSS property or attribute bound through `css()`/`attr()`.
 */

import { inspection, inspectionEnabled } from "../inspect/hooks.ts";
import type { NodeInfo } from "../inspect/schema.ts";
import { effect, getOwner, isSignal, runWithOwner, signal, type OwnerHandle, type Signal, type Source } from "../core/signal.ts";

export type Child = Node | globalThis.Node | string | number | null | undefined | false | (() => unknown) | Child[];

/** Widen literal types, so `css("color", palette.red)` is a `Signal<string>`. */
export type Widen<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T;

type Motion = "x" | "y" | "scale" | "rotate" | "opacity";

export interface Props extends Partial<Record<Motion, Source<number>>> {
  class?: Source<string>;
  style?: Record<string, Source<string | number>>;
  attrs?: Record<string, Source<string | number | boolean | null>>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  /** Raw HTML, for trusted markup such as highlighted code. */
  html?: Source<string>;
}

const MOTION: Record<Motion, number> = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };

export class Node<E extends HTMLElement = HTMLElement> {
  readonly el: E;
  private motion: Record<Motion, Signal<number>> | null = null;
  private bound = new Map<string, Signal<any>>();
  private textSig: Signal<string> | null = null;
  /** Lazily created bindings live as long as the scope that created the node. */
  private readonly owner: OwnerHandle = getOwner();

  constructor(el: E) {
    this.el = el;
    if (inspectionEnabled) inspection.node?.(this);
  }

  /** @internal Read only existing bindings; never invoke lazy signal getters. */
  inspectState(id: number): NodeInfo {
    const info: NodeInfo = { id, tag: this.el.tagName.toLowerCase(), cls: this.el.className,
      text: (this.el.textContent ?? "").slice(0, 40) };
    if (this.motion) {
      const values = Object.entries(this.motion).map(([k, s]) => [k, s.peek(false)]);
      if (values.every(([, v]) => v !== undefined)) info.motion = Object.fromEntries(values) as NodeInfo["motion"];
    }
    if (this.bound.size || this.textSig) {
      const bound: NonNullable<NodeInfo["bound"]> = Object.fromEntries([...this.bound].map(([k, s]) => [k, s.peek(false)]).filter(([, v]) => v !== undefined));
      const text = this.textSig?.peek(false);
      if (text !== undefined) bound.text = text.slice(0, 40);
      info.bound = bound;
    }
    return info;
  }

  private bind<T>(fn: () => T): T {
    return runWithOwner(this.owner, fn);
  }

  /* ------------------------------------------------------ motion signals */

  /** Horizontal offset in px (CSS transform). */
  get x(): Signal<number> {
    return this.m().x;
  }
  get y(): Signal<number> {
    return this.m().y;
  }
  get scale(): Signal<number> {
    return this.m().scale;
  }
  /** Rotation in degrees. */
  get rotate(): Signal<number> {
    return this.m().rotate;
  }
  get opacity(): Signal<number> {
    return this.m().opacity;
  }

  private m(): Record<Motion, Signal<number>> {
    return (this.motion ??= this.bind(() => this.createMotion()));
  }

  private createMotion(): Record<Motion, Signal<number>> {
    const m = {
      x: signal(0),
      y: signal(0),
      scale: signal(1),
      rotate: signal(0),
      opacity: signal(1),
    };
    const style = this.el.style;
    effect(() => {
      const x = m.x();
      const y = m.y();
      const s = m.scale();
      const r = m.rotate();
      const parts = [];
      if (x || y) parts.push(`translate(${round(x)}px, ${round(y)}px)`);
      if (r) parts.push(`rotate(${round(r)}deg)`);
      if (s !== 1) parts.push(`scale(${round(s, 1e4)})`);
      style.transform = parts.join(" ");
    });
    effect(() => {
      const o = m.opacity();
      style.opacity = o === 1 ? "" : String(round(o, 1e3));
      style.visibility = o <= 0.001 ? "hidden" : "";
    });
    return m;
  }

  /** Text content as a signal. Tweening it retypes the text. */
  get text(): Signal<string> {
    return (this.textSig ??= this.bind(() => {
      const t = signal(this.el.textContent ?? "");
      effect(() => {
        this.el.textContent = t();
      });
      return t;
    }));
  }

  /**
   * A signal bound to a CSS property (including `--custom` properties).
   * `initial` is required because tweens start from the signal's value, not
   * from the stylesheet: `node.css("color", palette.fg4)(palette.yellow, 0.3)`.
   * Numbers get `px` except for unitless properties and custom properties.
   */
  css<T extends string | number>(prop: string, initial: T): Signal<Widen<T>> {
    const key = `css:${prop}`;
    let s = this.bound.get(key) as Signal<Widen<T>> | undefined;
    if (!s) {
      const sig = signal<Widen<T>>(initial as Widen<T>);
      this.bound.set(key, (s = sig));
      this.bind(() => bindStyle(this.el, prop, sig as unknown as Signal<string | number>));
    }
    return s;
  }

  /**
   * A signal bound to an attribute. For ordinary attributes `true` sets it
   * empty and `false`/`null` removes it; `aria-*` and `data-*` get "true"/"false".
   */
  attr<T extends string | number | boolean | null>(name: string, initial: T): Signal<Widen<T>> {
    const key = `attr:${name}`;
    let s = this.bound.get(key) as Signal<Widen<T>> | undefined;
    if (!s) {
      const sig = signal<Widen<T>>(initial as Widen<T>);
      this.bound.set(key, (s = sig));
      this.bind(() => bindAttr(this.el, name, sig as unknown as Signal<string | number | boolean | null>));
    }
    return s;
  }

  /** A boolean signal toggling one class. */
  flag(name: string, initial = false): Signal<boolean> {
    const key = `class:${name}`;
    let s = this.bound.get(key) as Signal<boolean> | undefined;
    if (!s) {
      const sig = signal(initial);
      this.bound.set(key, (s = sig));
      this.bind(() => effect(() => this.el.classList.toggle(name, sig())));
    }
    return s;
  }

  /* ----------------------------------------------------------- structure */

  add(...children: Child[]): this {
    append(this.el, children);
    return this;
  }

  /** Remove all children and add these instead. */
  replace(...children: Child[]): this {
    this.el.replaceChildren();
    return this.add(...children);
  }

  remove(): void {
    this.el.remove();
  }
}

const round = (v: number, k = 100) => Math.round(v * k) / k;

/* ------------------------------------------------------------- hyperscript */

/**
 * Create an element. `spec` is a tag with optional `.class` and `#id`
 * suffixes. Function-valued props and children are reactive.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}${"." | "#"}${string}`,
  props?: Props | Child,
  ...children: Child[]
): Node<HTMLElementTagNameMap[K]>;
export function el(spec: string, props?: Props | Child, ...children: Child[]): Node;
export function el(spec: string, props?: Props | Child, ...children: Child[]): Node {
  const [tag, ...parts] = spec.split(/(?=[.#])/);
  const element = document.createElement(tag || "div");
  for (const p of parts) {
    if (p[0] === ".") element.classList.add(p.slice(1));
    else element.id = p.slice(1);
  }
  const node = new Node(element);
  if (isProps(props)) applyProps(node, props);
  else if (props !== undefined) children.unshift(props as Child);
  append(element, children);
  return node;
}

/** Wrap an existing element. */
export const wrap = <E extends HTMLElement>(element: E): Node<E> => new Node(element);

function isProps(v: unknown): v is Props {
  return (
    typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Node) && !(v instanceof globalThis.Node)
  );
}

function applyProps(node: Node, props: Props): void {
  const e = node.el;
  for (const k of Object.keys(MOTION) as Motion[]) {
    const v = props[k];
    if (v !== undefined) node[k](v);
  }
  if (props.class !== undefined) {
    const base = e.className;
    const cls = props.class;
    if (typeof cls === "function") effect(() => (e.className = `${base} ${cls()}`.trim()));
    else e.className = `${base} ${cls}`.trim();
  }
  for (const [k, v] of Object.entries(props.style ?? {})) bindStyle(e, k, v);
  for (const [k, v] of Object.entries(props.attrs ?? {})) bindAttr(e, k, v);
  for (const [k, fn] of Object.entries(props.on ?? {})) e.addEventListener(k, fn as EventListener);
  if (props.html !== undefined) {
    const html = props.html;
    if (typeof html === "function") effect(() => (e.innerHTML = html()));
    else e.innerHTML = html;
  }
}

function bindStyle(e: HTMLElement, prop: string, v: Source<string | number>): void {
  const set = (x: string | number) => {
    const value = typeof x === "number" && !prop.startsWith("--") && !UNITLESS.has(prop) ? `${x}px` : String(x);
    if (prop.startsWith("--") || prop.includes("-")) e.style.setProperty(prop, value);
    else (e.style as unknown as Record<string, string>)[prop] = value;
  };
  if (typeof v === "function" || isSignal(v)) effect(() => set((v as () => string | number)()));
  else set(v);
}

const UNITLESS = new Set(["opacity", "zIndex", "z-index", "flexGrow", "flex-grow", "fontWeight", "font-weight", "lineHeight", "line-height", "order"]);

function bindAttr(e: HTMLElement, name: string, v: Source<string | number | boolean | null>): void {
  const stringly = name.startsWith("aria-") || name.startsWith("data-");
  const set = (x: string | number | boolean | null) => {
    if (x === null || (x === false && !stringly)) e.removeAttribute(name);
    else e.setAttribute(name, x === true && !stringly ? "" : String(x));
  };
  if (typeof v === "function") effect(() => set(v()));
  else set(v);
}

function append(parent: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else if (c instanceof Node) parent.append(c.el);
    else if (c instanceof globalThis.Node) parent.append(c);
    else if (typeof c === "function") region(parent, c);
    else parent.append(String(c));
  }
}

/**
 * A reactive child. If `fn` returns text it becomes a text node; if it
 * returns nodes they replace the previous ones between two markers, so a list
 * can be rebuilt from signals: `el("ul", () => items().map(row))`.
 */
function region(parent: HTMLElement, fn: () => unknown): void {
  const start = document.createComment("");
  const end = document.createComment("");
  parent.append(start, end);
  let text: Text | null = null;
  effect(() => {
    const v = fn();
    const isNodes = v instanceof Node || v instanceof globalThis.Node || Array.isArray(v);
    if (!isNodes) {
      const s = String(v ?? "");
      if (text && text.parentNode === parent && text.previousSibling === start && text.nextSibling === end) {
        text.data = s;
        return;
      }
      clearBetween(start, end);
      text = document.createTextNode(s);
      end.before(text);
      return;
    }
    text = null;
    clearBetween(start, end);
    const frag = document.createElement("div");
    append(frag, [v as Child]);
    end.before(...frag.childNodes);
  });
}

function clearBetween(start: globalThis.Node, end: globalThis.Node): void {
  while (start.nextSibling && start.nextSibling !== end) start.nextSibling.remove();
}
