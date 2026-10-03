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
| `http:<METHOD> /api/<이름>` | 길 묶음별 요청. 스트림 길은 `wallMs`가 연결 시간이다 |

구간마다 `cpu`(이 프로세스의 `userMs`·`systemMs`, `process.cpuUsage()`)도 실어 출처 합과 프로세스 전체를 견줄 수 있고, `dropped`(아래)도 싣는다.

## 어디에 남나

- 상태 폴더의 `job-timing/<UTC 날짜>.jsonl`: 일이 하나라도 돈 구간마다 한 줄(`kind: "job-timing"`), 추가만, 14일 보관.
- `GET /api/job-timing?hours=1`(읽기 전용): 스위치와 지난 몇 시간의 줄을 출처별로 합친 값.

## 스위치와 카운터

- `jobTiming`(설정 → OPERATIONS → JOB TIMING, 기본 `on`, SUPERVISOR 전용, `atcctl` 명령 없음). `off`면 재지도 파일에 쓰지도 않고, 감싼 호출은 전과 똑같이 돈다. `policy / job-timing-mode`로 기록된다.
- `dropped`: 남기지 못한 시간 수의 누적. 출처 이름이 한도(96개)를 넘어 새 이름을 버린 것, 구간을 쓰지 못한 것. 모든 줄과 API에 있다.

## 비용

실행 한 번에 `performance.now()` 두 번과 맵 갱신 한 번이고, 파일은 구간마다 한 번 쓴다. 어느 것도 시간을 기다리지 않고, 요청 길에서 읽지 않는다.

## 한계

- `ms`는 동기 구간만이다. `await` 뒤 스레드 풀·자식 프로세스·커널이 한 일은 들어 있지 않다. 프로세스 전체는 `cpu`와 견준다.
- 스트림 길은 `wallMs`가 연결 시간이다.
- 출처 안쪽은 프로파일하지 않는다. 그럴 때는 시험 서버(포트 7702-7799)를 `NODE_OPTIONS="--cpu-prof"`로 띄운다.
