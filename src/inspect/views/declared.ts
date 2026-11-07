import { all, collection, el, flush, fork, isSeeking, palette, Root, Runtime, table, timeline, useThread } from "../../index.ts";
import type { Node, Table, Task } from "../../index.ts";
import type { PuppetShowSnapshot, Stop, ViewSpec } from "../schema.ts";
import "./declared.css";

export interface DeclaredContext {
  series: Map<string, (number | null)[][]>;
  index: { seq: number; bp: string | null; reason: string }[];
  /** Absolute sequence under the cursor. */
  cursor: number;
  /** O(1) position within the retained compact index. */
  position?: number;
  revision?: number;
  /** Live-follow updates animate structure; historical scrubs snap. */
  animate?: boolean;
  request: (seq: number) => void;
}

/** Select an own-property dotted path. Collector wrappers are explicit (.value). */
export function select(data: unknown, path: string): unknown {
  if (!path) return data;
  let value = data;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  if (value && typeof value === "object" && Object.hasOwn(value, "ok") && typeof (value as { ok: unknown }).ok === "boolean") {
    return (value as { ok: boolean }).ok ? (value as { value?: unknown }).value : undefined;
  }
  return value;
}

const paths = (spec: ViewSpec) => typeof spec.select === "string" ? [spec.select] : spec.select ?? [];
const numeric = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function format(value: unknown): string {
  if (value === undefined || value === null) return "·";
  if (numeric(value)) return String(Number(value.toFixed(3)));
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return "·"; }
  }
  return String(value);
}
const differs = (a: unknown, b: unknown) => format(a) !== format(b);
const tones = [palette.aqua, palette.purple, palette.blue, palette.green];
interface Row { id: string; value: unknown; previous: unknown; depth: number }
interface EventRow { seq: number; label: string; active: boolean; request: (seq: number) => void }

