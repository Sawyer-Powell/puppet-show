/**
 * Recipe: code, shell and diff panels with animated focus.
 * Uses: code(src, { lang }), focus, text retyping.
 */
import { all, beat, code, el, narrate, panel, type Task, type View } from "../../../src/index.ts";

export function* codeScene(view: View): Task {
  const ts = code(`
    const user = await db.find(id);
    if (!user) return notFound();
    return render(user);
  `);
  const sh = code(
    `
    $ git rebase main
    Successfully rebased.
    $ git log --oneline  # newest
  `,
    { lang: "shell" },
  );
  const diff = code(
    `
    @@ -1,3 +1,3 @@
    -const limit = 10;
    +const limit = 50;
     export { limit };
  `,
    { lang: "diff" },
  );
  const status = el("span.ps-chip", "idle");
  view.add(
    el(
      "div.x-stack",
      el("div.ps-grid.ps-cols-2", panel("handler.ts", {}, ts), panel("terminal", {}, sh)),
      el("div.ps-grid.ps-cols-2", panel("patch", {}, diff), panel("status", {}, status)),
    ),
  );

  yield* narrate("`code(src)` highlights TypeScript; `focus(line)` dims the rest.", ts.focus(1));
  yield* beat("ts");

  yield* narrate("`{ lang: \"shell\" }` and `{ lang: \"diff\" }` cover terminals and patches.", all(sh.focus(1, 3), diff.focus([2, 3])));
  yield* beat("langs");

  yield* narrate("Text signals retype: `node.text(\"next\", 0.5)` erases to the common prefix, then types.", status.text("rebasing…", 0.5), status.text("rebased", 0.4));
}
