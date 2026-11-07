import { el, flush, Root, palette } from "../../index.ts";
import { render as markup } from "../../ui/markup.ts";
import type { DebugSession, Stop, StopIndex, ToHost, ToView } from "../schema.ts";
import { changes } from "./changes.ts";
import { createDeclaredView } from "./declared.ts";
import "./style.css";
export interface DebuggerTransport {
  post(message: ToHost): void;
  onMessage(callback: (message: ToView) => void): void | (() => void);
}
export interface DebuggerMount { dispose(): void }
const MAX = 10000;

/** State-only protocol consumer: bounded compact history, one full stop, no debug actions. */
export function mountDebugger(host: HTMLElement, transport: DebuggerTransport): DebuggerMount {
  const scope = new Root();
  let viewScope = new Root();
  let disposed = false, following = true, revision = 0;
  let session: DebugSession = { id: "", name: "Waiting for state", views: [], breakpoints: [] };
  let state: "running" | "paused" | "exited" = "running";
  let head: number | null = null, total = 0, cursor = -1;
  let current: Stop | null = null, previous: Stop | null = null;
  let notes: Record<string, string> = {};
  const noteAt = (key: string) => Object.hasOwn(notes, key) ? notes[key] : undefined;
  let lanes: { id: string | null; label: string }[] = [{ id: null, label: "stops" }];
  const index: StopIndex[] = [];
  const positions = new Map<number, number>();
  const previousBp = new Map<number, number>(), nextBp = new Map<number, number>(), lastBp = new Map<string | null, number>();
  const series = new Map<string, (number | null)[][]>();
  let views: ReturnType<typeof createDeclaredView>[] = [];
  const title = scope.run(() => el("strong.x-state-title", session.name));
  const status = scope.run(() => el("span.x-state-status.ps-live", "● recording"));
  const count = scope.run(() => el("span.x-state-count", "0 / 0"));
  const breakpoint = scope.run(() => el("span.x-state-bp", "·"));
  const labels = scope.run(() => el("div.x-state-lanes"));
  const density = scope.run(() => el("canvas.x-state-density", { attrs: { "aria-hidden": "true" } }));
  const overlay = scope.run(() => el("canvas.x-state-cursor", { attrs: { "aria-hidden": "true" } }));
  const scrub = scope.run(() => el("div.x-state-scrub", { attrs: { tabindex: 0, role: "slider", "aria-label": "Recorded stops; arrows step, shift arrows stay at breakpoint, Home End, L live", "aria-valuemin": 0, "aria-valuemax": 0, "aria-valuenow": 0 } }, labels, el("div.x-state-track", density, overlay)));
  const note = scope.run(() => el("div.x-state-note", "Record, then scrub the state."));
  const changed = scope.run(() => el("div.x-state-changed", el("b", "changed "), el("span", "·")));
  const grid = scope.run(() => el("div.x-state-grid"));
  const root = scope.run(() => el("section.x-state-debugger", { attrs: { "aria-label": "Puppet Show state debugger", tabindex: 0 } },
    el("header.x-state-header", title, status, count, breakpoint), scrub, note, changed, grid));
  host.append(root.el);
  const track = density.el.parentElement!;
  let width = 1, height = 44, ratio = 1;
  let nearestSlots: Int32Array[] = [];
  const tones = [palette.blue, palette.purple, palette.aqua, palette.green];
  const bpOf = () => index[positions.get(cursor) ?? -1]?.bp ?? (current?.seq === cursor ? current.agent?.breakpointId : null) ?? null;
  const effectiveHead = () => head ?? index.at(-1)?.seq ?? -1;
  const x = (seq: number) => {
    const slot = positions.get(seq);
    return slot === undefined ? seq > (index.at(-1)?.seq ?? -1) ? width - 1 : 0 : index.length < 2 ? width / 2 : slot / (index.length - 1) * (width - 2) + 1;
  };
  function markers() {
    const ctx = overlay.el.getContext("2d"); if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    if (!index.length) return;
    if (cursor >= 0) { ctx.fillStyle = palette.yellow; ctx.fillRect(Math.round(x(cursor)), 0, 1, height); }
    const hx = x(effectiveHead()); ctx.fillStyle = palette.orange; ctx.beginPath(); ctx.moveTo(hx - 4, 0); ctx.lineTo(hx + 4, 0); ctx.lineTo(hx, 5); ctx.fill();
  }
  function paintDensity() {
    const ctx = density.el.getContext("2d"); if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const bins = lanes.map(() => new Uint32Array(Math.ceil(width)));
    const occupied = lanes.map(() => new Int32Array(Math.ceil(width)).fill(-1));
    const laneIds = new Map(lanes.map((bp, i) => [bp.id, i]));
    for (let i = 0; i < index.length; i++) {
      const lane = laneIds.get(index[i].bp) ?? 0;
      const pixel = Math.max(0, Math.min(Math.ceil(width) - 1, Math.round(index.length < 2 ? width / 2 : i / (index.length - 1) * (width - 2))));
      bins[lane][pixel]++; occupied[lane][pixel] = i;
    }
    // Pixel-sized hit maps keep lane-aware pointer scrubbing O(1), even at 10k.
    const slotX = (slot: number) => index.length < 2 ? width / 2 : slot / (index.length - 1) * (width - 2);
    nearestSlots = occupied.map(slots => {
      const nearest = slots.slice(); let left = -1, right = -1;
      for (let pixel = 0; pixel < slots.length; pixel++) { if (slots[pixel] >= 0) left = slots[pixel]; nearest[pixel] = left; }
      for (let pixel = slots.length - 1; pixel >= 0; pixel--) {
        if (slots[pixel] >= 0) right = slots[pixel];
        if (right >= 0 && (nearest[pixel] < 0 || Math.abs(slotX(right) - pixel) < Math.abs(slotX(nearest[pixel]) - pixel))) nearest[pixel] = right;
      }
      return nearest;
    });
    const laneHeight = (height - 6) / lanes.length;
    for (let lane = 0; lane < lanes.length; lane++) {
      let max = 1; for (const n of bins[lane]) max = Math.max(max, n);
      ctx.fillStyle = tones[lane % tones.length];
      for (let pixel = 0; pixel < bins[lane].length; pixel++) if (bins[lane][pixel]) {
        ctx.globalAlpha = .25 + .75 * Math.log1p(bins[lane][pixel]) / Math.log1p(max);
        ctx.fillRect(pixel, 5 + lane * laneHeight, 1, Math.max(1, laneHeight - 2));
      }
    }
    ctx.globalAlpha = 1; markers();
  }
  function resize() {
    if (disposed) return;
    width = Math.max(1, Math.floor(track.clientWidth)); height = 44; ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    for (const canvas of [density.el, overlay.el]) { canvas.width = width * ratio; canvas.height = height * ratio; }
    paintDensity();
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(track);
  function header() {
    title.el.textContent = session.name; title.el.title = session.name;
    status.el.textContent = state === "running" ? "● recording" : state === "exited" ? "● exited" : following || cursor === head ? "● paused" : "● browsing";
    status.el.className = `x-state-status ${state === "running" ? "ps-live" : state === "exited" ? "ps-dim" : "ps-hot"}`;
    count.el.textContent = `${cursor < 0 ? 0 : cursor + 1} / ${total}`;
    const bp = lanes.find(b => b.id === bpOf());
    breakpoint.el.textContent = bp?.label ?? bpOf() ?? "·"; breakpoint.el.title = bp?.label ?? "";
    scrub.el.setAttribute("aria-valuemin", String(index[0]?.seq ?? 0));
    scrub.el.setAttribute("aria-valuemax", String(index.at(-1)?.seq ?? 0));
    scrub.el.setAttribute("aria-valuenow", String(Math.max(0, cursor)));
    root.el.dataset.pending = String(current?.seq !== cursor);
  }
  function render() {
    const heldFocus = root.el.contains(document.activeElement);
    header(); markers();
    if (!current || current.seq !== cursor) return;
    const bp = current.agent?.breakpointId ?? "";
    const narration = noteAt(`${bp}:${current.seq}`) ?? noteAt(bp) ?? current.agent?.note ?? noteAt("*") ?? current.agent?.notes ?? "No note for this breakpoint.";
    const noteMarkup = markup(narration);
    if (note.el.innerHTML !== noteMarkup) note.el.innerHTML = noteMarkup;
    note.el.title = narration;
    const diff = previous ? changes(previous.data, current.data) : [];
    const text = diff.map(d => d.text).join(" · ") || (previous ? "no state changes" : "first stop at this breakpoint");
    if (changed.el.lastElementChild!.textContent !== text) changed.el.lastElementChild!.textContent = text;
    changed.el.title = text;
    const context = { series, index, cursor, position: positions.get(cursor) ?? Math.max(0, index.length - 1), revision, animate: following, request: (seq: number) => request(seq) };
    for (const view of views) view.update(current, previous, context);
    flush();
    if (heldFocus && document.activeElement === document.body) root.el.focus({ preventScroll: true });
  }
  function request(seq: number) {
    if (!positions.has(seq) || disposed) return;
    const wasFollowing = following; following = false;
    if (seq === cursor && !wasFollowing) return;
    cursor = seq; header(); markers();
    transport.post({ type: "get", seq });
  }
  function live() {
    following = true;
    const seq = effectiveHead(); if (seq >= 0) { cursor = Math.max(cursor, seq); header(); markers(); }
    transport.post({ type: "live" });
  }
  function atPointer(event: PointerEvent) {
    const bounds = overlay.el.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    const lane = Math.max(0, Math.min(lanes.length - 1, Math.floor((event.clientY - bounds.top - 5) / (height - 6) * lanes.length)));
    const pixel = Math.max(0, Math.min(Math.ceil(width) - 1, Math.round(fraction * (width - 1))));
    const slot = nearestSlots[lane]?.[pixel] ?? Math.round(fraction * (index.length - 1));
    const item = index[slot];
    if (item) { overlay.el.title = `${lanes[lane]?.label ?? "stops"} #${item.seq}`; request(item.seq); }
  }
  let dragging = false;
  overlay.el.addEventListener("pointerdown", event => { dragging = true; overlay.el.setPointerCapture(event.pointerId); scrub.el.focus(); atPointer(event); });
  overlay.el.addEventListener("pointermove", event => { if (dragging) atPointer(event); });
  overlay.el.addEventListener("pointerup", event => { dragging = false; if (overlay.el.hasPointerCapture(event.pointerId)) overlay.el.releasePointerCapture(event.pointerId); });
  overlay.el.addEventListener("pointercancel", () => { dragging = false; });
  overlay.el.addEventListener("lostpointercapture", () => { dragging = false; });
  root.el.addEventListener("keydown", event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable]")) return;
    let seq: number | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      seq = event.shiftKey ? (event.key === "ArrowLeft" ? previousBp : nextBp).get(cursor) : index[(positions.get(cursor) ?? 0) + (event.key === "ArrowLeft" ? -1 : 1)]?.seq;
    } else if (event.key === "Home") seq = index[0]?.seq;
    else if (event.key === "End") seq = index.at(-1)?.seq;
    else if (event.key.toLowerCase() === "l") { live(); event.preventDefault(); event.stopPropagation(); return; }
    else return;
    if (seq !== undefined) request(seq); event.preventDefault(); event.stopPropagation();
  });
  function trim(excess: number) {
    if (excess <= 0) return;
    for (const item of index.splice(0, excess)) { positions.delete(item.seq); previousBp.delete(item.seq); nextBp.delete(item.seq); }
    for (let i = 0; i < index.length; i++) positions.set(index[i].seq, i);
    for (const lines of series.values()) for (const line of lines) line.splice(0, excess);
    // Same-breakpoint links may cross the retained window.
    if (index.length) for (const [seq, prev] of previousBp) if (!positions.has(prev)) previousBp.delete(seq);
  }
  function laneLabels() {
    labels.replace(lanes.map((bp, i) => el("span", { attrs: { title: bp.label }, style: { color: tones[i % tones.length] } }, bp.label)));
  }
  function append(items: StopIndex[]) {
    let addedLane = false;
    for (const item of items) {
      if (!session.breakpoints.length && !index.length && item.bp !== null && lanes.length === 1 && lanes[0].id === null) lanes = [];
      if (!lanes.some(lane => lane.id === item.bp)) { lanes.push({ id: item.bp, label: item.bp ?? "stops" }); addedLane = true; }
      const slot = positions.get(item.seq);
      if (slot !== undefined) { index[slot] = item; continue; }
      const prev = lastBp.get(item.bp);
      if (prev !== undefined) { previousBp.set(item.seq, prev); nextBp.set(prev, item.seq); }
      lastBp.set(item.bp, item.seq); positions.set(item.seq, index.length); index.push(item);
    }
    if (addedLane) laneLabels();
    const limit = Math.max(1, session.maxStops ?? MAX);
    if (index.length > limit) trim(index.length - limit);
    revision++; paintDensity();
    if (following && index.length) { cursor = Math.max(cursor, index.at(-1)!.seq); header(); markers(); transport.post({ type: "live" }); }
    else if (index.length && cursor < index[0].seq) request(index[0].seq);
    else render();
    header();
  }
  const receive = (message: ToView) => {
    if (disposed) return;
    scope.run(() => {
      switch (message.type) {
        case "session": {
          for (const view of views) view.dispose(); viewScope.dispose(); viewScope = new Root();
          session = message.session; following = true; cursor = -1; current = previous = null; head = null; total = 0; state = "running";
          index.length = 0; positions.clear(); previousBp.clear(); nextBp.clear(); lastBp.clear(); series.clear(); notes = {}; revision++;
          lanes = session.breakpoints.length ? session.breakpoints.map(bp => ({ id: bp.id, label: bp.label })) : [{ id: null, label: "stops" }];
          laneLabels();
          views = viewScope.run(() => session.views.map(spec => {
            const view = createDeclaredView(spec); view.node.el.classList.add("x-state-view", `x-state-kind-${spec.kind.replace(":", "-")}`); return view;
          }));
          grid.replace(views.map(v => v.node)); note.el.textContent = "Record, then scrub the state."; changed.el.lastElementChild!.textContent = "·";
          resize(); header(); break;
        }
        case "index": append(message.items); break;
        case "series": {
          if (!session.views.some(view => view.id === message.id && view.kind === "series")) break;
          let lines = series.get(message.id); if (!lines) series.set(message.id, lines = []);
          const line = lines[message.line] ??= [];
          for (let i = 0; i < message.values.length; i++) { const slot = positions.get(message.from + i); if (slot !== undefined) line[slot] = message.values[i]; }
          revision++; render(); break;
        }
        case "status": state = message.state; head = message.head; total = Math.max(total, message.total);
          if (message.first !== undefined && index.length && index[0].seq < message.first) {
            let excess = 0; while (excess < index.length && index[excess].seq < message.first) excess++;
            trim(excess); revision++; paintDensity();
            if (positions.has(cursor)) render();
          }
          if (cursor >= 0 && index.length && cursor < index[0].seq) {
            cursor = index[0].seq; transport.post({ type: "get", seq: cursor });
          }
          header(); markers();
          if (following && effectiveHead() > cursor) { cursor = effectiveHead(); header(); markers(); transport.post({ type: "live" }); }
          break;
        case "stop":
          // Live replies can lag the newest compact batch without being stale:
          // accept progress beyond the last *displayed* stop, not just its index.
          if (cursor >= 0 && message.stop.seq !== cursor && !(following && message.stop.seq > (current?.seq ?? -1))) {
            const first = index[0]?.seq;
            if (first === undefined || cursor >= first || message.stop.seq !== first) break;
          }
          current = message.stop; previous = message.prev; cursor = current.seq; total = Math.max(total, cursor + 1); render(); break;
        case "notes": notes = message.notes; render(); break;
      }
      flush();
    });
  };
  const unsubscribe = transport.onMessage(receive);
  resize(); transport.post({ type: "ready" });
  return { dispose() {
    if (disposed) return;
    disposed = true; unsubscribe?.(); resizeObserver.disconnect();
    for (const view of views) view.dispose();
    views = []; current = previous = null; index.length = 0; series.clear(); positions.clear();
    previousBp.clear(); nextBp.clear(); lastBp.clear(); nearestSlots = []; notes = {};
    viewScope.dispose(); scope.dispose(); root.el.replaceChildren(); root.remove();
  } };
}