export function createDeclaredView(spec: ViewSpec): {
  node: Node;
  update(stop: Stop, prev: Stop | null, context: DeclaredContext): void;
  dispose(): void;
} {
  const scope = new Root();
  let contentScope = new Root();
  let disposed = false;
  const body = scope.run(() => el("div.x-declared-body"));
  const node = scope.run(() => el("section.x-declared", {
    attrs: { "data-view-id": spec.id, "aria-label": spec.label ?? spec.id },
  }, el("h3.x-declared-title", spec.label ?? spec.id), body));
  function replace(build: () => Node | Node[]) {
    contentScope.dispose();
    contentScope = new Root();
    contentScope.run(() => body.replace(build()));
  }

  let lastSeq = -1;
  let lastDataStop: Stop | null = null, lastDataPrev: Stop | null = null;
  let rowKeys = new Set<string>();
  let cancelRows = () => {};
  function reconcile(next: Row[], lookup: (id: string) => Node | undefined, apply: () => void, animate: boolean) {
    cancelRows();
    const keys = new Set(next.map(row => row.id));
    const ghosts: { node: Node; root: Root }[] = [];
    if (animate) for (const id of rowKeys) if (!keys.has(id)) {
      const old = lookup(id); if (!old) continue;
      const rect = old.el.getBoundingClientRect(), parent = body.el.getBoundingClientRect();
      const cells = [...old.el.querySelectorAll(".ps-table-cell")].map(cell => cell.textContent);
      const ghostRoot = new Root();
      const ghost = ghostRoot.run(() => el("div.x-declared-exit", cells.length ? cells.join(" · ") : old.el.textContent));
      Object.assign(ghost.el.style, { left: `${rect.left - parent.left}px`, top: `${rect.top - parent.top + body.el.scrollTop}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      ghosts.push({ node: ghost, root: ghostRoot });
    }
    const entering = animate ? next.filter(row => !rowKeys.has(row.id)).map(row => row.id) : [];
    apply(); rowKeys = keys;
    if (!animate) return;
    body.add(ghosts.map(ghost => ghost.node));
    const fresh = entering.flatMap(id => { const node = lookup(id); return node ? [node] : []; });
    if (!fresh.length && !ghosts.length) return;
    fresh.forEach(node => node.opacity(0));
    const cleanup = () => { ghosts.forEach(ghost => { ghost.node.remove(); ghost.root.dispose(); }); fresh.forEach(node => node.opacity(1)); };
    function* motion(): Task {
      try { yield* all(...ghosts.map(ghost => ghost.node.opacity(0, .18)), ...fresh.map(node => node.opacity(1, .18))); }
      finally { cleanup(); }
    }
    try {
      useThread(); const thread = fork(motion()); cancelRows = () => { thread.cancel(); cleanup(); };
    } catch {
      const runtime = new Runtime(motion()); let frame = 0, last: number | null = null;
      runtime.advance(0);
      const tick = (ms: number) => {
        if (disposed) return;
        const result = runtime.advance(last === null ? 0 : Math.min(.05, (ms - last) / 1000)); last = ms; flush();
        if (result.status !== "done") frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      cancelRows = () => { cancelAnimationFrame(frame); runtime.root.cancel(); cleanup(); };
    }
  }
  let dataTable: Table<Row> | undefined;
  let tableColumns = "";
  const tree = spec.kind === "tree" ? scope.run(() => collection<Row>({
    key: row => row.id,
    gap: 0,
    render: item => el("div.x-declared-tree-row", {
      attrs: { role: "treeitem", "aria-level": () => item().depth + 1, "data-key": () => item().id },
      style: { paddingLeft: () => `${item().depth * 10}px` },
      class: () => `x-declared-tree-row${differs(item().value, item().previous) ? " ps-hot" : ""}`,
    }, () => {
      const value = item().value;
      const label = select(value, "label") ?? select(value, "name") ?? select(value, spec.key ?? "id");
      return `${format(label ?? item().id)}${spec.columns?.length ? " · " + spec.columns.map(c => `${c}: ${format(select(value, c))}`).join(" · ") : ""}`;
    }),
  })) : undefined;
  if (tree) { body.el.setAttribute("role", "tree"); body.add(tree); }
  const eventRows = spec.kind === "events" ? scope.run(() => collection<EventRow>({
    key: item => String(item.seq), gap: 0,
    render: item => el("button.x-declared-event", {
      attrs: { type: "button", "aria-current": () => item().active ? "step" : "false", title: () => item().label },
      on: { click: () => item().request(item().seq) },
    }, () => item().label),
  })) : undefined;
  if (eventRows) body.add(eventRows);

  const canvas = spec.kind === "series" ? document.createElement("canvas") : null;
  const cached = canvas ? document.createElement("canvas") : null;
  const legend = scope.run(() => el("div.x-declared-legend"));
  if (canvas) {
    canvas.className = "x-declared-series";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", spec.label ?? spec.id);
    body.add(canvas, legend);
  }
  let lastSeries: (number | null)[][] | undefined;
  let lastLines: (number | null)[][] = [];
  let lastLengths: number[] = [];
  let lastTails: (number | null | undefined)[] = [];
  let chartContext: DeclaredContext | undefined;
  let chartDirty = true;
  let chartRevision: number | undefined;
  const emptySeries: (number | null)[][] = [];
  let low = 0;
  let high = 1;
  let historyLength = 1;
  function drawSeries(context: DeclaredContext) {
    if (!canvas || !cached) return;
    const lines = context.series.get(spec.id) ?? emptySeries;
    const position = context.position ?? context.cursor;
    const width = Math.max(1, Math.round(canvas.getBoundingClientRect().width || 320));
    const height = 58;
    const ratio = window.devicePixelRatio || 1;
    const changed = chartDirty || chartRevision !== context.revision || lastSeries !== lines || canvas.width !== Math.round(width * ratio)
      || lines.length !== lastLengths.length || lines.some((line, i) => line !== lastLines[i]
        || line.length !== lastLengths[i] || line.at(-1) !== lastTails[i]);
    if (changed) {
      chartDirty = false;
      chartRevision = context.revision;
      lastSeries = lines;
      lastLines = lines.slice();
      lastLengths = lines.map(line => line.length);
      lastTails = lines.map(line => line.at(-1));
      canvas.width = cached.width = Math.round(width * ratio);
      canvas.height = cached.height = Math.round(height * ratio);
      low = Infinity; high = -Infinity;
      for (const line of lines) for (const value of line) if (numeric(value)) { low = Math.min(low, value); high = Math.max(high, value); }
      if (!Number.isFinite(low)) { low = 0; high = 1; }
      if (low === high) { low -= .5; high += .5; }
      historyLength = Math.max(2, context.index.length, ...lines.map(line => line.length));
      const ctx = cached.getContext("2d");
      if (ctx) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        lines.forEach((line, i) => {
          ctx.beginPath(); ctx.strokeStyle = tones[i % tones.length]!; ctx.lineWidth = 1.4;
          let connected = false;
          line.forEach((value, j) => {
            if (!numeric(value)) { connected = false; return; }
            const x = 2 + j / (historyLength - 1) * (width - 4);
            const y = height - 4 - (value - low) / (high - low) * (height - 8);
            if (connected) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            connected = true;
          });
          ctx.stroke();
        });
      }
    }
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(cached, 0, 0);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const x = 2 + Math.max(0, position) / (historyLength - 1) * (width - 4);
      ctx.strokeStyle = palette.yellow; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      lines.forEach((line, i) => {
        const value = line[position];
        if (!numeric(value)) return;
        ctx.fillStyle = tones[i % tones.length]!;
        ctx.beginPath(); ctx.arc(x, height - 4 - (value - low) / (high - low) * (height - 8), 2.5, 0, Math.PI * 2); ctx.fill();
      });
    }
    const labels = spec.lines ?? paths(spec).map(path => ({ select: path, label: path }));
    legend.el.textContent = labels.map((line, i) => `${line.label ?? line.select} ${format(lines[i]?.[position])}`).join(" · ") || "·";
  }
  const resize = canvas && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
    chartDirty = true;
    if (!disposed && chartContext) drawSeries(chartContext);
  }) : null;
  if (canvas) resize?.observe(canvas);

  let eventIndex: DeclaredContext["index"] | undefined;
  let eventLength = -1;
  let eventRevision: number | undefined;
  let events: DeclaredContext["index"] = [];
  let eventsStart = 0, eventCursor = -1;
  let eventContext: DeclaredContext | undefined;
  const EVENT_HEIGHT = 18, EVENT_WINDOW = 6;
  function eventWindow(start: number, context: DeclaredContext, seq: number, center: boolean) {
    const top = body.el.scrollTop;
    eventsStart = Math.max(0, Math.min(Math.max(0, events.length - EVENT_WINDOW), start));
    eventRows!.el.style.paddingTop = `${eventsStart * EVENT_HEIGHT}px`;
    eventRows!.el.style.paddingBottom = `${Math.max(0, events.length - eventsStart - EVENT_WINDOW) * EVENT_HEIGHT}px`;
    eventRows!.set(events.slice(eventsStart, eventsStart + EVENT_WINDOW).map(event => ({
      seq: event.seq, active: event.seq === seq, request: context.request,
      label: (spec.template ?? "#{seq} · {bp} · {reason}").replace(/\{([^{}]+)\}/g, (_, key: string) => format(select(event, key))),
    })), 0).next();
    body.el.scrollTop = center ? Math.max(0, start * EVENT_HEIGHT) : top;
  }
  if (eventRows) body.el.addEventListener("scroll", () => {
    if (disposed || !eventContext) return;
    const start = Math.floor(body.el.scrollTop / EVENT_HEIGHT);
    if (start !== eventsStart) { eventWindow(start, eventContext, eventCursor, false); flush(); }
  });
  function rows(value: unknown, previous: unknown, nested: boolean): Row[] {
    const result: Row[] = [];
    const seen = new Set<object>();
    function visit(items: unknown, old: unknown, depth: number, parent: string) {
      const list = Array.isArray(items) ? items : items && typeof items === "object" ? [items] : [];
      const oldList = Array.isArray(old) ? old : old && typeof old === "object" ? [old] : [];
      const oldByKey = new Map(oldList.map((v, i) => [format(select(v, spec.key ?? "id") ?? i), v]));
      const keys = new Set<string>();
      for (let i = 0; i < list.length && result.length < 300; i++) {
        const value = list[i];
        if (typeof value === "object" && value !== null) { if (seen.has(value)) continue; seen.add(value); }
        const key = format(select(value, spec.key ?? "id") ?? i);
        // Malformed/duplicate keys must not crash a generic inspector.
        const unique = keys.has(key) ? `${key}@${i}` : key;
        keys.add(key);
        const id = `${parent}/${encodeURIComponent(unique)}`;
        const previous = oldByKey.get(key);
        result.push({ id, value, previous, depth });
        if (nested && depth < 20) visit(select(value, spec.children ?? "children"), select(previous, spec.children ?? "children"), depth + 1, id);
      }
    }
    visit(value, previous, 0, "");
    return result;
  }

  return {
    node,
    update(stop, prev, context) {
      if (disposed) return;
      if (spec.kind !== "series" && spec.kind !== "events") {
        if (stop === lastDataStop && prev === lastDataPrev) return;
        lastDataStop = stop; lastDataPrev = prev;
      }
      const animate = !!context.animate && lastSeq >= 0 && stop.seq > lastSeq && stop.seq - lastSeq < 60 && !isSeeking();
      lastSeq = stop.seq;
      const path = paths(spec)[0] ?? "";
      const value = select(stop.data, path);
      const previous = prev ? select(prev.data, path) : undefined;
      if (spec.kind === "series") { chartContext = context; drawSeries(context); return; }
      if (spec.kind === "value") {
        replace(() => (paths(spec).length ? paths(spec) : Object.keys(stop.data)).map(path => {
          const value = select(stop.data, path);
          const entry = el("div.x-declared-value", el("span.x-declared-key", path), el("strong", format(value)));
          entry.flag("ps-hot")(prev !== null && differs(value, select(prev.data, path)));
          entry.el.title = `${path}: ${format(value)}`;
          return entry;
        }));
      } else if (spec.kind === "table") {
        const next = rows(value, previous, false);
        const columns = [...new Set(spec.columns?.length ? spec.columns : next[0]?.value && typeof next[0].value === "object" ? Object.keys(next[0].value).slice(0, 5) : ["value"])];
        const signature = JSON.stringify(columns);
        if (!dataTable || signature !== tableColumns) {
          tableColumns = signature;
          replace(() => {
            dataTable = table<Row>({ columns: columns.map(key => ({ key, label: el("span", { attrs: { title: key } }, key.split(".").at(-1) ?? key) })), rows: [], key: row => row.id,
              cell: (row, column) => {
                const current = column.key === "value" && typeof row.value !== "object" ? row.value : select(row.value, column.key);
                const cell = el("span", format(current));
                cell.flag("ps-hot")(differs(current, column.key === "value" && typeof row.previous !== "object" ? row.previous : select(row.previous, column.key)));
                cell.el.title = format(current);
                return cell;
              },
            });
            return dataTable;
          });
        }
        reconcile(next, id => dataTable!.row(id), () => { dataTable!.set(next, 0).next(); }, animate);
        body.el.setAttribute("data-empty", String(!next.length));
        body.el.dataset.limit = next.length >= 300 ? "300-item inspection limit" : "";
      } else if (spec.kind === "tree") {
        const next = rows(value, previous, true);
        reconcile(next, id => tree!.node(id), () => { tree!.set(next, 0).next(); }, animate);
        body.el.setAttribute("data-empty", String(!next.length));
        body.el.dataset.limit = next.length >= 300 ? "300-item inspection limit" : "";
      } else if (spec.kind === "events") {
        if (eventIndex !== context.index || eventLength !== context.index.length || eventRevision !== context.revision) {
          eventIndex = context.index; eventLength = context.index.length; eventRevision = context.revision;
          events = spec.breakpoint ? context.index.filter(item => item.bp === spec.breakpoint) : context.index;
        }
        const seq = context.index[context.position ?? context.cursor]?.seq ?? stop.seq;
        let lo = 0, hi = events.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid]!.seq < seq) lo = mid + 1; else hi = mid; }
        const moved = eventCursor !== seq;
        eventContext = context; eventCursor = seq;
        eventWindow(moved ? lo - 2 : eventsStart, context, seq, moved);
        body.el.setAttribute("data-empty", String(!events.length));
      } else if (spec.kind === "puppet-show:threads") {
        const snapshot = (path ? value : select(stop.data, "puppet-show.value")) as PuppetShowSnapshot | undefined;
        replace(() => {
          if (!snapshot || typeof snapshot !== "object" || !snapshot.threads) return el("span.ps-muted", "·");
          const clock = snapshot.deck?.time;
          const threads: { id: number; label: string; time: number; done: boolean }[] = [];
          const visit = (thread: PuppetShowSnapshot["threads"], depth = 0) => {
            if (!thread || depth > 20 || threads.length >= 100) return;
            if (numeric(thread.time)) threads.push(thread);
            if (Array.isArray(thread.children)) thread.children.forEach(child => visit(child, depth + 1));
          };
          visit(snapshot.threads);
          const max = Math.max(.1, numeric(clock) ? clock : 0, ...threads.map(t => t.time));
          const min = Math.min(0, numeric(clock) ? clock : 0, ...threads.map(t => t.time));
          const tl = timeline({ domain: [min, max * 1.08], ticks: [min, max], format: t => `${format(t)}s`, labelWidth: "12em" });
          threads.forEach(thread => {
            const label = `#${thread.id} ${thread.label.replace(/^tween\s+/, "").split(" ")[0]!.slice(0, 4)} ${thread.time.toFixed(3)}`;
            const lane = tl.lane(label, tl.bar(Math.min(0, thread.time), thread.time, { hue: thread.done ? "green" : "aqua" }), tl.dot(thread.time, { hue: "purple" }));
            lane.el.title = `${thread.label}: ${format(thread.time)}s`;
          });
          if (numeric(clock)) tl.marker(clock, "clock", { hue: "yellow" });
          return [el("div.x-declared-legend", `clock ${format(clock)}s · bars: logical thread.time${threads.length >= 100 ? " · 100-thread limit" : ""}`), tl];
        });
      }
      flush();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resize?.disconnect();
      eventContext = chartContext = undefined; events = []; lastLines = []; lastSeries = undefined;
      lastDataStop = lastDataPrev = null;
      cancelRows();
      dataTable?.set([], 0).next(); tree?.set([], 0).next(); eventRows?.set([], 0).next();
      contentScope.dispose();
      scope.dispose();
      body.el.replaceChildren(); node.remove();
    },
  };
}
