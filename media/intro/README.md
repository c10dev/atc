# media/intro — the atc intro video

**English** · [한국어](README.ko.md)

A ~33 s video of one made-up FLIGHT (`ATC-42 Add dark mode toggle`, `TEAM_A`) from Linear ticket to RETURN TO SERVICE, drawn from code so it can be re-rendered when atc changes. Every step shown exists in atc today ([dispatch](../../docs/dispatch.md), [mcc](../../docs/mcc.md), [fleet](../../docs/fleet.md)). All data is fake: no real ticket, PR, session or path.

```
index.html   the scenes (HTML/CSS, one deterministic timeline: window.seek(t))
render.mjs   renders the timeline frame by frame and encodes it with ffmpeg
```

## Render

```bash
node media/intro/render.mjs            # 1920×1080 → ~/atc-media/intro/atc-intro-16x9.mp4
node media/intro/render.mjs --square   # 1080×1080 cut → ~/atc-media/intro/atc-intro-1x1.mp4
node media/intro/render.mjs --frame 12 # one still at t = 12 s, to check a scene without rendering all
```

Options: `--fps 30|60` (default 30), `--out <dir>` (default `~/atc-media/intro`, outside the repository so it survives the STAND). A full render takes a few minutes.

Output: H.264 High, yuv420p, no audio, `+faststart` (plays in Chrome and QuickTime), about 1.5 MB.

## Needs

- Node 24 (its built-in `WebSocket` drives Chromium over the DevTools protocol; no npm package is added).
- `ffmpeg` with libx264 on `PATH`.
- A Chromium: `CHROME_BIN`, else a Playwright `chromium_headless_shell` in `~/.cache/ms-playwright`, else `/usr/bin/chromium`, `/usr/bin/google-chrome` or `/snap/bin/chromium`.

The type is the first available of JetBrains Mono, the system monospace and Liberation Mono, so glyph widths differ a little between hosts.

## Editing

Scenes are `<section class="scene" data-s data-e>` blocks in `index.html` (start and end in seconds); inside, `data-at` fades an element in, `data-type` types text, `data-flip` ticks a row, `data-slide` moves the landing dot. `DURATION` and the scene times must stay between 25 and 35 s in total. Colours are the radar theme tokens of `web/src/styles.css`.

Never commit the video, GIFs or frames (the repository is public and carries no images): `.gitignore` covers `media/**/*.mp4`, `*.gif` and `*.png`.
