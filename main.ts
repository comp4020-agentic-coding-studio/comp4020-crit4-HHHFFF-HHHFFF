// Wiring: pads on screen, whatever input is at hand, one Synth. Everything
// that makes a sound lives in src/synth.ts; everything that decides which
// sound lives in src/scale.ts. This file only translates gestures into pad ids.

import { COLUMNS, PADS, padForKey } from "./src/scale.ts";
import { Synth } from "./src/synth.ts";

declare global {
  interface Window {
    /** Test seam. Headless Chrome barely runs rAF and JSDOM has no Web Audio,
     *  so checks drive the same Synth and the same DOM the player does —
     *  never a second copy of it. */
    harness: {
      press(id: number, velocity?: number): void;
      release(id: number): void;
      releaseAll(): void;
      setTone(value: number): void;
      setRoom(value: number): void;
      held(): number[];
      lit(): number[];
      running(): boolean;
    };
  }
}

const synth = new Synth();

const grid = document.querySelector<HTMLElement>("#grid");
const tone = document.querySelector<HTMLInputElement>("#tone");
const room = document.querySelector<HTMLInputElement>("#room");

if (!grid) throw new Error("#grid is missing — the instrument has nowhere to go");

// --- the pads ---------------------------------------------------------------

/** Highest row first, so the pads climb the screen the way pitch does. */
const rows = [...new Set(PADS.map((pad) => pad.octave))].sort((a, b) => b - a);

const padElements = new Map<number, HTMLButtonElement>();

for (const [rowIndex, octave] of rows.entries()) {
  const row = document.createElement("div");
  row.className = "row";
  for (const pad of PADS.filter((candidate) => candidate.octave === octave)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pad";
    button.dataset.pad = String(pad.id);
    button.style.setProperty("--column", String(pad.column));
    button.style.setProperty("--octave", String(pad.octave));
    // Position in the top-left-to-bottom-right raster order, so the idle
    // invite animation (styles.css) can sweep the grid like a reading order
    // rather than every pad breathing in place at once.
    button.style.setProperty("--order", String(rowIndex * COLUMNS + pad.column));
    // The note name is the label a screen reader reads; the key cap is the
    // hint a sighted player reads. Neither is instruction — both are just
    // there when you look.
    button.setAttribute("aria-label", pad.name);
    button.innerHTML = `<span class="pad__key" aria-hidden="true">${pad.key.toUpperCase()}</span>`;
    row.append(button);
    padElements.set(pad.id, button);
  }
  grid.append(row);
}

// --- lighting and holding ---------------------------------------------------

const litPads = new Set<number>();

function pressPad(id: number, velocity: number): void {
  synth.press(id, velocity);
  const element = padElements.get(id);
  if (element) {
    element.style.setProperty("--velocity", velocity.toFixed(3));
    element.classList.add("is-lit");
  }
  litPads.add(id);
}

function releasePad(id: number): void {
  synth.release(id);
  padElements.get(id)?.classList.remove("is-lit");
  litPads.delete(id);
}

function releaseEverything(): void {
  for (const id of [...litPads]) releasePad(id);
  synth.releaseAll();
  pointerPads.clear();
  heldKeys.clear();
}

// --- pointer: mouse, pen, and however many fingers ---------------------------

/** Which pad each active pointer is currently sounding — null while a pointer
 *  is down but off the grid, so sliding back on picks up again. */
const pointerPads = new Map<number, number | null>();

function padUnder(x: number, y: number): HTMLButtonElement | null {
  const element = document.elementFromPoint(x, y);
  return element instanceof Element ? element.closest<HTMLButtonElement>(".pad") : null;
}

/**
 * Softer towards the edges, full in the middle. Free expression: the same pad
 * answers differently depending on where it's struck, which is most of what
 * makes two players sound different.
 */
