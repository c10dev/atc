# BROWSER GATE (ATC-520)

[English](browser-gate.md) · **한국어**

세션마다 자기 Playwright MCP 서버가 있고, 각자 headless Chrome을 띄운다. FLIGHT가 몰리면 Chrome이 한꺼번에 떠서 VERIFY GATE의 명령([verify-gate.ko.md](verify-gate.ko.md))과 함께 8 vCPU를 가득 채웠다. gate는 Chrome 프로세스를 짧은 줄에 세운다: 모든 세션을 통틀어 호스트에서 동시에 최대 N개만 돈다.

이 문서의 전체 설명(연결 방법, 켜는 법, 동작, 설정 파일, 기록)은 영어판 [browser-gate.md](browser-gate.md)에 있다. 아래는 ATC-526 내용이다.

## 다른 AIRPORT 저장소 (ATC-526)

이 호스트의 다른 저장소 스크립트가 띄우는 Playwright Chromium은 스크립트가 브라우저 실행 파일을 gate 껍데기로 가리키면 같은 문을 지난다. MCP가 띄운 Chrome과 같은 N개 슬롯, 같은 줄, 같은 세기를 쓰고, 기다림 한도를 넘기면 같은 `BUSY:` 답을 받는다. 실행 파일만 정하면 되고 Playwright와 다른 저장소 코드는 바꾸지 않는다.

껍데기 경로는 atc 운영 체크아웃의 CLI로 찾는다:

```bash
node <atc 체크아웃>/server/browser-gate-cli.ts --print-launcher   # …/deploy/browser-gate/chromium-gated를 낸다
```

그 경로를 그 저장소의 스크립트에 넣는다. 예: `chromium.launch({ executablePath: "<껍데기 경로>" })`, 또는 Playwright 설정의 `launchOptions.executablePath`. `--print-config`는 MCP 설정 안에 같은 경로를 낸다.

- **어느 저장소.** `browser/runs.jsonl`의 각 줄에 `repo`가 남는다: 브라우저를 띄운 폴더가 속한 저장소의 맨 위 폴더 이름(STAND는 본 저장소로 센다. 전체 경로는 기록하지 않는다). 설정 창의 BROWSER GATE 블록은 저장소 폴더 이름별 요청 수를 전체와 최근 7일로 보인다.
- **저장소별 설정.** gate 폴더의 `repos.json`([verify-gate.ko.md](verify-gate.ko.md) "다른 AIRPORT 저장소")에서 저장소마다 진짜 Chrome을 따로 줄 수 있다: `{ "<저장소 폴더 이름>": { "browserExecutable": "/절대/경로/chrome" } }`. 순서는 `ATC_BROWSER_REAL`, 그 저장소 항목, `browser/config.json`의 `realExecutable`, Playwright 캐시. 슬롯·줄·기다림 한도는 모두 공유한다.
- **같은 규칙.** 스위치 `browserGate`(SUPERVISOR만, 기본 켜짐)와 fail-open(`fallback`)은 그대로다.
