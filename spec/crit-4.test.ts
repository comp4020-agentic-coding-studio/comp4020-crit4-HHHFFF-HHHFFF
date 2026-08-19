import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Mechanically-checkable lines from the crit 4 spec (an instrument). Judged
// lines — expressiveness, whether a stranger finds the first sound
// uninstructed, whether the crit's pod calls it an instrument — aren't here;
// see spec/README.md for why.
const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const shipped = files().map((path) => relative(DIST, path).split(sep).join("/"));
const scripts = shipped.filter((name) => name.endsWith(".js"));
const scriptText = scripts.map((name) => readFileSync(join(DIST, name), "utf8")).join("\n");

const pages = shipped
  .filter((name) => name.endsWith(".html"))
  .map((name) => ({
    name,
    doc: new JSDOM(readFileSync(join(DIST, name), "utf8")).window.document,
  }));

describe("sound is made live, not played back", () => {
  const AUDIO_FILE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;

  it("ships no pre-recorded audio files", () => {
    const audioFiles = shipped.filter((name) => AUDIO_FILE.test(name));
    expect(
      audioFiles,
      "a shipped audio file suggests playback rather than live synthesis",
    ).toEqual([]);
  });

  it("has no <audio>/<video> element pointing at a real source", () => {
    for (const { name, doc } of pages) {
      for (const el of doc.querySelectorAll("audio, video")) {
        const src = el.getAttribute("src") ?? el.querySelector("source")?.getAttribute("src");
        expect(src, `${name}: <${el.tagName.toLowerCase()}> should not play back a fixed source`).toBeFalsy();
      }
    }
  });

  it("constructs a Web Audio context somewhere in the built script", () => {
    expect(
      scriptText,
      "no reference to AudioContext found — sound should be synthesized with the Web Audio API",
    ).toMatch(/\bAudioContext\b/);
  });
});

describe("playable with whatever is at hand", () => {
  it("offers at least one native, keyboard-operable control", () => {
    // A native <button>/<input> is keyboard-operable for free; a div with a
    // click handler is not. This doesn't prove the whole page is accessible
    // by keyboard — verify that by actually tabbing through it — but a page
    // with zero native controls is definitely relying on mouse/touch only.
    const hasNativeControl = pages.some(
      ({ doc }) => doc.querySelector("button, input, [role='button'][tabindex]") !== null,
    );
    expect(hasNativeControl, "no <button>/<input>/[role=button] found on any built page").toBe(true);
  });
});

describe("no way to play it wrong", () => {
  const FAIL_STATE = /score|fail(?!ure to build)|game-?over|\blose\b|\blost\b/i;

  it("ships no score or fail-state markup", () => {
    for (const { name, doc } of pages) {
      const hits = [...doc.querySelectorAll("[class], [id]")].filter((el) =>
        FAIL_STATE.test(`${el.className} ${el.id}`),
      );
      expect(hits, `${name}: found class/id suggesting a score or fail state`).toEqual([]);
    }
  });
});
