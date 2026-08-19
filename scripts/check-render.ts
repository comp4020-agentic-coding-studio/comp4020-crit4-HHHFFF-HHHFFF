#!/usr/bin/env node
// The sensor for everything JSDOM can't see.
//
// It exists because a real defect got all the way to a screenshot with every
// test in the repo green: the opening prompt swapped to a longer line on the
// first note and pushed the pads 25px down the screen. No single-state
// assertion can catch that — the shift only exists *between* two states — and
// JSDOM couldn't have measured it anyway, since it models no layout.
//
// So this drives the built site in real Chrome, through the same
// `window.harness` seam the visitor's own gestures go through, and asserts the
// things only a rendering engine knows:
//
//   - nothing moves when the player makes their first sound
//   - no horizontal overflow, and the whole instrument fits one phone screen
//   - every pad is still a real touch target
//   - an AudioContext actually constructs and doesn't throw
//
// Both marked viewports are measured inside iframes rather than by resizing
// the window: Chrome on Windows clamps a window to 500px wide and then writes
// a PNG at whatever you asked for, so a 390px "screenshot" is really the left
// 390px of a 500px layout — which reads exactly like overflow and isn't.

import { execFile } from "node:child_process";
import { createReadStream, existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { platform } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const DIST = resolve("dist");
const PROBE_NAME = "__render-check.html";
const PROBE_PATH = join(DIST, PROBE_NAME);

/** The two viewports the deliverable is looked at in, and the height each has
 *  to fit inside without scrolling. */
const VIEWPORTS = [
  { label: "390x844", width: 390, height: 844 },
  { label: "1280x900", width: 1280, height: 900 },
] as const;

/** Below this, a pad stops being a thumb-sized target. */
const MIN_TOUCH_TARGET = 44;

interface Measurement {
  width: number;
  horizontalOverflow: number;
  verticalOverflow: number;
  padCount: number;
  smallestPad: number;
  lit: number;
  audioRunning: boolean;
  audioError: string | null;
  shiftOnFirstSound: number;
  elementsWatched: number;
}

type Probe =
  | { ok: true; viewports: Record<string, Measurement> }
  | { ok: false; reason: string };

// --- finding Chrome ---------------------------------------------------------

const CANDIDATES: Record<string, string[]> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
};

function findChrome(): string | undefined {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return (CANDIDATES[platform()] ?? []).find((path) => path && existsSync(path));
}

// --- serving dist -----------------------------------------------------------

// A module script won't run from file:// (CORS, origin null), so a file://
// check silently measures the page with no JavaScript at all.

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function serveDist(): Promise<{ origin: string; stop: () => void }> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0]);
    const relative = normalize(path).replace(/^([/\\])+/, "");
    const file = join(DIST, relative === "" ? "index.html" : relative);
    if (!file.startsWith(DIST) || !existsSync(file)) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "text/plain" });
    createReadStream(file).pipe(response);
  });

  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolveServer({
        origin: `http://127.0.0.1:${port}`,
        stop: () => server.close(),
      });
    });
  });
}

// --- the page that does the measuring ---------------------------------------

