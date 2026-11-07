import { Node } from "./node.ts";

/** Validate before layout shortcuts so analysis and playback reject the same input. */
export function validateNode(helper: string, argument: string, value: unknown): asserts value is Node {
  if (value instanceof Node) return;
  const actual = value === undefined ? "undefined" : value === null ? "null" : "not a puppet-show Node";
  const name = helper.split("(")[0];
  const thunk = name === "connect" ? "() => { connect(...); }" : `() => ${name}(...)`;
  throw new Error(`puppet-show: ${helper}: \`${argument}\` is ${actual}. If it's created by an earlier step of the same narrate(), pass a thunk: ${thunk}`);
}
