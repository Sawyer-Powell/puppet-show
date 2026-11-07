import { effect } from "../core/signal.ts";
import type { Task } from "../core/thread.ts";
import { el, type Child, type Node } from "../dom/node.ts";
import { collection, type CollectionSetOptions } from "./collection.ts";

export interface TableColumn {
  key: string;
  label: Child;
  /** Minimum CSS track breadth; nowrap content may grow the column. */
  width?: string;
  align?: "left" | "center" | "right";
}
export interface TableOptions<T> {
  columns: TableColumn[];
  rows: T[] | (() => T[]);
  key: (row: T) => string;
  cell?: (row: T, column: TableColumn) => Child;
  rowClass?: (row: T) => string;
}
export interface Table<T> extends Node {
  set(rows: T[], options?: number | CollectionSetOptions): Task;
  row(key: string): Node | undefined;
}

/** Compact keyed rows; wide data scrolls inside the wrapper, never the page. */
export function table<T>(options: TableOptions<T>): Table<T> {
  const columns = options.columns;
  if (!columns.length) throw new Error("puppet-show: table needs at least one column");
  const seen = new Set<string>();
  for (const column of columns) {
    if (!column.key || seen.has(column.key)) throw new Error(`puppet-show: invalid or duplicate table column ${JSON.stringify(column.key)}`);
    seen.add(column.key);
  }
  const tracks = columns.map(column => {
    const width = column.width;
    if (!width) return "minmax(max-content, 1fr)";
    // Legacy full track expressions remain valid; cell intrinsic minima and
    // the table's max-content minimum prevent their text from overlapping.
    if (/^(minmax|fit-content)\(/.test(width)) return width;
    if (/fr$/.test(width)) return `minmax(max-content, ${width})`;
    return `minmax(${width}, max-content)`;
  }).join(" ");
  const cellStyle = (column: TableColumn) => ({ textAlign: column.align ?? "left" });
  const body = collection<T>({
    key: options.key,
    gap: "0 var(--ps-space-12)",
    render: (item, key) => {
      const row = el("div.ps-table-row", { attrs: { role: "row", "data-key": key } },
        ...columns.map(column => el("div.ps-table-cell", {
          attrs: { role: "cell" }, style: cellStyle(column),
        }, () => options.cell ? options.cell(item(), column) : (item() as Record<string, Child>)[column.key])),
      );
      if (options.rowClass) {
        let previous = new Set<string>();
        effect(() => {
          const next = new Set(options.rowClass!(item()).split(/\s+/).filter(Boolean));
          for (const name of previous) if (!next.has(name)) row.el.classList.remove(name);
          for (const name of next) row.el.classList.add(name);
          previous = next;
        });
      }
      return row;
    },
  });
  body.el.classList.add("ps-table-body");
  body.el.setAttribute("role", "rowgroup");
  const wrapper = el("div.ps-table-scroll", { attrs: { tabindex: 0, role: "region", "aria-label": "Data table" } },
    el("div.ps-table", { attrs: { role: "table" }, style: { "--ps-table-columns": tracks } },
      el("div.ps-table-head", { attrs: { role: "row" } }, ...columns.map(column =>
        el("div.ps-table-cell", { attrs: { role: "columnheader" }, style: cellStyle(column) }, column.label))),
      body,
    ),
  ) as unknown as Table<T>;
  wrapper.set = (rows, duration = 0.8) => body.set(rows, duration);
  wrapper.row = key => body.node(key);
  const source = options.rows;
  if (typeof source === "function") effect(() => { body.set(source(), 0).next(); });
  else body.set(source, 0).next();
  return wrapper;
}
