# JOB TIMING (ATC-525)

[English](job-timing.md) · **한국어**

atc 서버는 쉬지 않고 도는 주기 일에 CPU를 쓴다: 2초 스냅샷 틱, `server/jobs/`의 잡, 각 `*-run`의 tick, 대화 기록 `fs.watch`, `claude agents --json` 자식 프로세스. JOB TIMING은 일마다 몇 번 돌고 이벤트 루프를 얼마나 붙드는지 세서, 줄일 곳을 추측이 아니라 수로 고르게 한다. 재기만 한다. 어떤 값도, 순서도, 화면의 신선도도 바꾸지 않는다.

## 재는 것

출처마다 이름이 있다. 5분 구간마다 이름별로 `runs`, `ms`(동기 구간의 합, 서버 CPU의 가장 가까운 대용), `maxMs`(한 번의 동기 구간 최대)를 적고, 비동기 일은 `wallRuns`·`wallMs`·`wallMaxMs`(시작부터 끝까지의 시계 시간. 자식 프로세스를 기다린 시간이 들어 있어 CPU가 **아니다**)도 적는다.

| 이름 | 출처 |
|---|---|
| `tick:buildSnapshot`, `tick:signature`, `tick:events`, `tick:jobs`, `tick:alerts`, `tick:queue`, `tick:summary`, `tick:radio` | 2초 스냅샷 틱의 단계(`server/index.ts`) |
| `job:<이름>` | `server/jobs/`의 모든 잡(`every`·`tick`·`start`), 잡 러너가 잰다(`server/job-registry.ts`) |
| `tick:leaks`, `tick:effect-check`, `tick:duty-review`, `tick:duty-run`, `tick:readability`, `tick:skill-calls` | 레지스트리 잡이 아닌 `*-run`의 타이머 |
| `fuel:watch-event`, `fuel:fullWalk`, `fuel:applyDirty`, `fuel:scan` | 대화 기록 `fs.watch` 이벤트, 전체 걷기, 바뀐 것만 다시 stat, FUEL 읽기(`server/fuel-tree.ts`, `server/fuel-run.ts`) |
| `agents-json` | `claude agents --json` 한 번(`server/agents-cache.ts`): `runs`가 spawn 수, `wallMs`가 걸린 시계 시간. 자식의 CPU는 서버의 것이 아니라 이 수에 없다 |
| `http:<METHOD> <길 패턴>` | 맞은 길 패턴별 요청(예: `http:GET /api/dispatch/flight/:key`). 모르는 길은 `/api/*` 하나로 모여 엉뚱한 요청이 이름을 다 쓰지 못한다. 스트림 길은 `wallMs`가 연결 시간이다 |

구간마다 `cpu`(이 프로세스의 `userMs`·`systemMs`, `process.cpuUsage()`)도 실어 출처 합과 프로세스 전체를 견줄 수 있고, `dropped`(아래)도 싣는다.

## 어디에 남나

- 상태 폴더의 `job-timing/<UTC 날짜>.jsonl`: 일이 하나라도 돈 구간마다 한 줄(`kind: "job-timing"`), 추가만, 14일 보관.
- `GET /api/job-timing?hours=1`(읽기 전용): 스위치와 지난 몇 시간의 줄을 출처별로 합친 값.

## 스위치와 카운터

- `jobTiming`(설정 → OPERATIONS → JOB TIMING, 기본 `on`, SUPERVISOR 전용, `atcctl` 명령 없음). `off`면 재지도 파일에 쓰지도 않고, 감싼 호출은 전과 똑같이 돈다. `policy / job-timing-mode`로 기록된다.
- `dropped`: 남기지 못한 시간 수의 누적. 출처 이름이 한도(96개)를 넘어 새 이름을 버린 것, 구간을 쓰지 못한 것. 모든 줄과 API에 있다.

## 이벤트 루프 지연(ATC-538)

