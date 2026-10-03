# 경계가 있는 서버 모듈 (설계 초안)

[English](modules.md) · **한국어**

atc 서버는 파일 이름 접두어가 유일한 경계인 272개 모듈이 한 폴더에 있는 구조다. 이 문서는 서버에 **공개 표면이 있는 도메인 폴더**, **하나의 상태 저장소**, **이미 있는 일 레지스트리 옆의 mount 레지스트리**, **진입점에서 한 번 만드는 config**를 주고, 파일을 옮기는 순서를 정해 GO AROUND가 적게 나게 한다. M21 WAYPOINT("경계가 있는 서버 모듈", ATC-336)의 설계다. 이 계획은 어디서도 동작을 바꾸지 않는다.

> Status (2026-10-03): **설계 초안.** 1절에 "이미 끝남"으로 적은 것(ATC-335, 337, 338, 339, 346, 393) 말고는 만든 것이 없다. 8절 "Implementation order" 표는 DUTY가 Linear에 올릴 작업 제안이고, 이 PR은 이슈를 만들지 않는다. 사실은 `origin/main` `b4c44c9` 기준으로 확인했다.

관련 문서:
- [switches.md](switches.md): 스위치·일 레지스트리(ATC-393). 이 설계는 그 위에 쌓고 바꾸지 않는다.
- [dispatch.md](dispatch.md): DISPATCH가 하는 일. 이 문서 9절은 코드가 어디 사는지만 다룬다.
- [mcc.md](mcc.md): LANDING CLEARANCE와 `deploy/landing-tier.mjs`.
- [server/README.md](../server/README.md): 4.3절이 나누는 모듈 표.

## 1. Current facts

2026-10-03, `origin/main` `b4c44c9`에서 다시 확인했다. 작업 지시서(2026-10-02)의 사실 중 ATC-335..339, 346, 393이 바꾼 것은 고쳤다.

**작업 지시서 이후 끝난 것**

| 항목 | 상태 |
|---|---|
| 경계 시험(ATC-335) | `server/boundaries.test.ts`와 `server/web-api-boundary.test.ts`가 `npm test`에서 돈다. 허용 목록 둘(`ALLOWED_CYCLES`, `ALLOWED_WEB_NODE_CHAINS`)은 **비어 있다**: `server/`에 값 import 순환이 없고, 화면의 값 import는 `node:*`·`@hono/*`에 닿지 않는다 |
| 순환(ATC-337, 338, 339) | 12개 모듈 고리와 작은 순환 셋이 없어졌다 |
| 화면 API 클라이언트(ATC-346) | `web/src/api.ts`. `web/src`에서 이 파일 밖에는 `fetch(`가 없다(시험이 지킨다) |
| 스위치·일 레지스트리(ATC-393) | `server/switches/`(26개), `server/jobs/`(19개), `server/job-registry.ts`, `server/declarations.ts`(폴더 읽기). `index.ts`에는 **`setInterval`이 없고** 일을 하나도 나열하지 않는다. `provideService(name, value)`가 일이 import로 닿지 못하는 것을 건넨다 |

**아직 그대로인 것**

| 항목 | 오늘 |
|---|---|
| 배치 | `server/`에 테스트 아닌 `.ts` 272개(`sources/`, `judges/`, `jobs/`, `switches/` 별도). 접두어 묶음: fuel 14개 / 3616줄, duty 20 / 2740, fleet 5 / 2422, control 9 / 1768, schedule 3 / 1521, dispatch 2 / 1532, `proposals.ts` 1630 |
| 순수 / I/O 나눔 | `x.ts` + `x-run.ts` 짝이 있지만 `-run`은 규칙이 아니라 습관이다: 34개 파일이 `renameSync`, 32개가 `appendFileSync`/`appendFile`을 부르고, 60개 파일이 `mountX`를 정의한다(`index.ts`가 `mountX(app, …)`를 60번 부른다). `proposals.ts`(export 78개)는 상수, fold, 게이트, FLIGHT PLAN 글, JSONL 읽기·추가, `runDispatch`, `mountDispatch`를 한 파일에 둔다 |
| 허브(테스트 아닌 importer) | `model.ts`(테스트 포함 172), `config.ts`(99, 테스트 아닌 파일 88), `dispatch.ts`(테스트 아닌 60), `proposals.ts`(42), `dispatch-launch.ts`(8). `server/README*.md` 모듈 표가 가장 많이 고쳐진 문서다 |
| `model.ts` | `Snapshot`을 그리려고 기능 모듈 13개를 type import한다 |
| Config | `config.ts`가 처음 import될 때 `process.loadEnvFile(.env.local)`과 `process.env`를 읽는다. 다른 테스트 아닌 파일 12개가 `process.env`를 직접 읽는다. `test-hermetic.ts`는 시험 파일의 첫 import로 `HOME`과 `ATC_STATE_DIR`를 바꾼다: 잊은 시험은 진짜 상태 폴더를 읽는다(2026-09-30 OOM) |
| 상태 | `ATC_STATE_DIR` 아래 JSON/JSONL 파일 약 40개, 파일마다 읽는 코드와 쓰는 코드가 따로 있다 |
| Mount | `index.ts`가 `mountX` 약 60개를 import해 기능마다 다른 콜백으로 부른다(`mountDispatch(app, getSnapshot, watchFuel, standFree, launcher, briefExtras, routesOf)`). mount 순서는 줄 순서다 |
| 화면 → 서버 | `web/src`에 `from "…/server/…"` import 줄이 188개, 절반쯤이 `import type`이다. 나머지는 순수 함수(`globe.ts`, `fleet.ts`, `fuel-remaining.ts` …)이고 경계 시험이 Node 내장 모듈에 닿지 않게 지킨다 |
| 프로세스 경계 | 관제 세션(`controller/`, `occ/`, `mcc/`, `duty/`)은 `atcctl` HTTP로만 서버에 닿고, 폴더 사이 import는 순수한 몇 개뿐이다. 이 계획은 이것을 건드리지 않는다 |

**이 사실이 설계에 주는 것**

1. 순환 문제는 풀렸고 시험이 지킨다. 설계는 272개 파일이 움직이는 동안 그 상태를 지키기만 하면 된다.
2. 레지스트리의 tick 쪽은 이미 있다(`server/jobs/`). 빠진 것은 HTTP mount 쪽뿐이다(종료 기준 4).
3. "공개 표면"은 두 독자를 섬긴다: 서버 모듈과 브라우저. `proposals.ts`의 I/O를 다시 내보내는 표면은 `node:fs`를 화면 번들에 넣는다. 그래서 표면은 파일이 둘이다(2절).
4. `deploy/landing-tier.mjs`는 PR의 등급을 **파일 경로 그대로**로 정한다(`SIDE_EFFECT`·`READ_ONLY` 목록과 `landing-tier.test.mjs`). 목록에 오른 파일을 옮기면 `deploy/`를 고치게 되어 등급이 `user`다. 옮기는 계획은 이것을 감안해야 한다(7절).

