// Browser integration: node test/blocks.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chrome } from "../scripts/verify-browser.mjs";
const server = await createServer({ configFile: false, root: process.cwd(), server: { port: 0 },
  plugins: [{ name: "blocks-fixture", configureServer(server) {
    server.middlewares.use("/blocks-fixture", (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><html><body></body></html>"); });
  } }],
});
await server.listen();
const browser = await chrome();
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(new URL("blocks-fixture", server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { ask, signal, flush, Player, View, setView, el, note, label, spotlight, dim, region, stages, minimap, term, glossary, Root, Runtime, waitFor } = await import("/src/index.ts");
    document.body.innerHTML = '<div class="ps-deck"><div id="stage"></div></div>';
    const view = new View(document.querySelector("#stage"));
    setView(view);
    const check = (value, message) => { if (!value) throw new Error(message); };
    const run = task => { const runtime = new Runtime(task); for (let i = 0; i < 600; i++) { runtime.advance(1 / 60); flush(); if (runtime.root.done) return; } throw new Error("task did not finish"); };
    const answer = signal(null);
    let question;
    const player = new Player(function* () {
      view.clear(); setView(view);
      question = ask({ prompt: "Choose", answer, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], explain: value => `Selected ${value}` });
      view.add(question);
      yield* question.wait();
      yield* waitFor(0.1);
    }, { requestFrame: () => {} });
    player.seek(0);
    check(answer() === null && !question.answered() && !question.el.textContent.includes("Selected"), "unanswered seek does not reveal");
    question.el.querySelectorAll('[role="radio"]')[1].click(); flush();
    check(answer() === "b" && question.el.textContent.includes("Selected b"), "answer controls optional explanation");
    player.seek(0); flush();
    check(question.el.querySelector('[aria-checked="true"]').textContent === "B", "answer survives reconstruction");
    player.dispose();
    const textAnswer = signal(null);
    const input = ask({ prompt: "Text", answer: textAnswer, input: { placeholder: "answer" } });
    view.add(input);
    input.el.querySelector("input").value = "draft";
    input.el.querySelector("form").requestSubmit(); flush();
    check(textAnswer() === "draft", "free-text answer submits");
    textAnswer("external"); flush();
    check(input.el.querySelector("input").value === "external", "free-text control follows answer signal");
    const root = new Root();
    root.run(() => {
      view.clear();
      const areas = stages(2);
      const target = el("div", { style: { height: 40 } }, "target");
      const other = el("div", "other");
      areas.at(0).add(target); areas.at(1).add(other); view.add(areas);
      const annotation = note(target, "anchored"); label(other, "tag");
      flush();
      const before = parseFloat(annotation.el.style.top);
      target.y(25); flush();
      check(Math.abs(parseFloat(annotation.el.style.top) - before - 25) < 1, "note follows motion");
      const focus = spotlight(target); run(focus);
      check(areas.at(1).el.style.filter.includes("0.2") && !areas.at(0).el.style.filter, "spotlight respects ancestor branches");
      run(focus.restore()); check(!areas.at(1).el.style.filter, "spotlight restores filter");
      target.opacity(0.7); const fade = dim(target); run(fade); check(Math.abs(target.opacity() - 0.14) < 0.001, "dim composes opacity");
      run(fade.restore()); check(target.opacity() === 0.7, "dim restores opacity");
      const area = region("temporary"); area.fill(el("span", "value")); view.add(area); run(area.retire());
      check(area.collapsed() && area.el.hidden, "retirement collapses");
      area.fill("again"); flush(); check(!area.el.hidden && area.opacity() === 1, "fill restores region");
      const active = signal("a"), map = minimap([{ id: "a", label: "A" }, { id: "b", label: "B" }], active); view.add(map);
      active("b"); flush(); check(map.el.querySelector('[aria-current="location"]').textContent === "B", "minimap active signal");
      const list = glossary(); view.add(list); view.add(term("atom", "unit")); flush();
      check(list.el.textContent.includes("atom") && list.el.textContent.includes("unit"), "glossary sees later terms");
    });
    root.dispose();
    const nextRoot = new Root();
    nextRoot.run(() => check(glossary().el.textContent === "", "glossary is run-local"));
    nextRoot.dispose();
    const { ghost, delta, history, trail, all, hold, release } = await import("/src/index.ts");
    function temporalSnapshot(held) {
      view.clear();
      const scope = new Root();
      let frozen, path, samples, change;
      const runtime = scope.run(() => new Runtime((function* () {
        const value = signal(1);
        const source = el("div#original", "before");
        view.add(source);
        frozen = ghost(source); path = trail(source); samples = history(value); change = delta(value);
        view.add(path, samples, change);
        yield* path.capture(); yield* samples.capture();
        yield* all(source.x(60, 0.5), source.text("after", 0.5), value(7, 0.5));
        yield* change.capture(); yield* path.capture(); yield* samples.capture();
      })()));
      if (held) hold();
      try { for (let i = 0; i < 120; i++) { runtime.advance(1 / 60); if (!held) flush(); if (runtime.root.done) break; } }
      finally { if (held) release(); }
      flush();
      check(frozen.el.textContent === "before" && !frozen.el.querySelector("[id]"), "ghost freezes text without duplicate ids");
      check(frozen.opacity() === 0.25 && frozen.el.hasAttribute("inert"), "ghost inert faded state");
      check(path.points.length === 2 && path.points[1].x === 60, "trail checkpoints");
      check(samples.values.join(",") === "1,7" && change.el.textContent === "1 → 7", "history and delta checkpoints");
      const snapshot = view.content.el.innerHTML;
      frozen.clear(); path.clear(); samples.clear(); change.clear();
      check(!frozen.el.textContent && !path.points.length && !samples.values.length && change.el.textContent === "7", "temporal clear");
      scope.dispose();
      return snapshot;
    }
    check(temporalSnapshot(false) === temporalSnapshot(true), "temporal DOM matches with held effects");
    return true;
  });
  assert.equal(result, true);
  await page.goto(new URL("blocks-fixture", server.resolvedUrls.local[0]).href);
  await page.evaluate(async () => {
    const { deck, depth, say, waitFor, beat, Runtime, flush } = await import("/src/index.ts");
    const check = (value, message) => { if (!value) throw new Error(message); };
    const host = () => { const node = document.createElement("div"); document.body.append(node); return node; };
    function* plain() { yield* waitFor(0.1); }
    const minimal = deck(host(), { chapters: [{ title: "plain", scene: plain }], caption: "none", tabs: false, meter: false, footer: false });
    check(!minimal.root.el.querySelector(".ps-caption, .ps-chapters, .ps-meter, .ps-foot, .ps-depth"), "omittable chrome and unused depth");
    const stablePlayer = minimal.players[0];
    const bottom = deck(host(), { chapters: [{ title: "bottom", scene: plain }], caption: "bottom", captionTyped: true });
    const caption = bottom.root.el.querySelector(".ps-caption"), stage = bottom.root.el.querySelector(".ps-stage");
    check(!!(stage.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING), "bottom caption position");
    new Runtime(say("instant", { typed: false })).advance(0);
    check(bottom.caption() === "instant" && bottom.typed() === 1, "per-call instant overrides deck typing");
    const typed = new Runtime(say("typed", { duration: 0.5 })); typed.advance(0);
    check(bottom.typed() === 0, "deck opt-in typing"); typed.advance(0.5); check(bottom.typed() === 1, "typing completes");
    const instant = deck(host(), { chapters: [{ title: "instant", scene: plain }] });
    const task = new Runtime(say("default instant")); task.advance(0);
    check(task.root.done && instant.typed() === 1, "instant default consumes no time");
    const legacy = new Runtime(say("legacy", 0.5)); legacy.advance(0); check(instant.typed() === 0, "legacy numeric overload types"); legacy.advance(0.5);
    function* adaptive() {
      const level = depth();
      yield* waitFor(0.1); yield* beat("base");
      if (level === "deep") { yield* waitFor(0.1); yield* beat("extra"); }
      yield* waitFor(0.1);
    }
    const adaptiveDeck = deck(host(), { chapters: [{ title: "one", scene: adaptive }, { title: "two", scene: adaptive }] }); flush();
    check(adaptiveDeck.root.el.querySelectorAll(".ps-depth button").length === 3 && adaptiveDeck.position().total === 4, "depth detection and initial counts");
    depth("deep"); flush();
    check(adaptiveDeck.players.every(player => player.count === 3) && adaptiveDeck.root.el.dataset.total === "6", "depth reanalyzes all chapters and total");
    adaptiveDeck.player.peek().seek(2);
    depth("intro"); flush();
    check(adaptiveDeck.player.peek().step() === 1 && adaptiveDeck.position().total === 4, "depth clamps step");
    check(minimal.players[0] === stablePlayer, "unused-depth decks are not rebuilt");
    const suppressed = deck(host(), { chapters: [{ title: "adaptive", scene: adaptive }], depth: false }); flush();
    check(!suppressed.root.el.querySelector(".ps-depth"), "depth control can be suppressed");
    for (const shell of [minimal, bottom, instant, adaptiveDeck, suppressed]) for (const player of shell.players) player.dispose();
  });
  assert.deepEqual(errors, []);
  console.log("PASS blocks/deck browser integration");
} finally { await browser.close(); await server.close(); }
