# Process overview

## What I built

**Five Notes** — fifteen pads tuned to one major pentatonic scale across three
octaves, synthesised live in the browser with the Web Audio API. Press, hold,
drag across them, or play the rows from the home row of the keyboard; strike
velocity comes from where on the pad you hit, and two sliders move the whole
instrument's brightness and reverb. The idea is that the spec line "there is no
way to play it wrong" should be a property of the instrument rather than a rule
it enforces on you: pick five notes with no minor second and no tritone between
any pair, and a stranger mashing the grid with a whole hand gets a chord.

![The instrument with a three-note chord held down](docs/instrument.png)

## The moments that mattered

### Making "no wrong notes" arithmetic instead of etiquette

The obvious build is a chromatic keyboard plus something that stops you playing
badly — a snap-to-scale, a quantiser, some forgiveness layer. I went the other
way and deleted the wrong notes from the instrument entirely, which meant the
whole guarantee collapsed into one array of five intervals and could be checked
directly. `spec/scale.test.ts` walks every pair of the fifteen pads and asserts
that no two are 1 or 6 semitones apart, so the property is proved over the whole
grid rather than spot-checked. That test is also what stops a later "let's add a
seventh" from quietly reintroducing wrong answers
([`3a4c306`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-HHHFFF-HHHFFF/commit/3a4c306)).

The same instinct settled the layering. JSDOM has no Web Audio at all — `new
AudioContext()` throws there — so rather than mock it, the tuning lives in a
module with no DOM and no audio in it, and the synthesis lives in a module with
no DOM. What's left for the browser is the part only a browser can answer.

### A green suite that could not see the bug

The pads were done and every check passed, so the remaining work looked like
polish. Screenshotting the played state next to the idle one showed the grid
sitting 25px lower after the first note: the opening prompt swaps to a longer
line, that line wraps, and everything below it moves — at the exact moment the
crit's pod has made one sound and is deciding whether to make a second.

Both states were correct. Only the transition was wrong, and every assertion in
the repo looks at one state at a time, so re-running the suite would never have
told me. I fixed the CSS
([`e2c35cf`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-HHHFFF-HHHFFF/commit/e2c35cf)),
but the fix isn't the interesting part — the blind spot is. So the correction
went into the harness: `pnpm check:render` drives the built page in real Chrome
through the same `window.harness` seam a visitor's gestures reach, and compares
the layout of every element in `<main>` before and after the first sound, at
both marked viewports
([`47a8941`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-HHHFFF-HHHFFF/commit/47a8941)).

How I knew it was a real sensor and not decoration: I checked the pre-fix files
back out, rebuilt, and ran it — red at both viewports — then restored HEAD and
ran it again — green. Getting there cost two false positives, both of which
taught me more than the original bug and are now written into `CLAUDE.md`:
`getBoundingClientRect()` includes CSS transforms, and — the one I'd never have
guessed — a transform also makes an element a *containing block*, so lighting a
pad re-parents its child span's `offsetParent` and an entirely unchanged layout
reported a 506px jump. The fix was to sum `offset*` up the `offsetParent` chain
and drop transformed subtrees from the comparison, rather than to wave it
through with a pixel tolerance
([`3a4c306...47a8941`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-HHHFFF-HHHFFF/compare/3a4c306...47a8941)).

### Discoverability without a word, and a chase that wouldn't stay a chase

The opening screen had a paragraph telling a stranger which keys did what.
That is the most literal way to fail crit 4's own discoverability line — a
stranger is meant to find the first sound uninstructed — so I deleted it. But
a blank grid invites nothing either; the obvious replacement was a slow glow
animated on every pad at once, cued by nothing but CSS.

That first version looked wrong the moment I looked at it running, and I'd
have called it "atmospheric" if the person actually looking hadn't called it
messy instead: fifteen pads pulsing in place read as noise, not an invitation.
The fix wasn't the keyframe, which was fine — it was the timing: one shared
long `animation-duration` for the whole grid, and a per-pad `animation-delay`
so each pad is a fixed number of steps out of phase with the next, forever,
rather than all fifteen on the same clock
([`0d47591`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-HHHFFF-HHHFFF/commit/0d47591)).

I shipped that with a *negative* delay, reasoning that it starts an infinite
animation already partway through its cycle with no waiting, and moved on. It
was backwards — a higher-order pad starts *further* along than a lower one, so
the wave travelled bottom-right to top-left, the opposite of what `--order`
was meant to mean — and I only know that because it got looked at running and
called out, not because any check here saw it: `check:render` only ever
compares two static snapshots, and this repo's own notes say headless Chrome
barely renders animation progress at all, so a screenshot mid-sweep wasn't a
tool I could trust for a *direction* question either. What settled it was
tracing the delay arithmetic by hand until the direction fell out of it: a
positive delay puts every pad's phase offset in the order `--order` describes,
and needs `animation-fill-mode: backwards` so a pad waiting its turn shows the
keyframe's `scale(1)` instead of the bare initial `none` — the same
present/absent transform flip from the moment above, in a new spot
([`f4d99b1`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-HHHFFF-HHHFFF/commit/f4d99b1)).

Verification here wasn't a new test — it was rerunning `pnpm check:render`
after each attempt, because touching this animation at all is the
transform/containing-block trap from the moment above (an untransformed pad's
`transform` reverting to the literal `"none"` is indistinguishable, to that
check, from a real layout shift). It stayed green both times, which is exactly
why the direction bug needed a human to catch it: the check was never asking
that question.

## What the checks can't tell you

Whether it sounds good. Whether the envelope is too slow to feel like a strike,
whether the reverb is a wash, whether a gesture is expressive or just tiring.
Nothing in `pnpm check` has an opinion on any of it, and the parts I changed by
ear — release length, the near-octave partial at 2.002 that makes a held chord
shimmer instead of sitting still, the master compressor so fifteen held pads
duck rather than clip — left no trace in any test.