## 2. Principles

1. **경계마다 규칙 하나, 이미 있는 시험이 지킨다.** 문서에만 있는 경계는 없는 경계다. 3절의 모든 규칙은 `server/boundaries.test.ts`(ATC-335)에 **줄기만 하는** 허용 목록과 함께 더한다(순환 규칙과 같은 방식).
2. **도메인은 폴더이고 폴더에는 문이 둘이다.** `index.ts`는 서버 쪽 공개 표면이다. `view.ts`는 화면이 가져도 되는 표면이다: 타입과 순수 함수만, Node 내장 모듈·`store/`·`sources/` 없음. 다른 도메인과 `web/`은 그 문으로만 도메인을 가져온다.
3. **순수 코드는 순수하게.** 계산은 I/O를 import하지 않는 파일에 둔다. I/O는 `-run.ts`와 `store/`, `sources/`에, HTTP는 `mount.ts`에 둔다. CLAUDE.md의 "계산은 순수 함수로 두고 입출력과 나눈다"를 검사할 수 있게 한 것이다.
4. **레지스트리는 폴더를 읽는다. 파일을 나열하지 않는다.** ATC-393의 방식: 기능을 더하는 것은 파일을 더하는 것이고 공유하는 줄은 바뀌지 않는다. mount 레지스트리(4절)와 상태 레지스트리(5절)가 따른다.
5. **옮기기는 싸게, 고치기는 따로.** PR은 순수 `git mv`와 기계적인 import 고치기이거나, 고치기이거나 둘 중 하나다. 둘을 섞지 않는다(7절).
6. **형식과 동작은 안 바뀐다.** 같은 라우트가 같은 순서로, 같은 tick 순서, 같은 상태 파일이 바이트까지 같고, 환경 변수 이름과 기본값도 같다. 이 중 무엇이든 바뀌는 일은 범위 밖이고 따로 올린다.
7. **권한은 영향 범위를 따른다.** 착륙이나 LAUNCH에 닿을 수 있는 것(guard, `deploy/`, `server/jobs/`, `server/switches/`, 이 계획에서 더해지는 `server/mounts/`와 `server/store/registry.ts`)은 사람이 보는 등급을 유지한다.

## 3. Target layout and import rules

### 3.1 폴더

```
server/
  index.ts            진입: boot, config 만들기, 레지스트리 읽기, serve
  boot.ts             환경을 읽는 유일한 모듈(6절)
  shared/             여러 도메인이 쓰는 타입과 작은 순수 helper(model.ts, callsign, registration, linear-keys …)
  store/              json.ts, jsonl.ts, registry.ts(5절)
  sources/            기존: Claude, Codex, git, Linear, GitHub 읽기(I/O)
  jobs/  switches/    기존 레지스트리(ATC-393), 그대로
  mounts/             과도기의 mount 파일 하나씩 폴더(4절). 도메인이 mount를 가져가면 비어 간다
  dispatch/           DISPATCH(9절)
  schedule/           schedule, routes, network, milestones, waypoint-*
  fuel/               fuel*, 그리고 logbook의 비용 부분
  duty/               duty-*
  landing/            landing, autoland, mcc, pr-merge, human-check, codex-*, migration-*, auto-revert
  fleet/              fleet, control, crew, session-control, fresh-start, accounts, launch-*, health, relay
  radio/              radio, globe, voice, tts, squelch, follow, notices, supervisor-alerts
  core/               snapshot, tick, events, activity, occupancy, status, home, metrics(README "The loop"의 루프)
```

위 배정은 접두어 묶음으로 한 **출발점**이지 파일 목록이 아니다. 도메인을 옮기는 PR의 첫 커밋("survey", 7절)이 진짜 import 그래프로 정확한 파일 목록을 만들고 도메인의 `README.md`에 적는다. 세 도메인 이상에서 import되는 파일은 `shared/`로, 한 도메인만 쓰는 파일은 그 도메인으로 간다.

도메인 안:

```
server/<domain>/
  index.ts         서버 표면: 다른 도메인이 쓰는 것만 이름으로 다시 내보낸다(`export *` 없음)
  view.ts          화면 표면: 브라우저가 가져오는 타입과 순수 함수. 값 그래프에 Node 내장 모듈 없음
  <name>.ts        순수 코드(계산, fold, 게이트, 글)
  <name>-run.ts    I/O(store/로 파일, 프로세스, sources/로 네트워크)
  mount.ts         HTTP: default export defineMount({...})(4절)
  <name>.test.ts   시험은 코드 옆에
  README.md, README.ko.md   도메인의 모듈 표(4.3절)
```

`jobs/`와 `switches/`는 최상위 폴더로 남는다. 일 파일은 제 도메인의 `index.ts`를 import한다. 한곳에 두면 `deploy/landing-tier.mjs`의 등급 규칙이 그대로다.

### 3.2 import 규칙 (`server/boundaries.test.ts`를 넓힌다. 바꿔치지 않는다)

규칙마다 그 파일이 이미 만드는 import 그래프(`buildGraph`, `findCycles`)를 쓰는 시험이고, 추적 중인 소스만 읽는다. 시험 파일에 `*_ALLOWED` 목록이 있어서 규칙이 들어오는 날의 현재 위반을 적고 이후로는 늘리지 않는다.

| # | 규칙 | 시작 |
|---|---|---|
| R1 | `server/`에 값 import 순환 없음(있음) | 허용 목록 비어 있음(있음) |
| R2 | `web/src`에서 `node:*`·`@hono/*`로 가는 값 import 길 없음(있음) | 허용 목록 비어 있음(있음) |
| R3 | 화면(`web/src`)은 도메인을 `<domain>/view.ts`로만 import한다. 도메인에 아직 안 들어간 최상위 모듈은 그 도메인이 가져갈 때까지 예외 | 허용 목록 = 옮겨진 파일에 대한 오늘의 `web → server/<파일>` import |
| R4 | 도메인 A의 파일은 도메인 B를 `B/index.ts`로만 import한다(type import 포함, 예외는 R6 하나). `shared/`, `store/`, `sources/`는 층이다: 도메인을 import하지 않고 `shared/`는 `store/`·`sources/`도 import하지 않는다 | 허용 목록 = 도메인 이동이 들어오는 날의 도메인 사이 깊은 import, 뒤 도메인 이동마다 비운다 |
| R5 | **순수 파일은 I/O를 import하지 않는다.** `*-run.ts`, `mount.ts`, `index.ts`, `store/`, `sources/`, `jobs/`, `switches/`가 아닌 파일은 `node:fs`, `node:child_process`, `node:net`, `node:http(s)`, `store/`, `sources/`를 값 import하지 못하고 `-run.ts`도 import하지 못한다(경로 계산의 `node:path`, `node:url`, `node:os`는 허용) | 허용 목록 = 2026-10-02에 잰 오늘 I/O를 하는 `-run` 아닌 파일 55개(다시 재지 않았고 N0가 다시 계산한다), 도메인을 나눌 때마다 준다 |
| R6 | `shared/model.ts`는 `<domain>/view.ts`에서만 `import type` 할 수 있다(6절, 결정 D4) | 지금의 type import 13개로 시작 |
| R7 | 상태 쓰기: `renameSync`, `appendFileSync`, `writeFileSync`, `mkdirSync`는 `store/` 안과, 이름을 적은 짧은 비상태 쓰기 목록(캐시, WAV, git worktree)에만 | 허용 목록 = 오늘 쓰는 34 + 32개 파일, S1·S2로 준다 |
| R8 | `boot.ts`, `config.ts`(순수 `configOf(env)`), 허용한 진입 스크립트 밖에서 `process.env`나 `.env.local`을 읽지 않는다 | 허용 목록 = 오늘 읽는 12개 파일 |

