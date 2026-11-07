/**
 * puppet-show: generator-driven, signal-based animation for interactive DOM
 * explainers. Scenes are generator functions, properties are signals, and
 * beats turn a scene into click-through steps.
 */

import "./ui/puppet-show.css";

export { signal, effect, flush, afterFlush, hold, release, untrack, onCleanup, Root, isSignal, getOwner, runWithOwner } from "./core/signal.ts";
export type { Signal, Source, SignalOptions, TweenTask } from "./core/signal.ts";
export { tween, waitFor, waitUntil, fork, join, useThread, useNow, Runtime, Thread } from "./core/thread.ts";
export type { Task, Status } from "./core/thread.ts";
export { all, any, chain, delay, sequence, loop, beat } from "./core/flow.ts";
export type { Step } from "./core/flow.ts";
export { Player, isSeeking } from "./core/player.ts";
export type { Segment, SeekStats, PlayerOptions } from "./core/player.ts";
export { ease, bezier } from "./core/ease.ts";
export type { Ease } from "./core/ease.ts";
export { lerp, color, retype, interpolatorFor } from "./core/interp.ts";
export type { Interpolator } from "./core/interp.ts";

export { el, wrap, Node } from "./dom/node.ts";
export type { Child, Props, Widen } from "./dom/node.ts";
export { View, useView, setView, fly, move } from "./dom/view.ts";
export { connect, Edge } from "./dom/connect.ts";
export type { ConnectOptions, Side } from "./dom/connect.ts";
export type { FlyOptions } from "./dom/view.ts";

export { deck, say, narrate, useDeck, Deck, depth } from "./ui/deck.ts";
export type { CaptionMotion, Chapter, DeckOptions, Depth, SayOptions } from "./ui/deck.ts";
export { code, Code, highlight, highlightShell, highlightDiff } from "./ui/code.ts";
export type { CodeOptions, Lang, LineSel } from "./ui/code.ts";
export { collection } from "./ui/collection.ts";
export type { Collection, CollectionOptions, CollectionSetOptions } from "./ui/collection.ts";
export { table } from "./ui/table.ts";
export type { Table, TableOptions, TableColumn } from "./ui/table.ts";
export { seqDiagram } from "./ui/sequence.ts";
export type { SeqDiagram, SeqDiagramOptions, MessageOptions } from "./ui/sequence.ts";
export { semantic } from "./ui/palette.ts";
export { emphasis } from "./ui/tokens.ts";
export { panel, box, chip, readout, slider, choice, slots, timeline, Timeline, row, grid, palette } from "./ui/components.ts";
export type { Tone, Hue, SliderOptions, ChoiceOptions, SlotsOptions, Slots, TimelineOptions, BarOptions, Bar } from "./ui/components.ts";

export { ask, until, pendingAsk } from "./blocks/interaction.ts";
export type { Ask, AskOptions } from "./blocks/interaction.ts";
export { note, label, spotlight, dim, highlightNodes, term, glossary } from "./blocks/attention.ts";
export type { NoteOptions, FocusTask, HighlightOptions } from "./blocks/attention.ts";
export { region, stages, compare, minimap } from "./blocks/layout.ts";
export type { Region, Stages, CompareOptions, MapPart, Minimap } from "./blocks/layout.ts";
export { textMotion, countText } from "./blocks/text.ts";
export type { TextMotion, TextMotionOptions, CountTextOptions } from "./blocks/text.ts";
export { ghost, trail, delta, history } from "./blocks/temporal.ts";
export type { Ghost, Trail, Delta, DeltaOptions, History, Point } from "./blocks/temporal.ts";
