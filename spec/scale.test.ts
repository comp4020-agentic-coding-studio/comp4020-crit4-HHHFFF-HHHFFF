import { describe, expect, it } from "vitest";

import {
  COLUMNS,
  DEGREES,
  KEY_ROWS,
  PAD_COUNT,
  PADS,
  midiToFrequency,
  midiToName,
  padForKey,
} from "../src/scale.ts";

// The tuning is the spec line "there is no way to play it wrong" expressed as
// arithmetic, so it gets asserted directly rather than through the DOM. This
// module is deliberately free of both DOM and Web Audio, because JSDOM has
// neither and would have nothing to say about it.

describe("the scale can't produce a wrong note", () => {
  it("uses only intervals that stay consonant in any combination", () => {
    // Minor seconds (1) and tritones (6) are the two intervals that sound like
    // a mistake to an untrained ear. Every pair of pads in the grid, in every
    // octave, has to avoid both — that is what lets a player mash the whole
    // grid and get a chord.
    const pitchClasses = PADS.map((pad) => pad.midi % 12);
    for (const a of pitchClasses) {
      for (const b of pitchClasses) {
        const interval = Math.min((a - b + 12) % 12, (b - a + 12) % 12);
        expect([1, 6]).not.toContain(interval);
      }
    }
  });

  it("is five notes wide and three octaves tall", () => {
    expect(DEGREES).toHaveLength(COLUMNS);
    expect(PADS).toHaveLength(PAD_COUNT);
    expect(new Set(PADS.map((pad) => pad.octave)).size).toBe(PAD_COUNT / COLUMNS);
  });

  it("ascends in pitch with the pad id", () => {
    const frequencies = PADS.map((pad) => pad.frequency);
    expect(frequencies).toEqual([...frequencies].sort((a, b) => a - b));
  });

  it("stays in a range that is neither muddy nor shrill", () => {
    expect(PADS[0].frequency).toBeGreaterThan(120);
    expect(PADS[PAD_COUNT - 1].frequency).toBeLessThan(1100);
  });
});

describe("every pad is reachable from the keyboard", () => {
  it("gives each pad its own key", () => {
    const keys = PADS.map((pad) => pad.key);
    expect(new Set(keys).size).toBe(PAD_COUNT);
  });

  it("lays the key rows out in the same order as the screen rows", () => {
    for (const pad of PADS) {
      expect(pad.key).toBe(KEY_ROWS[pad.octave][pad.column]);
    }
  });

  it("ignores caps lock", () => {
    expect(padForKey("A")).toBe(padForKey("a"));
    expect(padForKey("A")).toBeDefined();
  });

  it("returns nothing for a key the instrument doesn't use", () => {
    expect(padForKey("z")).toBeUndefined();
    expect(padForKey("Escape")).toBeUndefined();
  });
});

describe("pitch arithmetic", () => {
  it("anchors on A4 = 440 Hz", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 10);
    expect(midiToFrequency(81)).toBeCloseTo(880, 10);
  });

  it("names notes the way a player would read them", () => {
    expect(midiToName(69)).toBe("A4");
    expect(midiToName(50)).toBe("D3");
    expect(midiToName(54)).toBe("F♯3");
  });
});
