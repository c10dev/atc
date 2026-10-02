# media/intro — atc 소개 영상

[English](README.md) · **한국어**

가상의 FLIGHT 하나(`ATC-42 Add dark mode toggle`, `TEAM_A`)가 Linear 티켓에서 RETURN TO SERVICE까지 가는 약 33초 영상입니다. 코드로 그려서 atc가 바뀌면 다시 렌더링할 수 있습니다. 보여 주는 단계는 모두 지금 atc에 있는 것입니다([dispatch](../../docs/dispatch.ko.md), [mcc](../../docs/mcc.md), [fleet](../../docs/fleet.ko.md)). 자료는 모두 가짜입니다: 실제 티켓·PR·세션·경로가 없습니다.

```
index.html   장면들(HTML/CSS, 결정적인 타임라인 하나: window.seek(t))
render.mjs   타임라인을 프레임마다 그려 ffmpeg로 인코딩
```

## 렌더링

```bash
node media/intro/render.mjs            # 1920×1080 → ~/atc-media/intro/atc-intro-16x9.mp4
node media/intro/render.mjs --square   # 1080×1080 → ~/atc-media/intro/atc-intro-1x1.mp4
node media/intro/render.mjs --frame 12 # t = 12초의 정지 화면 하나(전체를 그리지 않고 장면 확인)
```

옵션: `--fps 30|60`(기본 30), `--out <폴더>`(기본 `~/atc-media/intro`: STAND가 지워져도 남도록 저장소 밖). 전체 렌더링은 몇 분 걸립니다.

결과: H.264 High, yuv420p, 소리 없음, `+faststart`(Chrome과 QuickTime에서 재생), 약 1.5 MB.

## 필요한 것

- Node 24(내장 `WebSocket`으로 DevTools 프로토콜을 통해 Chromium을 조종합니다. npm 패키지를 더하지 않습니다).
- `PATH`에 libx264가 있는 `ffmpeg`.
- Chromium: `CHROME_BIN`, 없으면 `~/.cache/ms-playwright`의 Playwright `chromium_headless_shell`, 없으면 `/usr/bin/chromium`, `/usr/bin/google-chrome`, `/snap/bin/chromium`.

글꼴은 JetBrains Mono, 시스템 monospace, Liberation Mono 가운데 먼저 있는 것이라 호스트마다 글자 폭이 조금 다릅니다.

## 고치기

장면은 `index.html`의 `<section class="scene" data-s data-e>`(시작과 끝, 초)입니다. 안에서 `data-at`은 요소를 서서히 나타내고, `data-type`은 글을 타자로 치고, `data-flip`은 줄에 체크를 하고, `data-slide`는 착륙 점을 움직입니다. `DURATION`과 장면 시간은 합쳐서 25~35초여야 합니다. 색은 `web/src/styles.css`의 radar 테마 토큰입니다.

영상·GIF·프레임은 커밋하지 않습니다(공개 저장소이고 이미지를 두지 않습니다): `.gitignore`가 `media/**/*.mp4`, `*.gif`, `*.png`를 막습니다.