function velocityAt(pad: HTMLElement, x: number, y: number): number {
  const box = pad.getBoundingClientRect();
  const dx = (x - (box.left + box.width / 2)) / (box.width / 2 || 1);
  const dy = (y - (box.top + box.height / 2)) / (box.height / 2 || 1);
  return 1 - 0.5 * Math.min(1, Math.hypot(dx, dy));
}

function pointerTo(pointerId: number, pad: HTMLButtonElement | null, x: number, y: number): void {
  const previous = pointerPads.get(pointerId);
  const next = pad ? Number(pad.dataset.pad) : null;
  if (previous === next) return;
  if (typeof previous === "number") releasePad(previous);
  pointerPads.set(pointerId, next);
  if (pad && next !== null) pressPad(next, velocityAt(pad, x, y));
}

grid.addEventListener("pointerdown", (event: PointerEvent) => {
  const pad = padUnder(event.clientX, event.clientY);
  if (!pad) return;
  // Stops the touch turning into a scroll, and stops the browser deciding
  // this was a text selection halfway through a glissando.
  event.preventDefault();
  pad.setPointerCapture(event.pointerId);
  pointerTo(event.pointerId, pad, event.clientX, event.clientY);
});

grid.addEventListener("pointermove", (event: PointerEvent) => {
  if (!pointerPads.has(event.pointerId)) return;
  // With the pointer captured, every move still targets the pad it started on,
  // so ask the document what's actually under the finger.
  pointerTo(event.pointerId, padUnder(event.clientX, event.clientY), event.clientX, event.clientY);
});

function liftPointer(event: PointerEvent): void {
  const pad = pointerPads.get(event.pointerId);
  if (pad === undefined) return;
  if (typeof pad === "number") releasePad(pad);
  pointerPads.delete(event.pointerId);
}

grid.addEventListener("pointerup", liftPointer);
grid.addEventListener("pointercancel", liftPointer);

// --- keyboard ---------------------------------------------------------------

const heldKeys = new Set<string>();

document.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  // The sliders own their own arrow keys; don't play notes over them.
  if (event.target instanceof HTMLInputElement) return;

  const pad = padForKey(event.key);
  if (pad) {
    event.preventDefault();
    if (heldKeys.has(pad.key)) return;
    heldKeys.add(pad.key);
    pressPad(pad.id, 0.85);
    return;
  }

  // A pad reached by Tab plays with Space or Enter, which is the difference
  // between "has native controls" and "is actually operable by keyboard".
  if (event.key !== " " && event.key !== "Enter") return;
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !focused.classList.contains("pad")) return;
  event.preventDefault();
  pressPad(Number(focused.dataset.pad), 0.85);
});

document.addEventListener("keyup", (event: KeyboardEvent) => {
  const pad = padForKey(event.key);
  if (pad) {
    heldKeys.delete(pad.key);
    releasePad(pad.id);
    return;
  }
  if (event.key !== " " && event.key !== "Enter") return;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.classList.contains("pad")) {
    releasePad(Number(focused.dataset.pad));
  }
});

// Tabbing away or switching apps mid-chord shouldn't leave it ringing forever.
window.addEventListener("blur", releaseEverything);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseEverything();
});

// --- the two shaping controls -----------------------------------------------

tone?.addEventListener("input", () => synth.setTone(Number(tone.value) / 100));
room?.addEventListener("input", () => synth.setRoom(Number(room.value) / 100));

if (tone) synth.setTone(Number(tone.value) / 100);
if (room) synth.setRoom(Number(room.value) / 100);

// --- the seam ---------------------------------------------------------------

window.harness = {
  press: (id, velocity = 0.85) => pressPad(id, velocity),
  release: releasePad,
  releaseAll: releaseEverything,
  setTone: (value) => synth.setTone(value),
  setRoom: (value) => synth.setRoom(value),
  held: () => synth.held,
  lit: () => [...litPads].sort((a, b) => a - b),
  running: () => synth.running,
};
