/**
 * Deck: the click-through shell. Chapters are scenes; beats inside a scene
 * are steps. The deck owns navigation, the step meter and the caption line.
 *
 *   deck(document.body, {
 *     path: "puppet-show://how-it-works",
 *     chapters: [{ title: "a scene is a generator", scene: intro }],
 *   });
 *
 * Inside a scene, `yield* say("...")` sets the caption for the current step.
 */

import { all, chain, type Step } from "../core/flow.ts";
import { inspection, inspectionEnabled } from "../inspect/hooks.ts";
import { Player, type SeekStats } from "../core/player.ts";
import { effect, onCleanup, signal, untrack, type Signal } from "../core/signal.ts";
import { tween, waitFor, type Task } from "../core/thread.ts";
import { el, type Node } from "../dom/node.ts";
import { setView, View } from "../dom/view.ts";
import { plain, render, renderRise, visibleLength } from "./markup.ts";
import { observeAsks, pendingAsk, type Ask } from "../blocks/interaction.ts";
import { choice, panel } from "./components.ts";

export interface Chapter {
  title: string;
  /** Stable URL identifier; nonempty, nonnumeric and unique within the deck. */
  id?: string;
  scene: (view: View) => Task;
}

export interface DeckOptions {
  /** Small breadcrumb above the title, e.g. `puppet-show://how-it-works`. */
  path?: string;
  chapters: Chapter[];
  /** Start on this chapter. */
  start?: number;
  /** Own the URL fragment (default true); "push" enables back/forward steps. */
  hash?: boolean | "push";
  /** Caption placement. Defaults to top; use note() for anchored captions. */
  caption?: "top" | "bottom" | "none";
  /** Type captions by default. Defaults to false; same as captionMotion: "type". */
  captionTyped?: boolean;
  /**
   * How captions appear: "rise" (default) fades words in left to right in
   * under half a second, "type" types them with a cursor, "none" is instant.
   * Reduced motion is always instant.
   */
  captionMotion?: CaptionMotion;
  /** Show chapter tabs and the step meter (both default to true). */
  tabs?: boolean;
  meter?: boolean;
  /** Right-hand footer text, or false to omit the entire footer. */
  footer?: string | false;
  /** Allow the depth control when a scene reads depth (default true). */
  depth?: boolean;
}

// Hash ownership is per document, not per scene/run.
const hashOwners = new WeakMap<Document, Deck>();

