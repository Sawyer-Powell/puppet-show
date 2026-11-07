import { deck } from "../../src/index.ts";
import "./style.css";
import { diagram } from "./scenes/01-diagram.ts";
import { inputs } from "./scenes/02-inputs.ts";
import { codeScene } from "./scenes/03-code.ts";
import { collections } from "./scenes/04-collections.ts";
import { sequenceDiagram } from "./scenes/05-sequence.ts";
import { byteWindow } from "./scenes/06-window.ts";
import { blocks } from "./scenes/07-blocks.ts";
import { temporal } from "./scenes/08-temporal.ts";
import { textScene } from "./scenes/09-text.ts";

deck(document.body, {
  path: "puppet-show://gallery",
  footer: "recipes · read the scene sources",
  chapters: [
    { title: "diagrams that move", scene: diagram },
    { title: "live inputs", scene: inputs },
    { title: "code panels", scene: codeScene },
    { title: "keyed data", scene: collections },
    { title: "host messages", scene: sequenceDiagram },
    { title: "byte windows", scene: byteWindow },
    { title: "composable blocks", scene: blocks },
    { title: "temporal checkpoints", scene: temporal },
    { title: "quiet text motion", scene: textScene },
  ],
});