R1–R2는 있다. R3–R6은 첫 도메인 이동(9절)과 함께, R7은 저장소(5절)와, R8은 config 주입(6절)과 함께 들어온다. 규칙은 **그 규칙이 적어도 한 파일에 대해 참이 되는 PR**에서 더하고 나머지는 허용 목록에 둔다. 그래서 시험이 빨갛게 되는 일이 없다. 시험 파일에는 규칙마다 실패했을 때 할 일(코드를 옮기거나 파일을 나눈다. 허용 목록에 더하지 않는다)을 한 문단으로 적는다.

## 4. Registry: mounts and ticks

### 4.1 tick은 끝났다

`server/jobs/`와 `createJobRunner`(ATC-393)가 원래 "기능 레지스트리"의 tick 쪽을 이미 한다: 일은 파일 하나 `defineJob({ name, every | tick | start, order, run })`이고 `index.ts`는 아무것도 나열하지 않으며 실패는 일마다 로그로 남는다. 이 설계는 tick에 **아무것도** 더하지 않는다. 남은 것: 도메인이 생기면 일 파일이 그 도메인의 `index.ts`를 import한다(그 도메인 이동 PR의 기계적 고치기).

### 4.2 Mount

mount는 default export가 있는 파일 하나이고, 일·스위치처럼 폴더를 읽어 찾는다:

```ts
// server/mounts/dispatch.ts  (나중에: server/dispatch/mount.ts)
import { defineMount } from "../mount-def.ts";
export default defineMount({
  name: "dispatch",
  order: 200,                       // 라우트 등록 순서. 기본 1000, 같으면 이름 순
  mount: (app, deps) => mountDispatch(app, deps.getSnapshot, deps.service("fuelWatch"), …),
});
```

- `defineMount`, `MountDecl`, `MountDeps`(`getSnapshot()`, `service<T>(name)`, `config`)는 `server/mount-def.ts`에 둔다(타입만, 모든 도메인이 import 가능). `server/mount-registry.ts`는 기존 `loadDeclarations(dir, isDecl, what)`로 선언을 읽고 `job-registry.ts`처럼 이름이 겹치면 거절한다.
- **읽는 곳.** `server/mounts/*.ts`(N1 단계)와 `server/*/mount.ts`(첫 도메인 이동부터). `server/mounts/`가 빌 때까지 둘 다 읽고, 비면 폴더를 지운다.
- **기능 콜백 대신 서비스.** `mountDispatch`는 지금 콜백 다섯을 받는다. `index.ts`가 만드는 객체들(watchFuel, standFree hooks, launcher, brief extras, routes loader)이다. `index.ts`는 각각 `provideService(name, value)`를 부르고(일이 이미 쓰는 방식) mount 파일은 `deps.service(name)`으로 받는다. 그러면 `index.ts`는 **기능을 하나도 나열하지 않는다**: 서비스를 만들고, 두 레지스트리를 읽고, 정적 서버를 맨 마지막에(모든 경로를 받으므로) mount하고, serve한다.
- **순서는 우연이 아니라 명시.** 같은 경로에 맞을 수 있는 두 라우트(`/api/x/:id`가 리터럴 `/api/x/summary`보다 앞서는 경우)에서만 등록 순서가 중요하다. 레지스트리는 `order`, 이름 순으로 정렬하고, 첫 mount PR이 오늘의 순서를 10 단위 `order`로 적는다. 안전망은 진짜 레지스트리에서 `app.routes`(메서드, 경로)를 뽑아 커밋한 목록(`server/mounts/routes.golden.txt`)과 비교하는 시험이다. 라우트를 더하는 PR은 이 목록에 줄 하나를 더하고, 두 PR이 같은 자리에 라우트를 더하지 않는 한 깨끗이 합쳐지며, 검토자에게는 "라우트가 바뀐다"는 명시적 신호다.
- **등급.** mount 파일은 import 스캔이 못 보는 서비스 이름으로 부작용에 닿을 수 있다. `server/jobs/`를 강조 등급으로 둔 것과 같은 이유다. N1 PR이 `deploy/landing-tier.mjs`의 `FLAGGED`에 `[/^server\/mounts\//, …]`를 더하고(그래서 N1 자체가 `user`), 도메인 `mount.ts`는 `^server\/[a-z-]+\/mount\.ts$` 패턴을 얻는다.

### 4.3 README 모듈 표

`server/README.md`와 `README.ko.md`에는 루프, sources 표, **도메인당 한 줄**(`server/<domain>/README.md` 링크)만 남는다. 모듈 표는 그 폴더별 파일로 옮겨가서, 파일을 더하는 PR은 제 도메인 README만 고친다. 루트 목록은 도메인을 더할 때만 바뀐다. 코드에서 표를 만드는 방법은 검토했지만 고르지 않았다: 생성기는 깨질 곳이 하나 더 늘고 표의 글은 목록이 아니라 설명이기 때문이다. 도메인 README는 제목 넷이 같다: Surface(`index.ts` 이름), Web surface(`view.ts`), Modules(파일마다 한 줄), State files(레지스트리의 이름).

## 5. State store

목표(종료 기준 3): `ATC_STATE_DIR` 아래 모든 상태 파일을 모듈 하나로 쓰고 레지스트리 하나에 올린다. 형식은 그대로.

```
server/store/
  json.ts       readJson<T>(file, fallback), writeJson(file, value)   원자적: <file>.<pid>.tmp에 쓰고 rename
  jsonl.ts      appendLine(file, obj), readLines<T>(file, opts), foldLines(file, reducer, init)
  registry.ts   STATE_FILES: { name, kind, owner, format }[]  와  stateFile(name) -> handle
```