JOB TIMING이 일마다의 비용을 센다면, EVENT LOOP LAG는 서버 전체가 느리다는 것을 SUPERVISOR가 느린 화면이 아니라 atc에게서 먼저 알게 한다.

- **재는 것.** `perf_hooks.monitorEventLoopDelay`(해상도 10ms, 해상도 자체는 뺀다). 구간 줄마다 같은 5분 구간의 지연 `loop: { p99Ms, maxMs }`를 싣는다. 못 쟀으면 `null`. `GET /api/job-timing`은 합친 줄들 중 가장 나빴던 `p99Ms`·`maxMs`를 보인다. 이 변경 앞에 쓴 줄에는 `loop`가 없어 건너뛴다.
- **알림.** `p99Ms`가 기준을 넘는 구간이 연달아 N번이면 CAUTION 알림 하나 `alert|event-loop-lag`("서버 이벤트 루프가 느림 …")가 오르고, 기준과 같거나 밑인 구간이 오면 내려간다. 기본 250ms, 3구간(15분)이고 둘 다 설정 → 서버에 있다(`ATC_EVENT_LOOP_LAG_MS`, `ATC_EVENT_LOOP_LAG_WINDOWS`). 연속 구간 수는 메모리에서 세고, 다시 뜬 뒤에는 열린 에피소드는 이어 가고 새 연속은 0부터 센다.
- **스위치.** `eventLoopLag`(설정 → OPERATIONS → EVENT LOOP LAG, 기본 `on`, SUPERVISOR 전용, `atcctl` 명령 없음), `jobTiming`과 같은 방식. `off`면 알림이 나오지 않고 올라가 있던 알림은 바로 내려간다. `p99Ms`·`maxMs` 기록은 그대로다(JOB TIMING의 몫). `policy / event-loop-lag-mode`로 기록된다.
- **에피소드**는 `event-loop-lag-episodes.jsonl`에 추가만 한다: 알림이 오른 때 `open`, 내려간 때 `close`(`endedBy`: `cleared`, `switch`, JOB TIMING이 꺼져 못 쟀으면 `no-data`). **MISFIRE**는 오른 지 10분 안에 `cleared`로 닫힌 에피소드, 곧 SUPERVISOR가 알 필요 없던 짧은 튐이다. `switch`·`no-data`로 닫힌 것은 알림이 틀렸다는 뜻이 아니라 세지 않는다. `GET /api/event-loop-lag?days=7`이 스위치·기준·`episodes`·`closed`·`misfires`·`share`·최근 닫힘을 주고, METRICS → MISFIRE에 다른 레인 옆 한 줄로 보인다.
- **EFFECT CHECK.** 작업 지시서 `## Measure`의 `metric: timing:event-loop-p99`: 배포 앞뒤 구간별 `p99Ms`의 중앙값(한 번 튄 구간이 중앙값을 끌지 않는다). flow 중앙값처럼 앞뒤 창 모두 구간 3개 이상이어야 견주고, 줄이 앞 창 전체를 덮어야 한다. JOB TIMING은 14일을 보관하므로 `window: 7d` 이하로 쓴다.
- 어떤 값도, 순서도, 화면의 신선도도 바꾸지 않는다: 지연은 구간마다 한 번 히스토그램에서 읽는다.

## 비용

실행 한 번에 `performance.now()` 두 번과 맵 갱신 한 번이고, 파일은 구간마다 한 번 쓴다. 어느 것도 시간을 기다리지 않고, 요청 길에서 읽지 않는다.

## 한계

- `ms`는 동기 구간만이다. `await` 뒤 스레드 풀·자식 프로세스·커널이 한 일은 들어 있지 않다. 프로세스 전체는 `cpu`와 견준다.
- 스트림 길은 `wallMs`가 연결 시간이다.
- 출처 안쪽은 프로파일하지 않는다. 그럴 때는 시험 서버(포트 7702-7799)를 `NODE_OPTIONS="--cpu-prof"`로 띄운다.
