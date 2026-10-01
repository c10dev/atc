# Third-party notices

atc itself is licensed under the Apache License, Version 2.0 (see `LICENSE` and `NOTICE`). The files below were copied from other projects, pinned to a commit, and modified for atc as stated. Updating one means a PR that changes the commit here and shows the upstream diff. Each file also carries a short attribution note at its top.

| atc file | Source | Commit | Licence | What changed |
|---|---|---|---|---|
| `.claude/skills/ui-review/references/web-interface-guidelines.md` | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines), `AGENTS.md` | `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1` | MIT | an attribution and precedence header added; five rules marked `CONFLICT` (layout-property animation, APCA contrast, locale-aware times, layered shadows, semi-transparent borders: atc's design language decided otherwise, not applied until the SUPERVISOR decides); the Hydration section and one line marked N/A (no server rendering); Tailwind class names given with their CSS meaning. Upstream's `command.md` is not vendored (its output format is replaced by atc's) |
| `.claude/skills/ui-review/references/feel.md` | [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better), `skills/make-interfaces-feel-better/SKILL.md`, `surfaces.md`, `typography.md`, `icons.md` | `35545ea1512ad59fa463e6b1f95ca9c052981fe6` | MIT | reordered and shortened; Tailwind examples left out; motion-first content left out (upstream `animations.md`, `performance.md`, enter and exit, stagger, scale on press, icon animation, `agents/openai.yaml`); three rules marked `CONFLICT` or Note (shadows instead of borders, icon stroke table, hit area); the review output section rewritten for atc |

## vercel-labs/web-interface-guidelines (MIT)

```
MIT License

Copyright (c) 2025 Vercel Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## jakubkrehel/make-interfaces-feel-better (MIT)

```
MIT License

Copyright (c) 2026 Jakub Krehel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