- **경로가 아니라 handle.** `json.ts`와 `jsonl.ts`는 `stateFile("proposals.jsonl")`의 handle을 받고, 레지스트리에 없는 이름이면 던진다. 새 상태 파일은 레지스트리 항목 없이 쓸 수 없고, 레지스트리가 코드와 어긋날 수 없다. 모듈이 갖지 않은 파일 읽기(다른 도메인 파일을 `readJson`)는 R4에 따라 그 도메인의 `index.ts`를 통해서만 한다.
- **항목 칸.** `name`(상태 폴더 아래 파일 이름, 폴더는 `/`로 끝남), `kind`(`json` | `jsonl` | `dir` | `text`), `owner`(도메인), `format`(한 줄: 모양, 핵심 칸, fold 방식). `jsonl` 항목은 깨진 줄을 건너뛰는지 던지는지도 적는다. 오늘의 읽기 코드가 서로 다르고 저장소가 각각의 동작을 지켜야 하기 때문이다(`readLines(file, { onBad: "skip" | "throw" })`).
- **같은 바이트.** 오늘의 쓰기 코드가 서로 다르므로 저장소 함수는 들여쓰기(`JSON.stringify(v, null, 2)` 또는 한 줄)와 끝 줄바꿈을 매개변수로 받는다. S1·S2는 같은 입력의 출력 바이트가 같다는 시험(`server/store/*.test.ts`의 파일 종류별 골든 문자열)이 있을 때만 쓰기 코드를 옮긴다.
- **형식이 바뀌면 레지스트리가 알린다.** `server/store/registry.ts`를 `deploy/landing-tier.mjs`의 `user` 목록에 올린다(S1에서). 상태 파일을 더하거나 `kind`를 바꾸거나 `format` 글을 고치는 것은 이 파일을 고치는 일이므로 PR이 `user` 등급이고 CLAUDE.md에 따라 "Behavior change" 절을 둔다. 레지스트리를 안 건드리고 파일 모양을 바꾸는 쓰기 코드는 골든 바이트 시험이 깨져서 검토에서 잡힌다.
- **다른 쓰기.** 캐시(`cacheDir`), WAV, git worktree, `claude` 설정 폴더는 `ATC_STATE_DIR` 아래 상태가 아니다. R7의 허용 목록에 하나씩 이름을 적는다.
- **순서.** JSONL 먼저(S1: 자체 `append`/`record`가 있는 모듈 18개, "추가만"이 가장 중요한 곳), JSON 다음(S2: tmp + rename을 쓰는 27개 파일). 레지스트리는 S1에서 모든 파일을 알고 만들어서 S2는 쓰기 코드만 옮긴다.

## 6. Config injection and `model.ts`

### 6.1 Config

- `server/config.ts`는 **순수** `configOf(env, home): Config`와 `Config` 타입을 내보낸다. 아무것도 읽지 않는다. 환경 변수 이름과 기본값은 오늘 그대로다.
- `server/boot.ts`가 읽는 유일한 곳이다: `.env.local`을 읽고(출력하거나 복사하지 않는다), `configOf(process.env, homedir())`로 config를 만들어 `setConfig(config)`를 부른다. `index.ts`는 `./boot.ts`를 **맨 먼저** import한다. ES 모듈은 본문 전에 import를 평가하므로 `test-hermetic.ts`와 같은 수법이다.
- `setConfig`가 안 불렸을 때 `getConfig()`는 `config not set`을 던진다. 이전 동안 `export const config`는 접근할 때 `getConfig()`를 부르는 getter 객체가 되어 `config.stateDir`를 쓰는 88개 파일이 그대로 컴파일된다. import 시점에 `config.*`를 읽는 모듈(최상위 `const FILE = join(config.stateDir, …)`)은 불러올 때 던지게 되므로, C1 단계가 getter보다 먼저 그런 곳을 찾아(grep으로 찾을 수 있는 모양) 함수 호출로 바꾼다.
- **시험.** `test-hermetic.ts`는 `testConfigOf(tmp)`를 만들어 `setConfig`를 부르는 얇은 helper가 된다. 잊은 시험은 운영 상태 폴더가 아니라 예외를 받는다. 시험 하나가 증명한다: 서버 모듈 몇 개를 `setConfig` 없이 자식 프로세스에서 import해 `config.stateDir`에 닿으면 던지는지 본다(2026-09-30 같은 일이 조용히 다시 나지 않는다). R8은 `boot.ts` 밖의 새 `process.env` 읽기를 막고, 기존 12개는 도메인별로 옮긴다.
- **도메인별 묶음 이전**(C2..): 도메인마다 PR 하나가 그 도메인의 `process.env` 읽기를 `configOf`로 옮기고 순수 함수에 config를 매개변수로 넘긴다. 묶음은 파일을 옮기지 않는다. 도메인 이동 PR과 그 config 묶음은 다른 PR이다.

### 6.2 `model.ts`의 방향

두 안을 견주었다: (a) `Snapshot`이 조립하는 기능 조각(각 도메인이 `declare module`로 인터페이스를 늘림), (b) type import를 둔다. **결정 D4: type import를 둔다.** `shared/model.ts`로 옮기고 R6으로 `<domain>/view.ts`에서만 가져오게 한다.

이유: type import는 지워지므로 R1이 보는 값 그래프의 간선이 아니고 실행에 드는 비용이 없다. 모듈 증강은 `Snapshot`의 모양이 컴파일러가 어떤 파일을 포함하느냐에 달리게 하고 `model.ts`를 읽는 사람에게서 전체 모양을 숨긴다. R6은 의존이 화면이 가져도 되는 파일을 가리키게 해서 `shared`가 도메인의 속사정을 모르게 한다. `shared/model.ts`는 스냅샷에 무엇이 들었는지 적는 단 한 곳으로 남는다. 도메인의 조각 타입이 자기 파일이 필요할 만큼 커지면 그 도메인의 `view.ts`로 간다.

결과: `shared → domain` type 간선이 있고 도메인은 `shared/model.ts`의 타입을 되돌려 import한다. TypeScript가 허용하고 R1은 세지 않는 타입 수준의 순환이다. R6이 `view.ts`로 한정하고 `view.ts`는 원칙 2에 따라 I/O를 import하지 않으며(R5에 따라) `-run` 파일도 import하지 않으므로 받아들일 수 있다.

## 7. Move order that keeps GO AROUNDs low

옮기기는 그 파일을 고치거나 그 파일의 import 줄을 고치는 모든 FLIGHT와 부딪친다. 9월의 GO AROUND는 몇 개 허브에 몰렸다(15개 중 11개가 설정과 `index.ts` 핫스팟, [switches.md](switches.md)). `proposals.ts`(테스트 아닌 importer 42)를 그냥 옮기면 모든 FLIGHT가 한꺼번에 부딪친다. 계획:

