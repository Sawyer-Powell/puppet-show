import { deck } from "../../src/index.ts";
import "./style.css";
import { value } from "./scenes/01-value.ts";
import { script } from "./scenes/02-script.ts";
import { player } from "./scenes/03-player.ts";
import { back } from "./scenes/04-back.ts";

deck(document.body, {
  path: "puppet-show://explained",
  chapters: [
    { title: "a value on screen", scene: value },
    { title: "a scene is a script", scene: script },
    { title: "who runs it", scene: player },
    { title: "going back", scene: back },
  ],
});
