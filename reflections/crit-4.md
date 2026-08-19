# Crit 4 — An instrument

## What was the breakthrough that moved the work forward?

Realising that "there is no way to play it wrong" was a tuning decision and not
a feature. My first instinct was to build a keyboard and then defend it — snap
the input to a scale, forgive bad intervals, add a layer between the player and
the sound whose job is to stop them embarrassing themselves. Choosing a
pentatonic scale instead meant the wrong notes simply don't exist on the
instrument, and the entire guarantee reduced to five numbers I could assert
over in a test. The forgiveness layer would have been more code defending a
worse property.

## What did this work change about who I want to be as a software developer?

The week's framing was that an agent can build a synth but can't hear the
result, so my ear is the harness — and the thing that actually caught me out
wasn't the sound at all. Every check was green and the page still had a defect:
the pads jumped 25px the instant you played your first note. The suite couldn't
see it because every assertion in it looks at one state at a time, and the bug
only existed between two.

What I want to take from that is the habit of asking what a green suite is
*structurally incapable* of noticing, and then spending the effort there rather
than on another passing test. Fixing the CSS took a minute; writing the check
that would have caught it — and proving it red against the previous commit
before trusting it — took an hour and two false positives, and it's the only
part of this week I'd still stand behind if the prototype were thrown away.
I'd rather be the developer who improves what the work is measured against than
one who gets faster at satisfying the measurements already there.