1. **도메인마다 PR 묶음 하나, 허브는 먼저, 작은 도메인은 일찍.** 첫 이동은 DISPATCH(9절)다. 가장 바쁜 코드에서 배치를 증명하기 때문이다. 그다음은 importer가 적은 순서로, 허브를 그 호출자와 함께 옮기지 않는다: `radio`, `fuel`, `schedule`, `duty`, `landing`, `fleet`, `core`. `shared/`와 `store/` 뽑기는 도메인의 일부가 아니라 제 단계(S1, S2, C1)로 한다.
2. **도메인 이동 PR은 한 PR에 커밋 세 종류를 이 순서로 둔다:**
   1. *survey*(문서만, `server/<domain>/README.md` + 정확한 파일 목록);
   2. 파일과 시험의 *순수 `git mv`*, **내용 변경 없음**(그러면 git이 이름 바꾸기를 100% 유사도로 기록해서 그 파일을 고치던 FLIGHT가 이름 바꾸기를 따라 합쳐진다);
   3. *import 고치기*: importer의 지정자를 기계적으로 고친다(`./proposals.ts` → `./dispatch/index.ts`, 하위 폴더에서는 `../dispatch/index.ts`). 새 `index.ts`/`view.ts`, 경계 규칙, 골든 확인도 여기서 더한다. 논리는 없고 `git diff --word-diff`와 스크립트로 검토할 수 있다.

   옮긴 코드를 고치는 일(순수와 I/O 나누기, 이름 바꾸기, `mount.ts`)은 **나중 PR**이고 이동 PR에 넣지 않는다.
3. **옛 경로에 다시 내보내기(shim)를 두지 않는다.** shim은 옛 경로를 작은 새 파일로 살려 두므로 git은 `proposals.ts`를 *이름이 바뀐 것*이 아니라 *고쳐진 것*으로 보고, 옛 경로를 고치던 FLIGHT는 이름 바꾸기를 따라가지 못하고 충돌한다. shim을 안 두는 값은 importer의 import 줄 충돌인데, 한 줄이고 기계적이며 아래 GO AROUND 규칙이 다룬다. (검토한 대안: `package.json` `imports` 별칭이나 몇 주 동안 shim. 위 이유로 고르지 않았고 SUPERVISOR가 뒤집을 수 있게 결정 D2로 적는다.)
4. **판이 조용할 때 착륙.** 시작 전과 PR을 열기 전에, 그 도메인 파일을 열어 둔 다른 FLIGHT가 없는지 확인한다(OVERLAP / FLEET이 진행 중인 파일을 보인다. [dispatch.md](dispatch.md)의 "file overlap"). 있으면 이동은 그 FLIGHT가 착륙할 때까지 기다리거나 `merge origin/main`으로 맞춘다. DISPATCH가 도메인 파일이 비기 전까지 이동 FLIGHT를 잡아 두는 기능("MOVE" FLIGHT 종류)은 후속(8절 N10)이고 첫 이동에는 필요 없다.
5. **이동과 충돌한 GO AROUND(ATC-128 규칙 그대로).** `READBACK C-xxxx`, `git merge origin/main`(rebase 없음). 이동과 진행 중 FLIGHT의 충돌은 **FLIGHT 쪽에서** 푼다. FLIGHT가 더 작은 변경이기 때문이다: 이동의 경로를 취하고, FLIGHT의 고침을 새 경로의 파일에 다시 적용하고(내용 고침이면 `git mv`의 이름 바꾸기 감지가 보통 해 준다), import 줄 충돌은 옮겨진 지정자를 취한다. FLIGHT와 이동이 같은 논리 줄을 고쳤다면 FLIGHT 팀이 ATC-128대로 `UNABLE C-xxxx — …`로 답하고 이동 PR이 기다린다. 이동을 FLIGHT에 맞춰 다시 쓰지 않는다.
6. **이동 PR의 등급.** `deploy/landing-tier.mjs`는 경로 그대로 맞추므로 이동 PR의 등급은 가장 높은 경로의 등급이다: `SIDE_EFFECT`·`READ_ONLY`에 있는 파일을 옮기면 그 항목 이름을 바꿔야 하고(`deploy/` 수정, 등급 `user`), 명령을 돌리면서 목록에 없는 파일은 `landing-tier.test.mjs`가 막는다. survey 커밋이 도메인의 목록 파일을 적는다. 등급은 **importer**도 센다: import 고치기 커밋이 옮긴 파일을 import하는 모든 파일을 고치고, `server/switches/*`는 폴더 때문에 `user`, `server/jobs/*`는 `flagged`다. DISPATCH 핵심(`dispatch.ts`, `dispatch-launch.ts`, `proposals.ts`는 목록에 없다)은 스위치 파일 7개와 일 파일 2개가 import하므로 P1은 `user`다(9.5).
7. **그래도 부딪치는 것.** `docs/*.md`와 `server/README*.md`가 옛 경로를 링크한다(`docs/dispatch.md`, `docs/radio.md`, `docs/follow.md` …). 이동 PR이 같은 PR에서 링크를 고친다(`server/<옛 이름>` grep). 낡은 링크는 시험 실패가 아니라 문서 버그이므로, survey 커밋이 옛 경로를 적은 모든 파일을 적는다.

## 8. Implementation order

DUTY가 올릴 작업 지시서다. **이 PR은 하나도 올리지 않는다.** 등급은 `deploy/landing-tier.mjs`에서 예상하는 등급이고, wake는 Linear의 크기 라벨(S/M/L/H)이다. "있음"은 M21에 이미 있는 이슈다.

