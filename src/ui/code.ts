/**
 * Code panel with a tiny TypeScript highlighter and animatable line focus.
 *
 *   const src = code(`function* scene() { ... }`);
 *   yield* src.focus(5);          // dim everything but line 5
 *   yield* src.focus([2, 4], 8);  // lines 2-4 and 8
 *   yield* src.focus();           // everything, no marker
 */

import { all } from "../core/flow.ts";
import { emphasis } from "./tokens.ts";
import type { Task } from "../core/thread.ts";
import { el, Node } from "../dom/node.ts";

const KEYWORDS = new Set(
  "export function const let var yield return import from new if else for while of in class extends true false null undefined this async await type interface".split(
    " ",
  ),
);

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const span = (cls: string, s: string) => `<span class="t-${cls}">${esc(s)}</span>`;

/** Highlight one line of TypeScript-ish source to HTML. */
export function highlight(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpMatchArray | null;
    if (rest.startsWith("//")) {
      out += span("com", rest);
      break;
    } else if ((m = rest.match(/^("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)/))) {
      out += span("str", m[0]);
    } else if ((m = rest.match(/^\d+(?:\.\d+)?/)) && !/[\w$]/.test(line[i - 1] ?? "")) {
      out += span("num", m[0]);
    } else if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) {
      const word = m[0];
      const after = line.slice(i + word.length);
      const kind = KEYWORDS.has(word)
        ? "kw"
        : /^\s*\(/.test(after)
          ? "fn"
          : line[i - 1] === "."
            ? "prop"
            : "";
      out += kind ? span(kind, word) : esc(word);
    } else if ((m = rest.match(/^[{}()[\];,.*=<>+\-/:?!&|]+/))) {
      out += span("pun", m[0]);
    } else {
      m = [rest[0]] as unknown as RegExpMatchArray;
      out += esc(rest[0]);
    }
    i += m[0].length;
  }
  return out || " ";
}

/** Highlight a shell line: `$` prompts, `# comments`, flags, strings. */
export function highlightShell(line: string): string {
  const m = line.match(/^(\s*)([$>#])(\s.*|$)/);
  if (m && m[2] === "#") return esc(m[1]) + span("com", line.trimStart());
  const body = m ? m[3] : line;
  const lead = m ? esc(m[1]) + span("kw", m[2]) : "";
  if (!m) return esc(line) || " ";
  const parts = body.split(/(\s+#.*$|"[^"]*"|'[^']*'|\s--?[\w-]+)/);
  return (
    lead +
    parts
      .map((p) =>
        /^\s+#/.test(p) ? span("com", p) : /^["']/.test(p) ? span("str", p) : /^\s--?[\w-]+$/.test(p) ? span("prop", p) : esc(p),
      )
      .join("")
  );
}

/** Highlight a unified-diff line. */
export function highlightDiff(line: string): string {
  if (line.startsWith("@@")) return span("num", line);
  if (line.startsWith("+")) return span("str", line);
  if (line.startsWith("-")) return span("kw", line);
  return esc(line) || " ";
}

export type Lang = "ts" | "shell" | "diff" | "text";

const HIGHLIGHT: Record<Lang, (line: string) => string> = {
  ts: highlight,
  shell: highlightShell,
  diff: highlightDiff,
  text: (l) => esc(l) || " ",
};

export interface CodeOptions {
  /** Default "ts". */
  lang?: Lang;
}

export type LineSel = number | [from: number, to: number];

export class Code extends Node<HTMLPreElement> {
  readonly lines: Node[];

  constructor(source: string, options: CodeOptions = {}) {
    super(document.createElement("pre"));
    this.el.className = `ps-code ps-lang-${options.lang ?? "ts"}`;
    const text = dedent(source);
    const hl = HIGHLIGHT[options.lang ?? "ts"];
    this.lines = text.split("\n").map((l) => el("div.ps-code-line", el("span", { html: hl(l) })));
    this.add(this.lines);
  }

  /** Focus lines (1-based). No arguments focuses everything without a marker. */
  *focus(...sel: LineSel[]): Task {
    yield* this.focusFor(0.3, ...sel);
  }

  *focusFor(duration: number, ...sel: LineSel[]): Task {
    const on = new Set<number>();
    for (const s of sel) {
      const [a, b] = typeof s === "number" ? [s, s] : s;
      for (let n = a; n <= b; n++) on.add(n);
    }
    const none = on.size === 0;
    this.lines.forEach((l, i) => l.flag("on")(on.has(i + 1)));
    yield* all(...this.lines.map((l, i) => l.opacity(none || on.has(i + 1) ? 1 : emphasis.dim, duration)));
  }
}

/**
 * A code panel body. Keep lines short: at a 720 px viewport a half-width
 * panel fits about 34 characters after the line-number gutter.
 */
export const code = (source: string, options?: CodeOptions): Code => new Code(source, options);

/** Strip common indentation and surrounding blank lines. */
export function dedent(s: string): string {
  const lines = s.replace(/^\s*\n|\n\s*$/g, "").split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(indent)).join("\n");
}
