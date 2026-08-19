// The instrument's pitch material. No DOM and no Web Audio in here, so it can
// be tested directly — JSDOM has neither.

/**
 * Major pentatonic, in semitones from the root.
 *
 * This is the whole answer to "there is no way to play it wrong". Any subset
 * of these five notes sounds consonant against any other subset: there is no
 * minor second and no tritone available, so a player mashing the grid with a
 * whole hand gets a chord rather than a mistake. Widening this to seven notes
 * would make wrong answers reachable.
 */
export const DEGREES = [0, 2, 4, 7, 9] as const;

/** D3 — low enough that the bottom row reads as a bass note, high enough that
 *  the top row stays under a kilohertz and never gets shrill. */
export const ROOT_MIDI = 50;

export const OCTAVES = 3;
export const COLUMNS = DEGREES.length;
export const PAD_COUNT = OCTAVES * COLUMNS;

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** One keyboard row per octave, lowest first, so the rows under the player's
 *  fingers sit in the same order as the rows on screen. */
export const KEY_ROWS = ["asdfg", "qwert", "12345"] as const;

export interface Pad {
  /** 0 is the lowest pad; ids ascend in pitch. */
  readonly id: number;
  /** 0 is the bottom (lowest) row. */
  readonly octave: number;
  readonly column: number;
  readonly midi: number;
  readonly frequency: number;
  /** e.g. "F♯4" — what the pad announces to a screen reader. */
  readonly name: string;
  /** The keyboard key that plays this pad. */
  readonly key: string;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiToName(midi: number): string {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export const PADS: readonly Pad[] = Array.from({ length: PAD_COUNT }, (_, id) => {
  const octave = Math.floor(id / COLUMNS);
  const column = id % COLUMNS;
  const midi = ROOT_MIDI + 12 * octave + DEGREES[column];
  return {
    id,
    octave,
    column,
    midi,
    frequency: midiToFrequency(midi),
    name: midiToName(midi),
    key: KEY_ROWS[octave][column],
  };
});

const BY_KEY = new Map(PADS.map((pad) => [pad.key, pad]));

/** The pad a keystroke plays, or undefined for a key the instrument doesn't
 *  use. Case-folded, so caps lock can't take the instrument away. */
export function padForKey(key: string): Pad | undefined {
  return BY_KEY.get(key.toLowerCase());
}