| 단계 | 작업 지시서 | 범위 | 등급 | Wake | M21 종료 기준 |
|---|---|---|---|---|---|
| N0 | 경계 규칙 R3–R8 뼈대: R3, R4, R5, R7, R8 시험을 오늘 그래프로 계산한 허용 목록과 함께 모두 초록으로, 규칙마다 주석 | `server/boundaries.test.ts`만 | auto | M | 1(넓힘), 2·5·6 받침 |
| N1 | `server/mount-def.ts`, `mount-registry.ts`, `declarations` 재사용. `index.ts`가 레지스트리를 돈다. 모든 `mountX` 호출이 `server/mounts/<name>.ts`가 된다. `app.routes` 골든 파일. PR에 전후 라우트 목록 | `server/index.ts`, 새 파일, `deploy/landing-tier.mjs`(FLAGGED `server/mounts/`) | user | L | 4 |
| ATC-345 (P1) | 첫 도메인 이동: DISPATCH(9절): survey, `git mv`, import 고치기, `index.ts`/`view.ts`, `dispatch/`에 R3/R4 켜기 | `server/dispatch/` + importer(`server/switches/` 7개, `server/jobs/` 2개 포함) + 화면 type import 3개 + 시험 | user(9.5) | H | 6 |
| P2 | DISPATCH 나누기: `proposals.ts`를 순수 `proposals.ts`, `proposals-run.ts`(읽기/추가/`runDispatch`), `mount.ts`(`mountDispatch`를 `mounts/`에서 옮김)로. `dispatch/README.md` 모듈 표 | `server/dispatch/`만 | flagged(mount) | H | 4, 6 |
| ATC-340 (S1) | 저장소: `store/jsonl.ts`, 모든 상태 파일이 있는 `store/registry.ts`, JSONL용 R7. JSONL 쓰기 코드 18개를 파일별 골든 바이트와 함께 옮김 | `server/store/`, 쓰기 코드 | user(`deploy/`의 레지스트리) | H | 3 |
| ATC-341 (S2) | 저장소: `store/json.ts`, 원자적 JSON 쓰기 27개 옮김 | `server/store/`, 쓰기 코드 | auto | M | 3 |
| C1 | Config: `configOf`, `boot.ts`, getter 기반 `config`, 던지는 `getConfig`. import 시점 읽기 고치기. hermetic helper가 `testConfigOf`를 만든다. 잊은 config가 운영에 닿지 못함을 증명하는 시험 | `server/config.ts`, `boot.ts`, `index.ts`, `test-hermetic.ts` | auto | H | 5 |
| ATC-343 (C2..) | 도메인별 config 묶음: 직접 `process.env` 읽기 12개를 옮기고 순수 함수에 config를 넘김. R8 허용 목록을 0으로 | 도메인별 | auto | 각 M | 5 |
| ATC-342 (재편) | mount는 N1이 흡수한다. ATC-342에 남는 것(폴더별 README 표)은 도메인 이동마다 한다(4.3절). N1과 P1이 착륙하면 닫는다 | — | — | — | 4 |
| P3..P8 | 도메인 이동 하나씩, 7.1절 순서: radio, fuel, schedule, duty, landing, fleet, 그다음 `core/`. 각각 survey + `git mv` + import 고치기 + 그 도메인의 R3/R4, 이어서 `-run`과 `mount.ts`의 나누기 PR | 도메인별 | auto, survey가 `deploy/` 경로를 적으면 user | 각 H | 6(첫 도메인)과 배치 |
| X1 | `shared/` 뽑기: `model.ts` → `shared/model.ts`와 R6. callsign, registration, linear-keys, address, origin … importer 수 순서로 | `server/shared/` + importer | auto | H | 6 받침 |
| N9 | R5 비우기(I/O를 하는 순수 파일): 도메인마다 그 나누기 PR의 일부로 | 도메인별 | auto | — | R5 0 |
| N10 | 선택: 도메인 파일이 비기 전까지 이동을 잡아 두는 DISPATCH의 MOVE FLIGHT 종류 | `server/dispatch/` + 문서 | flagged | M | — |

**M21 종료 기준마다 단계가 있다**

| M21 종료 기준 | 단계 | 상태 |
|---|---|---|
| 1. 경계 시험이 새 순환과 화면 → Node I/O에서 실패하고 허용 목록은 줄기만 한다 | ATC-335(끝남). N0가 같은 방식으로 R3–R8을 더한다 | 끝남 / N0 |
| 2. `server/`에 값 import 순환 없음(허용 목록 비어 있음) | ATC-337, 338, 339(끝남). 모든 이동 PR이 `npm test`를 돌리므로 R1이 이동 내내 지킨다 | 끝남. R1이 지킨다 |
| 3. 모든 상태 파일을 저장소 모듈 하나로 쓰고 레지스트리 하나에 올림, 형식 그대로 | ATC-340(S1), ATC-341(S2), R7 | S1, S2 |
| 4. 기능이 제 mount와 tick을 등록한다. 기능을 더해도 `index.ts`와 README 표를 안 고친다 | tick: ATC-393(끝남). mount: N1, P2. README 표: 도메인 이동마다 폴더별 | N1, P1, P2 |
| 5. `config.ts`가 import 때 환경을 읽지 않는다. 모듈이 config를 받는다. 시험이 운영 상태 폴더에 닿지 못한다 | C1, ATC-343(C2..), R8 | C1, C2.. |
| 6. `docs/modules.md` 머지, DISPATCH가 다른 모듈이 import하는 공개 `index.ts`가 있는 제 폴더에 산다 | 이 문서(ATC-336), ATC-345(P1) | 이 PR, P1 |
| 7. 화면이 API를 타입 있는 클라이언트 모듈 하나로 부른다 | ATC-346(끝남, `web/src/api.ts`, `web-api-boundary.test.ts`) | 끝남 |

**의존.** N0가 먼저다(시험만 더한다). N1과 P1은 서로 독립이라 같이 날 수 있고, P2(`mountDispatch`를 `proposals.ts`에서 빼는 일)는 둘 다 기다린다: P1이 DISPATCH 코드를 옮기고 N1이 mount가 살 파일을 준다. S1이 S2보다 먼저. C1이 C2.. 보다 먼저. 도메인 이동 P3..은 각각 P1(배치 증명)과 N0(규칙)을 기다린다. X1은 도메인 이동 둘 이상을 기다려서 `shared/`가 진짜 importer 수로 잘리게 한다. ATC-345는 이 PR만 기다린다: 그것이 `server/dispatch/` 한 접두어에 R3과 R4를 켜고, N0가 그것을 모든 도메인으로 넓힌다.

## 9. The first domain move: DISPATCH (ATC-345, fly-ready)

### 9.1 무엇이 옮겨가나

| 오늘 | `server/dispatch/` 안 | 줄 | 테스트 아닌 importer |
|---|---|---|---|
| `server/dispatch.ts` (+ `dispatch.test.ts`, `dispatch-alerts-key.test.ts`) | `dispatch.ts` | 1184 | 60 |
| `server/dispatch-launch.ts` (+ `dispatch-launch.test.ts`) | `dispatch-launch.ts` | 348 | 8 |
| `server/proposals.ts` (+ `proposals.test.ts`, `proposals-close.test.ts`) | `proposals.ts` | 1630 | 42 |

파일 이름은 그대로다(100% 유사도의 `git mv`. 되풀이되는 단어를 떼는 이름 바꾸기는 나중의 별도 PR). P1에서 안 옮기는 것: `release*`, `briefs`, `briefing`, `crosscheck`, `reasons`, `response`, `preflight`, `readiness`, `standfree*`, `overlap-run`, `departures`, `issue-notes`, `atfm*`, `pr-holder*`, `k-approval`, `k3-*`, `judges/dispatch.ts`. DISPATCH의 곁가지이고 survey 커밋이 `dispatch/`와 `shared/` 중 어느 쪽인지 갈라 P3 같은 후속 PR에 넘긴다. 40개 파일을 핵심과 함께 옮기면 P1이 모든 FLIGHT와 부딪친다. P1은 핵심 세 파일과 그 시험이다.

### 9.2 공개 표면

