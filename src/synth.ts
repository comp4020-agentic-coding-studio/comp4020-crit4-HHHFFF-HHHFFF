// The sound. Web Audio only — no DOM — because JSDOM has no AudioContext at
// all (`new AudioContext()` throws there), so this has to be importable and
// inspectable without a document. Whether it sounds good is checked by ear in
// a real browser; nothing here can tell you that.

import { PADS } from "./scale.ts";

/** Envelope, in seconds. A soft attack and a long release are what make a held
 *  pad read as a struck bell rather than a beep, and what lets two notes
 *  pressed a moment apart still ring together. */
const ATTACK = 0.014;
const DECAY = 0.34;
const SUSTAIN = 0.34;
const RELEASE = 1.6;

/** Peak gain of one voice. Fifteen pads can be held at once, so this has to
 *  leave headroom; the compressor catches the rest. */
const VOICE_PEAK = 0.2;

/** Partials making up one voice: [waveform, frequency ratio, level]. The
 *  near-octave sine at 2.002 beats slowly against the triangle's own second
 *  harmonic, which is what stops a held chord sounding static. */
const PARTIALS: readonly [OscillatorType, number, number][] = [
  ["triangle", 1, 1],
  ["sine", 2.002, 0.32],
  ["sine", 0.5, 0.2],
];

class Voice {
  readonly #oscillators: OscillatorNode[];
  readonly #gain: GainNode;

  constructor(ctx: AudioContext, destination: AudioNode, frequency: number, velocity: number) {
    const now = ctx.currentTime;
    const peak = VOICE_PEAK * velocity;

    this.#gain = ctx.createGain();
    this.#gain.gain.setValueAtTime(0, now);
    this.#gain.gain.linearRampToValueAtTime(peak, now + ATTACK);
    this.#gain.gain.setTargetAtTime(peak * SUSTAIN, now + ATTACK, DECAY);
    this.#gain.connect(destination);

    this.#oscillators = PARTIALS.map(([type, ratio, level]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency * ratio, now);
      const mix = ctx.createGain();
      mix.gain.setValueAtTime(level, now);
      osc.connect(mix).connect(this.#gain);
      osc.start(now);
      return osc;
    });
  }

  /** Ring down and schedule teardown. Returns the time the voice goes silent. */
  release(ctx: AudioContext): number {
    const now = ctx.currentTime;
    const gain = this.#gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    // setTargetAtTime is exponential, so it never quite reaches zero; a quarter
    // of RELEASE as the time constant puts it inaudible well before the stop.
    gain.setTargetAtTime(0, now, RELEASE / 4);
    const silentAt = now + RELEASE;
    for (const osc of this.#oscillators) osc.stop(silentAt);
    this.#oscillators[0].addEventListener("ended", () => this.#gain.disconnect());
    return silentAt;
  }
}

/** A short exponentially-decaying noise burst, used as a reverb impulse. Cheap
 *  and generated at runtime — a real impulse response would be a shipped audio
 *  file, which is exactly what this week's spec rules out. */
function impulseResponse(ctx: AudioContext, seconds = 2.6, decay = 3.4): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return buffer;
}

interface Graph {
  readonly ctx: AudioContext;
  /** Where voices connect: one shared lowpass, so "tone" sweeps the whole
   *  instrument at once instead of per-note. */
  readonly filter: BiquadFilterNode;
  readonly wet: GainNode;
}

export class Synth {
  #graph: Graph | null = null;
  #voices = new Map<number, Voice>();
  #tone = 0.55;
  #room = 0.4;

  /** True once the audio graph exists. Browsers only allow that inside a user
   *  gesture, so this stays false until the player does something. */
  get running(): boolean {
    return this.#graph !== null;
  }

  /** Pads currently held, lowest first. */
  get held(): number[] {
    return [...this.#voices.keys()].sort((a, b) => a - b);
  }

  /**
   * Build the audio graph, or resume it if the browser suspended it. Safe to
   * call on every gesture — the first call is the one that matters.
   */
  start(): void {
    if (this.#graph) {
      void this.#graph.ctx.resume();
      return;
    }

    const ctx = new AudioContext();

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.8;

    // A limiter, not an effect: fifteen held pads should get quieter together,
    // not clip. Nothing a player does should be able to make it sound broken.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);

    const dry = ctx.createGain();
    dry.gain.value = 1;
    filter.connect(dry).connect(limiter);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulseResponse(ctx);
    const wet = ctx.createGain();
    filter.connect(reverb).connect(wet).connect(limiter);

    this.#graph = { ctx, filter, wet };
    this.setTone(this.#tone);
    this.setRoom(this.#room);
  }

  /** Play a pad. `velocity` is 0–1; re-pressing a held pad re-strikes it. */
  press(id: number, velocity = 0.85): void {
    const pad = PADS[id];
    if (!pad) return;
    this.start();
    if (!this.#graph) return;

    this.release(id);
    const clamped = Math.min(1, Math.max(0.15, velocity));
    this.#voices.set(id, new Voice(this.#graph.ctx, this.#graph.filter, pad.frequency, clamped));
  }

  release(id: number): void {
    const voice = this.#voices.get(id);
    if (!voice || !this.#graph) return;
    this.#voices.delete(id);
    voice.release(this.#graph.ctx);
  }

  releaseAll(): void {
    for (const id of [...this.#voices.keys()]) this.release(id);
  }

  /** 0–1 → lowpass cutoff, 300 Hz to 9 kHz. Exponential, because pitch and
   *  brightness are both perceived that way; a linear sweep spends most of its
   *  travel in a range that all sounds the same. */
  setTone(value: number): void {
    this.#tone = Math.min(1, Math.max(0, value));
    if (!this.#graph) return;
    const { ctx, filter } = this.#graph;
    filter.frequency.setTargetAtTime(300 * 30 ** this.#tone, ctx.currentTime, 0.02);
  }

  /** 0–1 → reverb send. Never reaches a full wash: the player should always be
   *  able to hear the note they just pressed. */
  setRoom(value: number): void {
    this.#room = Math.min(1, Math.max(0, value));
    if (!this.#graph) return;
    const { ctx, wet } = this.#graph;
    wet.gain.setTargetAtTime(this.#room * 0.9, ctx.currentTime, 0.02);
  }
}
