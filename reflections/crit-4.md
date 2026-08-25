# Crit 4 — An instrument

## What was the breakthrough that moved the work forward?

Realising that "there is no way to play it wrong" was a tuning decision, not a
feature. My first instinct was to build a keyboard and then defend it — snap
the input to a scale, forgive bad intervals, add a layer whose job is to stop
the player embarrassing themselves. Choosing a pentatonic scale instead meant
the wrong notes simply don't exist on the instrument, and the whole guarantee
reduced to five numbers I could assert over in a test. The forgiveness layer
would have been more code defending a worse property.

## What did this work change about who I want to be as a software developer?

An agent can build a synth but can't hear the result, so my ear was meant to be
the harness — but the thing that actually caught me out wasn't the sound at
all. Every check was green and the page still had a defect: the pads jumped
25px the instant you played your first note, invisible to a suite where every
assertion looks at one state at a time. Writing the check that would have
caught it, and proving it red against the old commit before trusting it, took
an hour against a minute for the fix — the part of the week I'd still stand
behind if the prototype were thrown away.

The same habit turned up later from the opposite side. An idle animation meant
to sweep the grid was travelling the wrong way, and I couldn't just stare at a
screenshot until I believed it fixed — this repo's own notes say headless
Chrome barely renders animation progress, so the one tool that shows "what's
actually happening" was exactly the one not to trust for this question. The
fix was tracing the delay math by hand until the direction fell out of the
arithmetic. I'd rather be the developer who knows which of their tools can lie
to them than one who trusts whichever one is already open.