`server/dispatch/index.ts`는 이름을 하나씩 적은 다시 내보내기 목록이다(`export *` 없음). 목록은 짐작이 아니라 계산한다: 옮기는 세 파일 **밖의 테스트 아닌 파일**이 그 셋에서 import하는 이름을 모으는 스크립트를 survey 커밋에서 돌리고 PR 본문에 남긴다. `b4c44c9`에서 잰 값: `proposals.ts`에서 값 이름 21개와 타입 2개, `dispatch.ts`에서 46개와 12개, `dispatch-launch.ts`에서 27개와 6개(세 파일이 서로 import하는 것을 포함하고 겹치는 이름이 있다), 전체 export는 195개. 목록에 없는 이름은 모듈 안쪽에 남고 나중 PR이 export를 뗄 수 있다. 도메인 안의 시험은 파일을 직접 import하고, 밖의 시험은 `index.ts`를 import한다.

`server/dispatch/view.ts`는 화면이 가져도 되는 부분집합이다. 화면이 지금 import하는 이름은 셋이고 모두 `import type`이다: `Proposal`(`web/src/FlightDispatch.tsx`), `AbsentAircraft`(`web/src/views/fleet/Absent.tsx`, `Fleet.tsx`). `view.ts`는 정확히 그 타입을 다시 내보내고 화면 파일 셋은 지정자를 `…/server/dispatch/view.ts`로 바꾼다. `proposals.ts`는 `node:fs`를 import하므로 화면이 그것을 **값**으로 import할 수는 없다(R2가 실패). 화면이 나중에 값으로 필요로 하는 이름이 I/O 있는 파일에 있다면 `view.ts`를 넓히지 말고 P2에서 그 파일을 나눈다는 신호다.

### 9.3 팀이 할 일

1. **판 확인**(OVERLAP, FLEET): `dispatch.ts`, `dispatch-launch.ts`, `proposals.ts`, 그 시험을 diff에 둔 다른 FLIGHT가 없는지. 있으면 OCC에 STANDBY를 보내고 기다린다. PR을 열기 전에 다시 확인한다.
2. **survey 커밋**(문서와 스크립트 출력만): `server/dispatch/README.md`와 `.ko.md`에 파일 목록, 표면 목록(스크립트 출력), 화면 import 목록, 옮긴 파일 이름을 적은 `deploy/landing-tier.mjs` 경로(예상: 없음), `server/switches/`·`server/jobs/`의 importer(등급을 정한다), 고칠 문서·README 링크(`grep -rn "server/\(proposals\|dispatch\|dispatch-launch\)" docs server/README*.md README*.md`).
3. **`git mv` 커밋**: 세 파일과 시험 다섯 개를 `server/dispatch/`로. 내용 변경 없음. `git diff -M --stat origin/main`이 옮긴 파일을 모두 유사도 100%의 이름 바꾸기로 보여야 한다. 아니면 멈춘다.
4. **고치기 커밋**: 모든 importer의 지정자를 바꾼다. `server/dispatch/` 안에서 옮긴 파일끼리는 전처럼(`./dispatch.ts`) import하고, 다른 모듈을 import하는 줄은 `../`가 하나 늘어난다. 그 밖의 모두는 `…/dispatch/index.ts`를 import하고 `web/`은 `…/server/dispatch/view.ts`를 import한다. `index.ts`와 `view.ts`를 더한다. 버리는 스크립트로 하고 PR에 보인다. 논리를 손으로 고치지 않는다.
5. **규칙 커밋**: `server/boundaries.test.ts`에 `dispatch/`용 R3과 R4를 더한다(다른 도메인이 아직 없으므로 규칙은 리터럴 접두어 하나이고, N0가 넓힌다). 남는 깊은 import 허용 목록은 `dispatch/`에 대해 비어 있을 것으로 예상.
6. **문서 커밋**: 2단계에서 찾은 링크를 고친다. `docs/dispatch.md`와 `.ko.md`에 한 줄 "Code: `server/dispatch/`", `server/README.md`와 `.ko.md`에 도메인 한 줄 포인터를 두고 DISPATCH 줄은 `server/dispatch/README.md`로 옮긴다. `changelog.d/ATC-345.md`와 `.ko.md`(`Changed`, "동작 변경 없음").
7. **검증**(세 가지에 아래 두 diff).
   - `npm test`, `npx tsc --noEmit -p .`, `npx vite build`, `node --test deploy/`(landing tier).
   - 시험 서버(Skill `test-server`, 7702, 복사한 상태 폴더): `GET /api/dispatch/brief`와 DISPATCH 패널의 엔드포인트가 전후 JSON이 칸마다 같아야 한다(같은 상태 폴더 복사본으로 `origin/main` 체크아웃에서 "전"을 받는다. 실제 GitHub가 아니라 proposals 파일을 쓴다: `ATC_GITHUB=off`). `app.routes`를 전후로 뽑아 PR에 글로 붙인다.
8. **PR**: 제목 `DISPATCH moves into server/dispatch/ with a public index.ts and view.ts (ATC-345)`. 본문: 등급 `user`, 위 검증, "Behavior change" 절(BEFORE/AFTER: 같은 동작, 새 경로), 그리고 **다음 이동을 위해 배운 것**(ATC-345의 완료 조건): 표면 크기, shim이 필요 없었는지, 충돌 수, 등급에서 놀란 점.

### 9.4 끝났다고 보는 조건

- `npm test`, `tsc`, `vite build`, `node --test deploy/`가 통과하고 `dispatch/`의 R3과 R4가 켜져 있으며 그 허용 목록이 비어 있다.
- `server/dispatch/` 밖의 어느 파일도 `dispatch/dispatch.ts`, `dispatch/proposals.ts`, `dispatch/dispatch-launch.ts`를 직접 import하지 않는다(시험이 증명한다).
- 7702: 복사한 상태 폴더에서 DISPATCH 탭과 `/api/dispatch/brief`가 같게 동작하고 라우트 목록이 같다.
- PR에 후속 작업 지시서 목록이 있다(Linear가 아니라 DUTY에게): P2와 다음에 갈 곁가지.

### 9.5 예상 등급

`user`다. 옮기는 파일이 아니라 importer 때문이다. 옮기는 경로 중 `SIDE_EFFECT`·`READ_ONLY`·guard 목록에 있는 것은 없지만, 고치기 커밋이 `server/switches/auto-approve-launch.ts`, `auto-approve.ts`, `auto-dispatch.ts`, `fuel-hold.ts`, `k3-hold.ts`, `review-security.ts`, `stale-stop.ts`(폴더 때문에 등급 `user`. 바뀌는 것은 import 줄뿐이고 기본값·⚠ 모드·저장 방식은 아니다), `server/jobs/dispatch.ts`와 `server/jobs/fleet-plan.ts`(폴더 때문에 flagged), `server/judges/run.ts`를 고친다. 그래서 PR 본문에 "Behavior change" 절(BEFORE: `server/proposals.ts` … 에서 같은 동작, AFTER: `server/dispatch/…`에서 같은 동작, 스위치 파일은 import 경로 하나씩만 다르다)을 두고 SUPERVISOR가 머지한다.

