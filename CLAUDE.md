# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.
- Never reshape production code to satisfy a test environment: no downgrading
  module scripts, no inline scripts added for JSDOM's benefit, no second copy
  of core logic just for tests. If a test needs to drive an interactive state,
  add a small seam on `window` that steps the same instance the visitor is
  watching (e.g. `window.harness.doThing()`), not a parallel implementation.

## Seeing the rendered page on this machine

There's no `agent-browser` CLI installed here, so ground truth comes from
headless Chrome directly:

```bash
pnpm build && npx vite preview --port 4173 --strictPort &   # serve dist over http
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --hide-scrollbars --window-size=1920,1080 --virtual-time-budget=6000 \
  --screenshot="C:\Users\H-F\AppData\Local\Temp\shot.png" \
  "http://localhost:4173/"
```

Three things to know. **Write the PNG to the temp dir, not the repo** ---
Chrome gets "拒绝访问" writing into the working directory. **Serve over http,
not `file://`** --- a module script (`<script type="module">`) won't run from
a `file://` origin (CORS, origin `null`), so a `file://` screenshot silently
shows the page with no JavaScript at all. And to see an interactive state,
write a copy of `dist/index.html` back **into `dist/`** (same origin, relative
asset URLs resolve) with a module script appended that drives the page via a
`window`-level test seam; module scripts run in order, so injected code lands
after the page's own script has wired up. Delete the copies afterwards ---
`vite build` empties `dist/` first, so anything left over 404s on its own
now-deleted assets and reads as a broken page.

### Chrome won't give you a 390px window --- use an iframe

`--window-size=390,844` **does not produce a 390px viewport** on Windows.
Chrome clamps the window to a 500px minimum, then writes a PNG that is 390
wide anyway --- so the image is the left 390px of a 500px layout, cropped.
That reads exactly like horizontal overflow and isn't. Since 390×844 is one of
the two marked viewports, measure it by rendering the page inside a 390px
iframe instead of resizing the window, and read `clientWidth` / `scrollWidth`
/ `getBoundingClientRect()` from the parent, dumped into the DOM for
`--dump-dom` to pick up. Pass `--hide-scrollbars` on the measuring run too, or
the iframe's own scrollbar eats into it and `clientWidth` reads short.

### Headless Chrome barely runs `requestAnimationFrame`

`--virtual-time-budget` advances virtual time, but with no compositor
headless produces roughly a frame per second of it --- anything driven by rAF
is invisible to a screenshot or `--dump-dom` check, which reads as "broken"
when it's fine. The fix is a test seam: expose a hook on `window` that steps
the same state the visitor sees, without waiting for frames, and drive it
from the injected script.

### Don't trust JSDOM for anything about rendering, timing or audio

It doesn't model the user-agent/author cascade (`getComputedStyle` can report
`display: none` for something plainly visible in Chrome). It does not execute
`<script type="module">` (Vite's build emits exactly one). It has no
`requestAnimationFrame`, `canvas.getContext("2d")` returns `null`, and **it
has no Web Audio API at all** --- `new AudioContext()` throws under JSDOM, so
anything that touches audio has to live in a DOM-free module and be tested
there directly, with JSDOM limited to asserting the markup contract and real
Chrome checked for what actually renders and sounds.

### `hidden` loses to any author `display`

The `hidden` attribute is only `[hidden] { display: none }` in the user-agent
stylesheet, and author rules beat the user agent at any specificity. So
`.thing { display: flex }` plus `<div class="thing" hidden>` renders visible
--- the attribute reads correctly in the DOM and in every markup assertion
while the element sits there on screen. Any element that sets its own
`display` and gets toggled by `hidden` needs the override alongside it:

```css
.thing { display: flex; }
.thing[hidden] { display: none; }
```

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so look at the deployed head when you add pages.

## The checks

`pnpm check` runs them (`pnpm check:evidence` is the extra gate before you
ship); CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook. As you learn what your prototype needs --- a
convention the work has to hold to, a sensor that keeps catching you out (a
linter, say), a fact about the stack that is easy to get wrong --- write it down
here and wire it into `check`. Growing this file is the work.