/** URL identifiers derived once, independently of scene replay. */
export function chapterIds(chapters: Pick<Chapter, "title" | "id">[]): string[] {
  const used = new Set<string>();
  for (const c of chapters) {
    if (c.id === undefined) continue;
    if (!c.id || /^\d+$/.test(c.id) || used.has(c.id)) throw new Error("puppet-show: chapter ids must be nonempty, nonnumeric and unique");
    used.add(c.id);
  }
  return chapters.map(c => {
    if (c.id !== undefined) return c.id;
    let base = c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chapter";
    if (/^\d+$/.test(base)) base = `chapter-${base}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}

/** Numbers are reserved for positional aliases; named beats end their step. */
export function stepIds(segments: { name: string }[]): string[] {
  return segments.map((s, i) => s.name && !/^\d+$/.test(s.name) && segments.filter(t => t.name === s.name).length === 1 ? s.name : String(i + 1));
}

export function hashTarget(hash: string, ids: string[], steps: string[][]): [number, number] | null {
  try {
    if (!hash.startsWith("#") || hash.length === 1) return null;
    const parts = hash.slice(1).split("/").map(decodeURIComponent);
    if (parts.length > 2 || parts.some(p => !p)) return null;
    const c = /^\d+$/.test(parts[0]) ? Number(parts[0]) - 1 : ids.indexOf(parts[0]);
    if (!Number.isSafeInteger(c) || !steps[c]) return null;
    const s = parts[1] === undefined ? 0 : /^\d+$/.test(parts[1]) ? Number(parts[1]) - 1 : steps[c].indexOf(parts[1]);
    return Number.isSafeInteger(s) && s >= 0 && s < steps[c].length ? [c, s] : null;
  } catch { return null; } // Malformed percent escapes are user input too.
}

let currentDeck: Deck | null = null;
let readingDepth: (() => void) | null = null;

export type Depth = "intro" | "standard" | "deep";
const depthValue = signal<Depth>("standard");
/**
 * Durable learner preference. Read depth() in the scene generator to branch
 * on steps. Such reads opt that deck into the depth control; reads made only
 * in deferred callbacks/effects are not a structural depth declaration.
 * Changing depth reanalyzes every chapter and seeks to the clamped step index.
 */
export const depth: Signal<Depth> = new Proxy(depthValue, {
  apply(target, thisArg, args) {
    if (args.length === 0) readingDepth?.();
    return Reflect.apply(target, thisArg, args);
  },
});

export type CaptionMotion = "rise" | "type" | "none";

export interface SayOptions {
  /** Override the deck's captionMotion for this caption. */
  motion?: CaptionMotion;
  /** Same as motion: "type". */
  typed?: boolean;
  /** Typing duration in seconds; ignored for instant captions. */
  duration?: number;
}

/**
 * Chapter tab text. The deck numbers chapters ("01 run a task"); a title that
 * already starts with its own number ("1 · run a task") is used as-is, so
 * tabs never read "01 1 · run a task".
 */
export function tabLabel(index: number, title: string): string {
  return /^\d+\b/.test(title.trim()) ? title : `${String(index + 1).padStart(2, "0")} ${title}`;
}

export class Deck {
  readonly root: Node<HTMLDivElement>;
  readonly view: View;
  readonly chapter = signal(0);
  /** The player of the current chapter. */
  readonly player: Signal<Player>;
  /** Caption markup and how much of it is typed, 0..1. */
  readonly caption = signal("");
  readonly typed = signal(1);
  /** Word-rise reveal progress of the caption, 0..1. */
  readonly rise = signal(1);
  /** Highest (chapter, step) reached, for marking chapters as seen. */
  private seen = signal(0);

  /** Every seek made in this session, newest last. */
  readonly seeks = signal<SeekStats[]>([]);

  readonly chapters: Chapter[];
  /** The question the learner was last pointed at by "next". */
  private nudged: Ask<string> | null = null;
  private readonly nudgedSig = signal<Ask<string> | null>(null);
  /** One player per chapter. Filled in order while the deck is built. */
  readonly players: Player[] = [];
  readonly captionTyped: boolean;
  readonly captionMotion: CaptionMotion;
  private readonly usesDepth = signal(false);
  private readonly usesAsk = signal(false);
  private seekListeners: (() => void)[] = [];
  private readonly ids: string[];
  private hashMode: boolean | "push" = false;
  private handlingHash = false;
  private lastHash = "";
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(host: HTMLElement, options: DeckOptions) {
    this.chapters = options.chapters;
    this.ids = chapterIds(this.chapters);
    this.captionTyped = options.captionTyped ?? false;
    this.captionMotion = this.reduced ? "none" : options.captionMotion ?? (this.captionTyped ? "type" : "rise");
    const stage = el("div.ps-stage");
    this.view = new View(stage.el);
    currentDeck = this;
    this.buildPlayers();
    this.player = signal(this.players[0]);
    this.root = this.shell(options, stage);
    // Keep failure UI outside scene content, which is reconstructed on navigation.
    let failure: Node | null = null;
    effect(() => {
      const error = this.player().error();
      failure?.remove();
      failure = null;
      if (error) {
        failure = panel("scene error", { class: "ps-bad", attrs: { role: "alert" } },
          el("div", error.message),
          el("div", `chapter ${this.chapter() + 1} · step ${error.chapterStep + 1}`));
        stage.el.append(failure.el);
      }
    });
    host.append(this.root.el);
    this.listen();
    const win = host.ownerDocument.defaultView!;
    if (options.hash !== false) {
      if (hashOwners.has(host.ownerDocument)) console.warn("puppet-show: only one deck can own the hash; pass hash:false to additional decks");
      else {
        hashOwners.set(host.ownerDocument, this);
        this.hashMode = options.hash ?? true;
      }
    }
    const target = this.hashMode ? this.resolveHash(win.location.hash) : null;
    this.open(target?.[0] ?? options.start ?? 0, this.reduced ? "first" : "play");
    this.handlingHash = true;
    if (target) this.goto(...target);
    this.handlingHash = false;
    if (inspectionEnabled) inspection.deck?.(this, options.path);
    if (import.meta.env?.DEV) this.drive();
    this.writeHash(true);
    if (this.hashMode) {
      const navigate = () => {
        const hash = win.location.hash;
        if (hash === this.lastHash) return;
        this.handlingHash = true;
        try {
          const target = this.resolveHash(hash);
          this.goto(...(target ?? [options.start ?? 0, 0]));
        } finally { this.handlingHash = false; }
        this.writeHash(true);
      };
      win.addEventListener("hashchange", navigate);
      if (this.hashMode === "push") win.addEventListener("popstate", navigate);
    }
    let previousDepth = depthValue.peek();
    effect(() => {
      const value = depthValue();
      if (value === previousDepth) return;
      previousDepth = value;
      if (!this.usesDepth.peek()) return;
      untrack(() => {
        const step = this.player.peek().step.peek();
        const chapter = this.chapter.peek();
        const name = stepIds(this.player.peek().segments)[step];
        this.buildPlayers();
        this.seen(0);
        this.player(this.players[chapter]);
        const named = /^\d+$/.test(name) ? -1 : stepIds(this.player.peek().segments).indexOf(name);
        this.player.peek().seek(named < 0 ? step : named);
        this.mark();
        this.writeHash();
      });
    });
  }

  /** Build a fragment from zero-based chapter/step indices (or a chapter id/beat name). */
  href(chapter: number | string, step: number | string = 0): string {
    const c = typeof chapter === "number" ? chapter : this.ids.indexOf(chapter);
    if (!this.ids[c]) throw new Error("puppet-show: unknown chapter in deck.href");
    // Scenes also build links during analysis, before all players exist. Named
    // forward links need no player metadata; numeric links can use an alias.
    const steps = this.players[c] && stepIds(this.players[c].segments);
    const token = typeof step === "string" ? step : steps?.[step] ?? String(step + 1);
    if (!token || (typeof step === "number" && (!Number.isInteger(step) || step < 0 || (steps && step >= steps.length)))) {
      throw new Error("puppet-show: invalid step in deck.href");
    }
    return `#${encodeURIComponent(this.ids[c])}/${encodeURIComponent(token)}`;
  }

  private resolveHash(hash: string): [number, number] | null {
    return hashTarget(hash, this.ids, this.players.map(p => stepIds(p.segments)));
  }

  private writeHash(replace = false): void {
    if (!this.hashMode || this.handlingHash) return;
    const win = this.root.el.ownerDocument.defaultView!;
    const hash = this.href(this.chapter.peek(), this.player.peek().step.peek());
    this.lastHash = hash;
    if (win.location.hash === hash) return;
    // file:// and opaque/sandboxed frames may disallow History API writes.
    try { win.history[this.hashMode === "push" && !replace ? "pushState" : "replaceState"](null, "", hash); }
    catch { /* Do not fall back to location.hash: that scrolls and emits events. */ }
  }

  /** Total steps across all chapters, and the global index of the current one. */
  position(): { index: number; total: number } {
    const c = this.chapter();
    const before = this.players.slice(0, c).reduce((n, p) => n + p.count, 0);
    return { index: before + this.player().step(), total: this.players.reduce((n, p) => n + p.count, 0) };
  }

  next(): void {
    const p = this.player.peek();
    if (p.error.peek()) return;
    // An unanswered question on screen: point at it first; skip on a second press.
    const q = p.playing.peek() ? null : untrack(pendingAsk);
    if (q && (q.required || this.nudged !== q)) {
      this.nudged = q;
      q.attend();
      return;
    }
    this.nudged = null;
    if (p.playing.peek() || p.step.peek() + 1 < p.count) {
      if (this.reduced && !p.playing.peek()) p.seek(p.step.peek() + 1);
      else p.next();
    } else if (this.chapter.peek() + 1 < this.chapters.length) {
      this.open(this.chapter.peek() + 1, this.reduced ? "first" : "play");
    }
    this.mark();
    this.writeHash();
  }

  prev(): void {
    const p = this.player.peek();
    if (!p.prev() && this.chapter.peek() > 0) this.open(this.chapter.peek() - 1, "last");
    this.writeHash();
  }

  replay(): void {
    const p = this.player.peek();
    if (this.reduced) p.seek(p.step.peek());
    else p.replay();
    this.writeHash();
  }

  goto(chapter: number, step?: number): void {
    if (step === undefined) this.open(chapter, this.reduced ? "first" : "play");
    else {
      if (chapter !== this.chapter.peek()) this.open(chapter, "first");
      if (this.reduced) this.player.peek().seek(step);
      else this.player.peek().play(step);
    }
    this.mark();
    this.writeHash();
  }

  /* ------------------------------------------------------------ internals */

  /** Dev-only scenario driver for debugger sessions. No timer is installed without ?autoplay=. */
  private drive(): void {
    const query = new URLSearchParams(location.search);
    if (!query.has("autoplay")) return;
    const pause = Number(query.get("autoplay"));
    if (!Number.isFinite(pause) || pause < 0) return;
    const back = Number(query.get("back") ?? 0);
    let remaining = Number.isFinite(back) ? Math.min(Math.max(0, Math.trunc(back)), this.position().total - 1) : 0;
    let retreat = false;
    effect(() => {
      const player = this.player();
      this.chapter(); player.step();
      if (player.playing() || (retreat && remaining === 0)) return;
      const position = untrack(() => this.position());
      if (!retreat && position.index + 1 >= position.total && remaining === 0) return;
      const timer = setTimeout(() => {
        if (!this.root.el.isConnected) return;
        if (retreat) { remaining--; this.prev(); }
        else if (position.index + 1 < position.total) this.next();
        else { retreat = true; remaining--; this.prev(); }
      }, pause * 1000);
      onCleanup(() => clearTimeout(timer));
    });
  }

  private buildPlayers(): void {
    for (const dispose of this.seekListeners.splice(0)) dispose();
    for (const p of this.players) p.dispose();
    this.players.length = 0;
    this.usesAsk(false);
    for (const c of this.chapters) {
      const p = new Player(() => this.mount(c), {
        onError: error => console.error(`puppet-show: scene error in chapter ${this.chapters.indexOf(c) + 1} "${c.title}" step ${error.chapterStep + 1}: ${error.message}`),
      });
      p.dispose();
      this.players.push(p);
      this.seekListeners.push(effect(() => {
        const s = p.lastSeek();
        if (s) untrack(() => this.seeks([...this.seeks(), s]));
      }));
    }
  }

  private *mount(chapter: Chapter): Task {
    this.view.clear();
    setView(this.view);
    currentDeck = this;
    this.caption("");
    this.typed(1);
    this.rise(1);
    const scene = chapter.scene(this.view);
    let input: unknown;
    try {
      while (true) {
        const previous = readingDepth;
        let result: IteratorResult<unknown, void>;
        readingDepth = () => this.usesDepth(true);
        try {
          result = observeAsks(() => this.usesAsk(true), () => scene.next(input));
        } finally {
          readingDepth = previous;
        }
        if (result.done) return;
        input = yield result.value;
      }
    } finally {
      scene.return();
    }
  }

  private open(i: number, at: "play" | "first" | "last"): void {
    this.player.peek().dispose();
    this.chapter(i);
    const p = this.players[i];
    this.player(p);
    if (at === "play") p.play(0);
    else p.seek(at === "first" ? 0 : p.count - 1);
    this.mark();
  }

  private mark(): void {
    const { index } = untrack(() => this.position());
    if (index > this.seen.peek()) this.seen(index);
  }

  private shell(o: DeckOptions, stage: Node): Node<HTMLDivElement> {
    const btn = (label: string, title: string, fn: () => void, cls = "") =>
      el(`button.ps-btn${cls}`, { attrs: { type: "button", title }, on: { click: fn } }, label);

    const pos = () => this.position();
    const count = el("span.ps-count", () => {
      const { index, total } = pos();
      return `${String(index + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
    });
    const prev = btn("←", "previous (←)", () => this.prev());
    const next = btn("next →", "next (→ or space)", () => {
      this.next();
      this.nudgedSig(this.nudged);
    }, ".ps-primary");
    // While a question waits, the primary button says so instead of "next".
    effect(() => {
      this.player().step();
      const q = pendingAsk();
      const label = !q ? "next →" : q.required ? "answer first ↓" : this.nudgedSig() === q ? "skip →" : "answer ↓";
      next.el.textContent = label;
      next.el.classList.toggle("ps-asking", !!q);
    });
    const prevOff = prev.attr<boolean>("disabled", false);
    const nextOff = next.attr<boolean>("disabled", false);
    effect(() => prevOff(pos().index === 0));
    effect(() => {
      const { index, total } = pos();
      nextOff(!!this.player().error() || (index + 1 >= total && !this.player().playing()));
    });

    const tabs = el("nav.ps-chapters", { attrs: { role: "tablist", "aria-label": "chapters" } });
    const revealTab = (button: HTMLElement) => {
      const left = button.offsetLeft - tabs.el.offsetLeft;
      if (left < tabs.el.scrollLeft) tabs.el.scrollLeft = left;
      else if (left + button.offsetWidth > tabs.el.scrollLeft + tabs.el.clientWidth)
        tabs.el.scrollLeft = left + button.offsetWidth - tabs.el.clientWidth;
    };
    this.chapters.forEach((c, i) => {
      const b = el(
        "button",
        {
          attrs: { type: "button", role: "tab", "aria-selected": () => this.chapter() === i, tabindex: () => this.chapter() === i ? 0 : -1 },
          class: () => (this.chapter() === i ? "on" : this.seenChapter(i) ? "seen" : ""),
          on: {
            click: () => this.goto(i),
            keydown: (event) => {
              const e = event as KeyboardEvent;
              // Automatic-activation tabs own activation keys, not deck stepping.
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); return; }
              const target = e.key === "Home" ? 0 : e.key === "End" ? this.chapters.length - 1
                : e.key === "ArrowRight" ? (i + 1) % this.chapters.length
                : e.key === "ArrowLeft" ? (i + this.chapters.length - 1) % this.chapters.length : null;
              if (target === null) return;
              e.preventDefault();
              this.goto(target);
              (tabs.el.children[target] as HTMLElement).focus({ preventScroll: true });
            },
          },
        },
        tabLabel(i, c.title),
      );
      tabs.add(b);
    });
    effect(() => {
      const i = this.chapter();
      revealTab(tabs.el.children[i] as HTMLElement);
    });
    // Initial effects run before attachment; resize also handles embedding changes.
    const tabResize = new ResizeObserver(() => revealTab(tabs.el.children[this.chapter.peek()] as HTMLElement));
    tabResize.observe(tabs.el);

    const depthChoice = choice<Depth>({
      label: "depth",
      value: depthValue,
      options: [
        { value: "intro", label: "intro" },
        { value: "standard", label: "standard" },
        { value: "deep", label: "deep" },
      ],
    });
    const cells = el("div.ps-cells", { attrs: { role: "group", "aria-label": "steps" } });
    effect(() => {
      const p = this.player();
      cells.replace(
        p.segments.map((_, i) =>
          el(
            "button.ps-cell",
            {
              attrs: { type: "button", "aria-label": `step ${i + 1}` },
              class: () => (p.step() === i ? "on" : ""),
              style: { "--p": () => (i < p.step() ? 1 : i > p.step() ? 0 : p.progress()) },
              on: { click: () => this.goto(this.chapter.peek(), i) },
            },
            el("i"),
          ),
        ),
      );
    });
    const label = el("span.ps-step-label", () => {
      const p = this.player();
      return `step ${p.step() + 1}/${p.count}${p.speed() < 1 ? " · slow-mo" : ""}`;
    });

    const capText = el("span.ps-caption-text", {
      html: () => {
        const src = this.caption();
        if (this.typed() >= 1) return renderRise(src, this.rise());
        const n = Math.round(visibleLength(src) * this.typed());
        return `${render(src, n)}${this.typed() < 1 && this.player().playing() ? '<span class="ps-cursor" aria-hidden="true"></span>' : ""}`;
      },
    });
    const caption = el("div.ps-caption", { class: () => (this.typed() < 1 ? "typing" : ""), attrs: { "aria-live": "polite" } }, capText);

    return el(
      "div.ps-deck",
      {
        // Machine-readable state for tests and automation.
        attrs: {
          tabindex: 0,
          "data-state": () => (this.player().error() ? "error" : this.player().playing() ? "playing" : "paused"),
          "data-error": () => this.player().error()?.message ?? null,
          "data-chapter": () => this.chapter(),
          "data-step": () => this.player().step(),
          "data-index": () => this.position().index,
          "data-total": () => this.position().total,
          // "optional" | "required" while an unanswered question is on screen.
          "data-asking": () => {
            this.player().step();
            const q = pendingAsk();
            return q ? (q.required ? "required" : "optional") : null;
          },
        },
      },
      el(
        "header.ps-top",
        el(
          "div",
          o.path && el("div.ps-path", o.path),
          el("h1.ps-title", () => this.chapters[this.chapter()].title),
        ),
        el("div.ps-nav", prev, count, next),
      ),
      o.tabs !== false && tabs,
      o.meter !== false && el("div.ps-meter", cells, label,
        // The deck's own chrome uses the same choice() control authors use.
        o.depth !== false && (() => this.usesDepth() ? el("div.ps-depth", depthChoice) : null),
        btn("↻ replay", "replay step (r)", () => this.replay(), ".ps-ghost")),
      (o.caption ?? "top") === "top" && caption,
      stage,
      o.caption === "bottom" && caption,
      o.footer !== false && el(
        "footer.ps-foot",
        el(
          "span.ps-keys",
          () => [
            ["←/→", "step"],
            ["r", "replay"],
            ["s", "slow-mo"],
            ...(this.usesAsk() ? [["1–9", "answer"]] : []),
          ].map(([k, what]) => el("span", el("span.ps-kbd", k), ` ${what}`)),
        ),
        el("span", o.footer ?? "built with puppet-show"),
      ),
    );
  }

  private seenChapter(i: number): boolean {
    const before = this.players.slice(0, i + 1).reduce((n, p) => n + p.count, 0);
    return this.seen() >= before - 1;
  }

  private listen(): void {
    addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const k = e.key;
      const typing = e.target instanceof Element && !!e.target.closest("input, textarea, select, [contenteditable]");
      const q = typing ? null : untrack(pendingAsk);
      if (q && /^[1-9]$/.test(k)) {
        q.pick(Number(k) - 1);
        e.preventDefault();
        return;
      }
      // Arrow/space/enter on a question option still navigate; other controls keep their keys.
      const inAsk = e.target instanceof Element && !!e.target.closest(".ps-ask-options");
      if (inAsk && (k === " " || k === "Enter")) return; // native activation picks the option
      if (interactive(e.target) && !inAsk && !(e.target as Element).closest(".ps-nav, .ps-meter, .ps-chapters")) return;
      if (k === "ArrowRight" || k === " " || k === "PageDown" || k === "Enter") {
        this.next();
        this.nudgedSig(this.nudged);
      }
      else if (k === "ArrowLeft" || k === "PageUp") this.prev();
      else if (k === "r") this.replay();
      else if (k === "s") {
        const p = this.player.peek();
        const slow = p.speed.peek() < 1;
        for (const q of this.players) q.speed(slow ? 1 : 0.25);
      } else if (k === "Home") this.goto(0);
      else return;
      e.preventDefault();
    });
  }
}

/** Keys typed into controls belong to the control, not to deck navigation. */
function interactive(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  return !!t.closest("input, select, textarea, button, a[href], [contenteditable], [role=slider], [role=radio], [role=tab]");
}

export const deck = (host: HTMLElement, options: DeckOptions): Deck => new Deck(host, options);

/** The deck whose scene is running. */
export function useDeck(): Deck {
  if (!currentDeck) throw new Error("puppet-show: no active deck");
  return currentDeck;
}

/**
 * Set `caption` while `steps` run in order,
 * starting a moment after the caption, and finish when both are done.
 */
export function* narrate(caption: string, ...steps: Step[]): Task {
  yield* all(say(caption), chain(waitFor(0.25), ...steps));
}

/**
 * Set a caption instantly, or opt into typing. The legacy numeric duration
 * overload always types. Fork with `yield say(...)` to animate alongside.
 */
export function say(text: string, options?: SayOptions): Task;
export function say(text: string, duration: number): Task;
export function* say(text: string, options: SayOptions | number = {}): Task {
  const d = useDeck();
  const opts = typeof options === "number" ? { typed: true, duration: options } : options;
  const motion: CaptionMotion = d.captionMotion === "none" ? "none" : opts.motion ?? (opts.typed ? "type" : opts.typed === false ? "none" : d.captionMotion);
  d.caption(text);
  d.typed(1);
  d.rise(1);
  if (motion === "none") return;
  if (motion === "rise") {
    const words = plain(text).split(/\s+/).filter(Boolean).length;
    d.rise(0);
    yield* tween(opts.duration ?? Math.min(0.45, 0.2 + words * 0.012), (t) => d.rise(t));
    return;
  }
  d.typed(0);
  const n = visibleLength(text);
  yield* tween(opts.duration ?? Math.min(1.6, 0.15 + n * 0.014), (t) => d.typed(t));
}
