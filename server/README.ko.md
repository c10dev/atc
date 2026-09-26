# server — atc API

[English](README.md) · **한국어**

Node 24 + Hono. 2초마다 Claude Code, Codex, git, Linear를 읽어 `Snapshot` 하나로 합치고 SSE로 웹 화면에 보낸다. 이벤트와 표본(FLIGHT RECORDER)을 기록하고, CONTROLLER의 CLEARANCE, DISPATCH 제안, OCC SCHEDULE 초안을 보관하고, `web/dist`를 제공한다. git·워크트리·Linear에는 쓰지 않는다.

Node가 TypeScript 파일을 바로 실행하므로 서버는 빌드 단계가 없다.

```bash
npm start          # node server/index.ts, 127.0.0.1:7700
npm run dev        # API :7701, --watch (화면은 vite가 :7700에서)
npm test           # server/**/*.test.ts, hooks, controller의 node --test
```

## 한 바퀴

`index.ts`가 2초마다 `tick()`을 돈다.

1. `buildSnapshot()`(`snapshot.ts`)이 소스를 읽어 세션 ─ 점유 ─ 워크트리 ─ 티켓을 잇고, HANDOFF·충돌을 판정하고(`occupancy.ts`), 경보를 계산한다.
2. `diffSnapshots()`(`events.ts`)가 직전 스냅샷과의 차이를 이벤트로 만들고, 이벤트마다 FLIGHT RECORDER에 기록한다.
3. 스냅샷이 준비되면(Linear·git을 다 읽은 뒤) 5분마다 교통량 표본을 남기고 DISPATCH(`runDispatch`)를 돌린다.
4. 시각 말고 바뀐 것이 있으면 SSE 구독자 모두에게 스냅샷을 보낸다.

`/api/events`는 연결하면 현재 스냅샷을 보내고, 이후 바뀔 때마다 보내며, 25초마다 `ping`을 보낸다.

## 소스 (`sources/`)

| 파일 | 읽는 것 | 얻는 것 |
|---|---|---|
| `claude.ts` | `~/.claude/sessions/*.json`, hook 점유 파일, 대화 기록(`~/.claude/projects/…`) | Claude 세션, `hook` 점유, `transcript` 점유(ESTIMATED TRACK, `hooks/paths.mjs`와 같은 규칙) |
| `codex.ts` | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | Codex 세션(최근 90초 안에 움직였으면 busy), `cwd` 점유 |
| `git.ts` | AIRPORT마다 `git worktree list --porcelain` | 워크트리, 브랜치, HEAD, dirty 여부, 마지막 커밋(세부는 30초 캐시). 브랜치 이름에서 티켓 키 |
| `linear.ts` | Linear GraphQL(`LINEAR_API_KEY`), 60초마다 | 티켓, 상태, 우선순위, 프로젝트, 관계. DISPATCH용 이슈 본문 |

## 모듈

