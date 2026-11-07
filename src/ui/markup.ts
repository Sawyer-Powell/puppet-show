/**
 * Caption markup: plain text with `code` and *emphasis*. Kept tiny on
 * purpose so captions read like terminal output, and so a caption can be
 * typed out character by character without ever producing broken HTML.
 */

type Run = { text: string; kind: "" | "code" | "em" };

export function parse(src: string): Run[] {
  const runs: Run[] = [];
  const re = /`([^`]+)`|\*([^*]+)\*/g;
  let last = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(src)); ) {
    if (m.index > last) runs.push({ text: src.slice(last, m.index), kind: "" });
    runs.push(m[1] !== undefined ? { text: m[1], kind: "code" } : { text: m[2], kind: "em" });
    last = re.lastIndex;
  }
  if (last < src.length) runs.push({ text: src.slice(last), kind: "" });
  return runs;
}

export const visibleLength = (src: string): number => parse(src).reduce((n, r) => n + r.text.length, 0);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

/** HTML for the first `chars` visible characters of `src`. */
export function render(src: string, chars = Infinity): string {
  let left = chars;
  let out = "";
  for (const r of parse(src)) {
    if (left <= 0) break;
    const t = esc(r.text.slice(0, left));
    left -= r.text.length;
    out += r.kind === "code" ? `<code>${t}</code>` : r.kind === "em" ? `<b>${t}</b>` : t;
  }
  return out;
}

/** Caption markup as plain text, e.g. for accessible names: no `*` or backticks. */
export function plain(src: string): string {
  return parse(src).map((r) => r.text).join("");
}

/**
 * HTML for `src` with each word faded and lifted by reveal progress `p` (0..1),
 * left to right. Words are inline spans moved with `position: relative`, so
 * line breaks are identical at every `p`: the caption never reflows.
 */
export function renderRise(src: string, p: number): string {
  if (p >= 1) return render(src);
  const runs = parse(src).map((r) => ({ ...r, parts: r.text.split(/(\s+)/) }));
  const total = Math.max(1, runs.reduce((n, r) => n + r.parts.filter((w) => w.trim()).length, 0));
  const window = 0.45; // each word's share of the reveal; the rest is stagger
  let i = 0, out = "";
  for (const r of runs) {
    let t = "";
    for (const part of r.parts) {
      if (!part.trim()) { t += esc(part); continue; }
      const local = Math.min(1, Math.max(0, (p - (i++ / total) * (1 - window)) / window));
      const e = 1 - (1 - local) ** 3; // outCubic
      t += `<span class="ps-cap-word" style="opacity:${e.toFixed(3)};top:${(4 * (1 - e)).toFixed(2)}px">${esc(part)}</span>`;
    }
    out += r.kind === "code" ? `<code>${t}</code>` : r.kind === "em" ? `<b>${t}</b>` : t;
  }
  return out;
}