7.6절에도 이어지는 일반 교훈이다: 도메인의 등급은 importer가 있는 폴더들 중 가장 높은 등급이고 survey 커밋이 그것을 적어야 한다. 스위치 파일의 import 고치기만 따로 PR로 나누는 것은 도움이 안 된다. 옛 경로가 살아 있어야 하는데 그것이 7.3절이 고르지 않은 shim이기 때문이다. SUPERVISOR가 P1을 `auto`로 착륙시키고 싶다면 대안은 결정 D2(shim)이고, 7.3절에 적은 이름 바꾸기 따라가기를 잃는 값을 치른다.

## 10. Risks

| 위험 | 대응 |
|---|---|
| 이동 PR이 진행 중인 많은 FLIGHT와 충돌 | 허브는 판이 조용할 때만 옮김(7.4), 순수 `git mv`로 이름 바꾸기를 따라갈 수 있게, shim 없음(7.3), 기계적인 고치기 커밋, GO AROUND는 FLIGHT 쪽에서 풂(7.5) |
| 공개 표면이 "전부"(`export *`)가 됨 | 진짜 importer로 계산한 이름 목록(9.2), export 떼기는 나중의 싼 PR, 검토가 스크립트 출력과 목록을 대조 |
| `view.ts`가 I/O를 import함 | R2와 R5가 이미 빌드를 실패시킨다. `view.ts`를 넓히지 않고 P2가 파일을 나눈다 |
| mount 순서가 조용히 바뀌어 라우트 맞춤이 달라짐 | 오늘 순서로 `order` 번호, 진짜 레지스트리에서 뽑은 `app.routes`를 `routes.golden.txt`와 비교, 정적 서버는 맨 마지막 |
| 이름으로 부르는 서비스(`service("fuelWatch")`)는 타입이 없고 부작용을 숨김 | 일 레지스트리가 받아들인 같은 거래. `server/mounts/`와 `*/mount.ts`는 flagged. 서비스 이름 목록(`index.ts`가 채우는 `MountServices` 타입)을 N1에 넣어 철자 틀림이 타입 오류가 되게 함 |
| 상태 저장소가 바이트나 오류 처리를 바꿈 | 쓰기 종류마다 골든 바이트 시험. `onBad`가 읽는 코드마다의 동작을 지킴. 출력이 같을 때만 쓰기 코드를 옮김 |
| import 시점에 config를 읽던 곳에서 getter가 던짐 | C1이 import 시점 읽기를 먼저 찾아 없앤 뒤에 getter를 넣음 |
| 옮긴 뒤 landing tier 규칙이 낡음 | survey가 `deploy/landing-tier.mjs`의 경로를 적음. `landing-tier.test.mjs`가 목록에 없는 명령 실행 파일에서 실패. 목록 파일이 있는 도메인은 등급 `user` |
| 문서와 README가 옛 경로를 가리킴 | survey가 적고 이동 PR이 고침. 링크 검사는 여기서 더하지 않음(후속 가능) |
| 작은 단계가 많아 멈춤(계획은 15단계) | 눈에 보이는 이득(지켜지는 배치, 도메인 하나, mount에 `index.ts` 수정 없음)에는 N0, N1, P1만 필요하다. 나머지는 기다려도 저장소가 나빠지지 않는다 |

## 11. Decisions

작성자(TEAM_E, 2026-10-03)의 제안이다. SUPERVISOR가 어느 줄에 "아니오"나 다른 선택을 주면 Implementation order가 바뀐다.

| # | 결정 | 대안 | 이유 |
|---|---|---|---|
| D1 | 도메인 폴더의 **문 둘** 공개 표면: `index.ts`(서버)와 `view.ts`(화면이 가져도 됨) | `index.ts` 하나 | 문이 하나면 `node:fs`가 화면 번들에 들어간다. 화면은 이미 DISPATCH의 순수 함수가 필요하다 |
| D2 | 옛 경로에 **다시 내보내기 shim 없음** | 몇 주 동안 shim | shim은 git이 이름 바꾸기가 아니라 고침으로 보게 한다. 옛 경로를 고치던 FLIGHT가 충돌한다 |
| D3 | mount는 파일 하나씩, 일처럼 폴더를 읽어 찾고 `order`와 골든 라우트 목록을 둔다. tick은 `server/jobs/`에 남는다 | 손으로 쓰는 `features.ts` 목록 | 목록은 다시 공유하는 줄이다(ATC-393이 없앤 핫스팟). 읽는 방식은 이미 있다 |
| D4 | `shared/model.ts`는 **type import**를 두되 `<domain>/view.ts`로 한정(R6) | 모듈 증강으로 도메인 조각 | 실행 때 지워진다. 증강은 `Snapshot`의 모양을 숨기고 컴파일러의 파일 집합에 의존한다 |
| D5 | 상태 파일은 레지스트리 하나의 **handle**로. 레지스트리 파일은 등급 `user` | 자유로운 `writeJson(path)`와 문서 표 | handle이면 등록 안 된 파일이 런타임 오류다. 등급이 모든 형식 변경을 알린다 |
| D6 | Config: 순수 `configOf(env, home)`, 읽는 유일한 곳 `boot.ts`, 던지는 `getConfig()` | 첫날부터 모든 함수에 config 넘기기 | getter가 묶음 이전 동안 88개 importer를 컴파일되게 하고, 던지는 것이 운영 폴더로의 fallback을 없앤다 |
| D7 | 폴더별 README 모듈 표, 생성기 없음 | 코드에서 표 생성 | 글은 설명이다. 생성기는 깨질 곳을 더한다 |
| D8 | 도메인 순서는 7.1절(DISPATCH 다음 importer 적은 것부터) | 가장 큰 허브부터 | 작은 이동이 큰 이동 전에 비용을 알려 준다 |
| D9 | `jobs/`와 `switches/`는 최상위로 남는다 | 일을 각자 도메인으로 | 둘의 등급 규칙과 레지스트리는 폴더 기반이다. 옮겨도 충돌은 안 줄어든다 |
| D10 | 규칙은 한 파일에라도 참이 되는 PR에서 더하고 나머지는 허용 목록에 둔다 | 규칙을 한꺼번에 빨갛게 | 빨간 `main`은 모든 팀을 막는다 |

## 12. Not built yet

3–9절 전부. M21 종료 기준에 들지 않는 후속: 문서 경로 링크 검사(10절), DISPATCH의 MOVE FLIGHT 종류(N10), 되풀이되는 단어를 떼는 파일 이름 바꾸기(`dispatch/dispatch.ts`), 공개 표면에서 빠지는 이름의 export 떼기.