| 파일 | 역할 |
|---|---|
| `index.ts` | 진입점: tick 반복, SSE, API 연결, `web/dist` 제공 |
| `config.ts` | `.env.local`과 환경 변수 읽기([deploy](../deploy/README.ko.md#설정)) |
| `model.ts` | 공용 타입: `Session`, `Airport`, `Workspace`, `Ticket`, `Claim`, `Handoff`, `Alert`, `Clearance`, `TrafficEvent`, `Snapshot`. 웹 화면이 그대로 가져다 쓴다 |
| `snapshot.ts` | 소스 병합, TTL 안의 점유만 남기기, 경보 계산 |
| `occupancy.ts` | 점유 구간 `[since, lastAt]`으로 HANDOFF·충돌·잠깐 들름 판정 |
| `airports.ts` | AIRPORT 등록부: `~/projects` 아래 자동 개설, 첫 커밋 해시로 식별, 코드, 개설·폐쇄·이름 변경·삭제 |
| `away.ts` | OUTSTATION: 소속 AIRPORT 밖 STAND를 점유한 세션(화면과 공용) |
| `callsign.ts` | 콜사인(`TEAM_A` → `ALPHA`)과 FLIGHT NUMBER(화면과 공용) |
| `events.ts` | 스냅샷 차이 → 이벤트(경보, HANDOFF, LANDING SEQUENCE, 세션 종료, OUTSTATION). 커서로 읽는 이벤트 기록 |
| `controller.ts` | CONTROLLER(TOWER) API: 브리핑, ack, CLEARANCE 발행·READBACK·취소, 정해진 문구 |
| `clearances.ts` | CLEARANCE 기록: 추가만 하는 JSONL을 접어 현재 상태를 만든다 |
| `recorder.ts` | FLIGHT RECORDER: 날짜별 JSONL(`event`, `sample`, `dispatch`, `ack`, `schedule`), 30일 보관 |
| `metrics.ts` | 운용 지표와 2단계 진입 점검(순수 함수 `computeMetrics`) |
| `dispatch.ts` | DISPATCH 계획: 후보, 슬롯, 점수(순수 함수 `planDispatch`). 설정은 `dispatch.json` |
| `proposals.ts` | DISPATCH 제안 기록(추가만 하는 JSONL), 상태 전이(그림자 판정, approve → sent → accepted → departed), 예약, FLIGHT PLAN 문구, 브리핑, 2b·3단계 점검 |
| `schedule.ts` | OCC SCHEDULE 초안 기록(추가만 하는 JSONL, S1 그림자 운용): `CLASSIFY`·`PRIORITIZE` 초안, 열린 초안 5건 한도, SUPERSEDED·EXPIRED 동기화, 그림자 판정, 후보, S2 점검 |

모듈 옆의 `*.test.ts`가 그 모듈의 단위 테스트다.

## API

| 메서드와 경로 | 하는 일 |
|---|---|
| `GET /api/snapshot` | 현재 스냅샷 |
| `GET /api/events` | 스냅샷 SSE 스트림 |
| `GET /api/airports` | 전체 AIRPORT와 상태 |
| `POST /api/airports` | AIRPORT 개설 `{path, code?, name?}` |
| `PATCH /api/airports/:id` | 이름·코드 변경, 폐쇄·재개 `{code?, name?, closed?}` |
| `DELETE /api/airports/:id` | 수동 개설한 AIRPORT 삭제 |
| `GET /api/controller/brief?consumer=controller` | 지난 ack 이후 이벤트 + 현재 상태 |
| `POST /api/controller/ack` | 브리핑 처리 완료 `{cursor}` |
| `POST /api/clearances` | CLEARANCE 기록 `{to, type, stand?, flight?, text}`, 보낼 문구 반환 |
| `POST /api/clearances/:id/readback` · `/cancel` | READBACK 확인 · 취소 |
| `GET /api/metrics?days=1..30` | 운용 지표 |
| `GET /api/dispatch/brief` | DISPATCH 계획, 열린·최근 제안, 2b 점검, FLIGHT 요약 |
| `POST /api/dispatch/proposals/:id/verdict` | SUPERVISOR의 그림자 판정 `{verdict: "agree" \| "disagree", reason?}` |
| `POST /api/dispatch/proposals/:id/note` | DISPATCH 검토 메모 `{text, caution?}` |
| `POST /api/dispatch/proposals/:id/hold` | DISPATCH가 선행 FLIGHT로 HOLD `{blockedBy: ["VOC-180"]}`, 제안은 HELD로 간다. `[]`는 선행 없는 HOLD(메모 필요) |
| `POST /api/dispatch/proposals/:id/unhold` | SUPERVISOR가 HOLD를 풂(제안은 SUPERSEDED) |
| `POST /api/dispatch/proposals/:id/{approve,reject}` | approval 모드에서 SUPERVISOR 결정, `reject`는 `{reason?}` |
| `POST /api/dispatch/proposals/:id/release` | 승인 → SENT, `sendTo`와 FLIGHT PLAN 문구 반환 |
| `POST /api/dispatch/proposals/:id/{accept,decline}` | CAPTAIN READBACK, 또는 `{reason}`과 함께 거절 |
| `GET /api/dispatch/proposals/:id` | 제안 하나와 지금 모드(send-guard용) |
| `POST /api/dispatch/mode` | `{mode: "shadow" \| "approval"}` 전환(`dispatch.json`에 저장) |
| `GET /api/dispatch/flight/:key` | Linear에서 티켓 본문과 댓글(읽기 전용) |
| `GET /api/schedule/brief` | SCHEDULE 모드(`shadow`), 열린 초안과 초안마다 바뀔 것, 최근 7일에 닫힌 초안, S2 점검, 열린 초안 한도, 후보, FLIGHT 요약 |
| `GET /api/schedule/ops/:id` | SCHEDULE 작업 하나와 모드 |
| `POST /api/schedule/ops` | OCC 초안 `{kind: "CLASSIFY" \| "PRIORITIZE", flight, reason, type?, wake?, ratings?, priority?}`. 열린 초안이 한도면 409 |
| `POST /api/schedule/ops/:id/verdict` | SUPERVISOR 그림자 판정 `{verdict: "agree" \| "disagree", reason?}` |

## 디스크에 두는 상태

모두 `ATC_STATE_DIR`(기본 `~/.local/state/atc`) 아래, git 밖에 있다.

| 경로 | 쓰는 곳 | 내용 |
|---|---|---|
| `claims/<sessionId>/*.json` | [점유 hook](../hooks/README.ko.md) | 워크트리 점유(서버는 읽기만 함) |
| `airports.json` | `airports.ts` | AIRPORT 등록부 |
| `clearances.jsonl` | `clearances.ts` | CLEARANCE 기록(추가만 함) |
| `consumers/<name>.json` | `controller.ts` | 소비자별 브리핑 커서 |
| `flight-recorder/YYYY-MM-DD.jsonl` | `recorder.ts` | FLIGHT RECORDER(UTC 날짜, 30일 보관) |
| `proposals.jsonl` | `proposals.ts` | DISPATCH 제안(추가만 함) |
| `schedule.jsonl` | `schedule.ts` | OCC SCHEDULE 초안과 SUPERVISOR 판정(추가만 함) |
| `dispatch.json` | 사용자(선택, 없으면 기본값) | DISPATCH 설정: 프로젝트 → AIRPORT 매핑, 슬롯, 가중치, 모드(`shadow` / `approval`) |
