/** Durable learner input and seek-aware waiting. */
import { isSeeking } from "../core/player.ts";
import { effect, onCleanup, signal, untrack, type Signal } from "../core/signal.ts";
import { waitUntil, type Task } from "../core/thread.ts";
import { all } from "../core/flow.ts";
import { el, type Node } from "../dom/node.ts";
import { render, plain } from "../ui/markup.ts";
import { radioGroup } from "../ui/radio.ts";

export interface AskOptions<T extends string> {
  prompt: string;
  /** Declare this signal outside the scene to retain answers across replay. */
  answer: Signal<T | null>;
  options?: readonly { value: T; label: string; disabled?: boolean }[];
  /** Free-text input; use T = string. Mutually exclusive with options. */
  input?: { placeholder?: string; label?: string };
  /** Optional text shown as soon as an answer is chosen (before any reveal). */
  explain?: (answer: T) => string;
  /**
   * The expected option(s). Only used by `reveal()`; nothing is graded before
   * the scene reveals, so a prediction can be made without hints.
   */
  correct?: T | readonly T[];
  /**
   * Text shown inside the question after `reveal()`, given the learner's
   * answer (null when unanswered). Markup: `code` and *emphasis*.
   */
  feedback?: (answer: T | null) => string;
  /** Small heading above the prompt, e.g. "predict", "check", "your turn". Default "question". */
  kind?: string;
  /**
   * When true, deck navigation cannot pass this question until it is answered
   * (seeking still can). Default false: the first "next" points the learner at
   * the question, a second "next" skips it.
   */
  required?: boolean;
}

export interface Ask<T extends string> extends Node {
  answer: Signal<T | null>;
  answered: () => boolean;
  /** Skips unanswered input during seek, without writing an answer. */
  wait(): Task;
  /** Scroll into view, focus the first control and flash. Used by the deck. */
  attend(): void;
  /** Answer with the n-th option (0-based), if options exist. */
  pick(index: number): void;
  /** Scene state: has the outcome been shown? Reset by replay like any scene state. */
  readonly revealed: Signal<boolean>;
  /**
   * Show the outcome in place: the picked option is marked right or wrong,
   * the expected option is marked, options lock, and `feedback` appears.
   */
  reveal(duration?: number): Task;
  readonly required: boolean;
}

/* --------------------------------------------------------- pending registry */

const registry = new Set<Ask<string>>();
const version = signal(0);

/**
 * The first unanswered question that is on screen, or null. Reactive in the
 * set of mounted questions and their answers; the deck reads it to change its
 * "next" button and to route number keys.
 */
export function pendingAsk(): Ask<string> | null {
  version();
  for (const a of registry) {
    if (a.answered() || a.revealed()) continue;
    const e = a.el;
    if (!e.isConnected || e.getClientRects().length === 0 || e.closest("[style*='visibility: hidden']")) continue;
    return a;
  }
  return null;
}

// Internal structural capability probe, scoped to scene execution by the deck.
let readingAsk: (() => void) | null = null;
export function observeAsks<T>(read: () => void, run: () => T): T {
  const previous = readingAsk;
  readingAsk = read;
  try { return run(); } finally { readingAsk = previous; }
}

/* ---------------------------------------------------------------------- ask */