function probePage(): string {
  const frames = VIEWPORTS.map(
    ({ label, width, height }) =>
      `<iframe data-label="${label}" data-height="${height}" src="./index.html" ` +
      `style="width:${width}px;height:${height}px;border:0;display:block"></iframe>`,
  ).join("\n");

  // Deliberately not a module script and deliberately old-fashioned: it is
  // read by Chrome only, never bundled, and nothing here should need a build
  // step to stay true.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>render check</title></head>
<body style="margin:0">
${frames}
<pre id="render-check">pending</pre>
<script>
var out = document.getElementById("render-check");
var frames = [].slice.call(document.querySelectorAll("iframe"));
var tries = 0;

// offset* rather than getBoundingClientRect: a lit pad is scaled down by a CSS
// transform, which moves its client rect without moving the layout. Layout is
// what we care about — a transform is the animation, a reflow is the bug.
//
// Summed up the offsetParent chain, though, and not read raw. A transform also
// makes an element a containing block, so lighting a pad flips its own child
// span's offsetParent from <body> to that <button> and every raw offsetTop
// under it changes meaning mid-measurement. That reads as a 500px jump and is
// nothing at all. Walking the chain puts every element back in document space,
// where transforms don't reach.
function box(el) {
  var top = 0;
  var left = 0;
  for (var node = el; node; node = node.offsetParent) {
    top += node.offsetTop;
    left += node.offsetLeft;
  }
  return [top, left, el.offsetWidth, el.offsetHeight];
}

// Each offsetTop in that chain is rounded to a whole pixel on its own, so a
// re-parented element's summed position can land a pixel off its former single
// rounded reading. Anything sitting inside a transformed ancestor is part of
// the animation rather than part of the layout, so it is dropped from the
// comparison instead of being given a tolerance — a real 2px reflow should
// still fail this.
function insideTransformed(w, el, root) {
  for (var node = el.parentElement; node && node !== root; node = node.parentElement) {
    if (w.getComputedStyle(node).transform !== "none") return true;
  }
  return false;
}

function worstMove(before, after, keep) {
  var worst = 0;
  var n = Math.min(before.length, after.length);
  for (var i = 0; i < n; i++) {
    if (!keep[i]) continue;
    for (var j = 0; j < 4; j++) {
      worst = Math.max(worst, Math.abs(before[i][j] - after[i][j]));
    }
  }
  return worst;
}

function isReady(frame) {
  var d = frame.contentDocument;
  return !!(d && d.readyState === "complete" && d.querySelectorAll(".pad").length &&
    frame.contentWindow && frame.contentWindow.harness);
}

function measure(frame) {
  var d = frame.contentDocument;
  var w = frame.contentWindow;
  var root = d.documentElement;
  var pads = d.querySelectorAll(".pad");
  var height = Number(frame.getAttribute("data-height"));

  var main = d.querySelector("main");
  var tracked = [].slice.call(d.querySelectorAll("main *"));
  var before = tracked.map(box);

  var audioError = null;
  // Two pads an octave apart: enough to prove polyphony and to trigger the
  // one-time swap of the opening prompt, which is what used to move the grid.
  try { w.harness.press(0, 0.9); w.harness.press(7, 0.9); }
  catch (e) { audioError = String(e); }

  var after = tracked.map(box);
  // Worked out from the played state, where the transforms actually exist, and
  // applied to both snapshots so the two are always compared like for like.
  var keep = tracked.map(function (el) { return !insideTransformed(w, el, main); });

  var smallest = Infinity;
  [].forEach.call(pads, function (pad) {
    smallest = Math.min(smallest, pad.offsetWidth, pad.offsetHeight);
  });

  var result = {
    width: root.clientWidth,
    horizontalOverflow: root.scrollWidth - root.clientWidth,
    verticalOverflow: Math.max(0, d.body.scrollHeight - height),
    padCount: pads.length,
    smallestPad: Math.round(smallest),
    lit: w.harness.lit().length,
    audioRunning: w.harness.running(),
    audioError: audioError,
    shiftOnFirstSound: worstMove(before, after, keep),
    elementsWatched: keep.filter(Boolean).length
  };
  w.harness.releaseAll();
  return result;
}

// Every frame has to be virgin when it's measured: the prompt swaps once and
// only once, so a frame measured twice would report a shift of zero for the
// happiest of wrong reasons.
var timer = setInterval(function () {
  tries += 1;
  try {
    if (frames.every(isReady)) {
      var viewports = {};
      frames.forEach(function (frame) {
        viewports[frame.getAttribute("data-label")] = measure(frame);
      });
      out.textContent = JSON.stringify({ ok: true, viewports: viewports });
      clearInterval(timer);
    } else if (tries > 80) {
      out.textContent = JSON.stringify({ ok: false, reason: "the page never finished wiring itself up" });
      clearInterval(timer);
    }
  } catch (e) {
    out.textContent = JSON.stringify({ ok: false, reason: String(e) });
    clearInterval(timer);
  }
}, 50);
<\/script>
</body></html>`;
}

// --- driving it -------------------------------------------------------------

async function readProbe(chrome: string, url: string): Promise<Probe> {
  const { stdout } = await run(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      // Headless produces roughly a frame per second of virtual time, so
      // anything on rAF is invisible here. Nothing measured below waits for a
      // frame; the budget is only there to let the polling timer run.
      "--virtual-time-budget=10000",
      "--autoplay-policy=no-user-gesture-required",
      "--dump-dom",
      url,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );

  const match = stdout.match(/<pre id="render-check">([\s\S]*?)<\/pre>/);
  if (!match) return { ok: false, reason: "Chrome returned a page with no probe in it" };
  const payload = match[1]
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
  if (payload.trim() === "pending") {
    return { ok: false, reason: "the probe never resolved before Chrome exited" };
  }
  try {
    return JSON.parse(payload) as Probe;
  } catch {
    return { ok: false, reason: `couldn't parse the probe: ${payload.slice(0, 200)}` };
  }
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("✗ no dist/index.html — run `pnpm build` first");
    process.exit(1);
  }

  const chrome = findChrome();
  if (!chrome) {
    // A warning, not a failure. This check is a local sensor; the rest of the
    // suite still runs everywhere. Set CHROME_PATH if yours lives elsewhere.
    console.warn("! no Chrome found — skipping the render check (set CHROME_PATH to point at one)");
    return;
  }

  const { origin, stop } = await serveDist();
  let failures = 0;
  const fail = (message: string): void => {
    console.error(`✗ ${message}`);
    failures += 1;
  };

  try {
    writeFileSync(PROBE_PATH, probePage());
    const probe = await readProbe(chrome, `${origin}/${PROBE_NAME}`);

    if (!probe.ok) {
      // Not `return` — that would skip past the exit code below and report a
      // check that never ran as a check that passed.
      fail(`render check couldn't run: ${probe.reason}`);
    }

    for (const { label, width } of VIEWPORTS) {
      if (!probe.ok) break;
      // Per-viewport, so one bad viewport doesn't silently claim the other passed.
      const before = failures;
      const seen = probe.viewports[label];
      if (!seen) {
        fail(`${label}: no measurement came back`);
        continue;
      }

      if (seen.width !== width) {
        fail(`${label}: measured ${seen.width}px wide, not ${width}px — the harness itself is wrong`);
      }

      if (seen.shiftOnFirstSound > 0) {
        fail(
          `${label}: something in <main> moves or resizes by up to ${seen.shiftOnFirstSound}px ` +
            `when the player makes their first sound. Nothing may reflow at the moment someone ` +
            `is deciding whether to play a second note — reserve the space rather than ` +
            `collapsing it, and remember that \`hidden\` is display:none and takes the box with it.`,
        );
      }

      if (seen.horizontalOverflow > 0) {
        fail(`${label}: ${seen.horizontalOverflow}px of horizontal overflow`);
      }

      if (seen.verticalOverflow > 0) {
        fail(
          `${label}: the instrument is ${seen.verticalOverflow}px taller than the screen, so ` +
            `some of it has to be scrolled to`,
        );
      }

      if (seen.smallestPad < MIN_TOUCH_TARGET) {
        fail(`${label}: smallest pad is ${seen.smallestPad}px, under the ${MIN_TOUCH_TARGET}px touch target`);
      }

      if (seen.audioError) {
        fail(`${label}: the Web Audio graph threw — ${seen.audioError}`);
      } else if (!seen.audioRunning) {
        fail(`${label}: no AudioContext was constructed, so nothing would have been heard`);
      }

      if (seen.lit !== 2) {
        fail(`${label}: pressed 2 pads, ${seen.lit} lit up — the sound and the picture disagree`);
      }

      if (failures === before) {
        console.log(
          `✓ ${label}: ${seen.padCount} pads at ${seen.smallestPad}px, audio live, ` +
            `${seen.elementsWatched} elements all still where they were after the first sound`,
        );
      }
    }
  } finally {
    rmSync(PROBE_PATH, { force: true });
    stop();
  }

  if (failures > 0) process.exit(1);
}

await main();