/** A controlled question. Answer ownership stays with the caller. */
export function ask<T extends string>(options: AskOptions<T>): Ask<T> {
  if (!!options.options === !!options.input) throw new Error("puppet-show: ask needs exactly one of options or input");
  readingAsk?.();
  const { answer } = options;
  const answered = () => answer() !== null;
  const revealed = signal(false);
  const expected = new Set<T>(options.correct === undefined ? [] : ([] as T[]).concat(options.correct as T | T[]));
  const verdict = () => {
    const a = answer();
    if (!revealed() || expected.size === 0) return "";
    if (a === null) return "unanswered";
    return expected.has(a) ? "right" : "wrong";
  };

  const feedbackNode = options.feedback
    ? el("div.ps-feedback", { opacity: 0, html: () => (revealed() ? render(options.feedback!(answer())) : "") })
    : null;
  const controls = options.options
    ? el(
        "div.ps-ask-options",
        { attrs: { role: "radiogroup", "aria-label": plain(options.prompt) } },
        options.options.map((item, i) =>
          el(
            "button.ps-ask-option",
            {
              attrs: { type: "button" },
              class: () =>
                [
                  answer() === item.value ? "ps-picked" : "",
                  revealed() && expected.has(item.value) ? "ps-expected" : "",
                  revealed() && answer() === item.value && expected.size && !expected.has(item.value) ? "ps-wrong" : "",
                ].join(" "),
            },
            el("span.ps-ask-key", { attrs: { "aria-hidden": "true" } }, String(i + 1)),
            el("span", item.label),
            el("span.ps-ask-mark", () => {
              if (!revealed() || !expected.size) return "";
              if (expected.has(item.value)) return answer() === item.value ? "✓ you" : "✓";
              return answer() === item.value ? "✗ you" : "";
            }),
          ),
        ),
      )
    : el(
        "form.ps-ask-form",
        {
          on: {
            submit: (event) => {
              event.preventDefault();
              const field = (event.currentTarget as HTMLFormElement).elements.namedItem("answer") as HTMLInputElement;
              if (field.value.trim()) answer(field.value as T);
            },
          },
        },
        el("input.ps-answer", {
          attrs: {
            name: "answer",
            type: "text",
            "aria-label": options.input?.label ?? plain(options.prompt),
            placeholder: options.input?.placeholder ?? "type your answer, then enter",
          },
        }),
        el("button.ps-btn", { attrs: { type: "submit" } }, "submit"),
      );

  if (options.options) {
    const items = options.options;
    radioGroup({
      group: controls, label: plain(options.prompt),
      buttons: Array.from(controls.el.children).map(element => ({ el: element as HTMLElement })),
      checked: i => answer() === items[i].value,
      select: i => answer(items[i].value),
      disabled: i => items[i].disabled ?? false,
      locked: revealed,
    });
  }

  const status = el("span.ps-ask-status", () => {
    const v = verdict();
    if (v === "right") return "✓ you predicted it";
    if (v === "wrong") return "✗ not quite: see why below";
    if (v === "unanswered") return "answer shown";
    if (revealed()) return "revealed";
    return answered() ? "✓ locked in · next →" : options.options ? `pick 1–${options.options.length}` : "type, then enter";
  });
  const node = el(
    "div.ps-ask",
    {
      class: () => [revealed() ? "ps-revealed" : answered() ? "ps-done" : "ps-waiting", verdict() && `ps-${verdict()}`].join(" "),
      attrs: { role: "group", tabindex: -1, "aria-label": options.kind ?? "question" },
    },
    el("div.ps-ask-head", el("span.ps-ask-kind", `? ${options.kind ?? "question"}`), status),
    el("p.ps-ask-prompt", { html: render(options.prompt) }),
    controls,
    options.explain &&
      el("div.ps-explanation", () => {
        const value = answer();
        return value === null ? "" : options.explain!(value);
      }),
    feedbackNode,
  ) as unknown as Ask<T>;

  if (options.input) {
    const field = controls.el.querySelector("input")!;
    effect(() => {
      field.value = answer() ?? "";
    });
  }

  const nudge = node.flag("ps-nudge");
  Object.assign(node, {
    answer,
    answered,
    revealed,
    *reveal(duration = 0.35): Task {
      revealed(true);
      if (feedbackNode) {
        feedbackNode.y(6);
        yield* all(feedbackNode.opacity(1, duration), feedbackNode.y(0, duration));
      }
    },
    required: options.required ?? false,
    *wait(): Task {
      yield* until(answer, (value) => value !== null);
    },
    pick(index: number) {
      const item = options.options?.[index];
      if (item && !item.disabled && !revealed()) answer(item.value);
    },
    attend() {
      node.el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      // Focus the question itself (not an option, which would look selected); typing fields get focus.
      const field = node.el.querySelector("input") as HTMLInputElement | null;
      (field ?? node.el).focus({ preventScroll: true });
      // Deck chrome feedback, not scene state: restart the flash animation.
      nudge(false);
      void node.el.offsetWidth;
      nudge(true);
    },
  });

  registry.add(node as unknown as Ask<string>);
  untrack(() => version(version.peek() + 1));
  onCleanup(() => {
    registry.delete(node as unknown as Ask<string>);
    version(version.peek() + 1);
  });
  return node;
}

/** Wait for a signal predicate in playback; seeking never waits for input. */
export function until<T>(source: Signal<T>, predicate: (value: T) => boolean): Task;
export function until<T>(source: () => T, predicate: (value: T) => boolean): Task;
export function* until<T>(source: () => T, predicate: (value: T) => boolean): Task {
  yield* waitUntil(() => isSeeking() || predicate(source()));
}
