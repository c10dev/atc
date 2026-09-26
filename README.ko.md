<div align="center">

<img src="docs/assets/banner.svg" alt="ATC — Air traffic control for your AI coding sessions. Ready for takeoff?" width="100%">

**AI 코딩 세션을 위한 관제탑**<br>
Claude Code·Codex 세션, git 워크트리, Linear 티켓을 레이더 한 화면에.

[![Node](https://img.shields.io/badge/node-%E2%89%A524-3ef08f?style=flat-square&logo=nodedotjs&logoColor=white&labelColor=0b1118)](package.json)
[![React](https://img.shields.io/badge/react-19-5cd0ff?style=flat-square&logo=react&logoColor=white&labelColor=0b1118)](web/src)
[![Hono](https://img.shields.io/badge/hono-4-ff4a4a?style=flat-square&logo=hono&logoColor=white&labelColor=0b1118)](server)
[![Vite](https://img.shields.io/badge/vite-8-8aa8ff?style=flat-square&logo=vite&logoColor=white&labelColor=0b1118)](vite.config.ts)
[![License: MIT](https://img.shields.io/badge/license-MIT-ffb627?style=flat-square&labelColor=0b1118)](LICENSE)
![Status](https://img.shields.io/badge/status-READY%20FOR%20TAKEOFF-ffd36b?style=flat-square&labelColor=0b1118)

[English](README.md) · **한국어**

[이륙 준비](#-ready-for-takeoff) · [화면](#화면) · [용어](#용어) · [실행](#실행) · [폴더 구조](#폴더-구조)

</div>

로컬 ATC 웹. 어떤 세션(팀)이 어떤 워크트리를 점유하고, 그 워크트리가 어떤 Linear 티켓을 처리 중인지 한 화면에 보여준다.

- 실행 위치: 이 머신(`/home/c10/projects/atc`), 포트 `7700`
- 접속(맥에서): `ssh -L 7700:localhost:7700 <host>` 후 `http://localhost:7700`
- 읽기 전용 ATC가 기본이다. 워크트리 생성·삭제나 Linear 쓰기는 하지 않는다.

## 🛫 Ready for takeoff?

> **Pre-flight checklist** — Node 24 이상 · Claude Code 또는 Codex · git 워크트리로 일하는 저장소

```bash
npm install
npm run build && npm start      # 🛬 http://localhost:7700
```

Linear 티켓까지 보려면 `.env.local`에 `LINEAR_API_KEY`를 넣는다. 상시 운항(systemd)과 점유 hook은 [실행](#실행)·[점유 hook](#점유-hook)에서.

## 화면

| 화면 | 보여주는 것 |
|---|---|
| RADAR (`#radar`) | 세션 ─ 워크트리 ─ 티켓 3열을 선으로 연결. 주인 없는 워크트리, 워크트리 없는 진행 티켓을 강조 |
| FLIGHT STRIPS (`#strips`) | 세션(ALPHA…, Codex 세션)마다 카드 하나. 상태, 점유 중인 워크트리, 연결된 티켓 |
| FIDS (`#board`) | Linear 상태 열에 티켓 카드. 카드에 점유 팀 배지 |
| 지표 (`#metrics`) | FLIGHT RECORDER 기록으로 본 운용 지표, 2단계 진입 점검, 5분 표본 추이, 일별 표 |
| AIRPORT (`#airports`) | 저장소 등록부. AIRPORT 개설·코드 변경·폐쇄·재개·삭제. 소속 AIRCRAFT와 OUTSTATION으로 와 있는 AIRCRAFT(TRANSIENT) |

## 용어

코드와 API는 왼쪽 이름을 쓰고, 화면은 항공 용어로 보여준다(`web/src/aviation.ts`).

| 코드 | 뜻 | 식별자 | 화면 표기 |
|---|---|---|---|
| `Session` | Claude Code / Codex 세션 하나 | `sessionId` | AIRCRAFT. `TEAM_A` → `ALPHA` (음성 알파벳) |
| `Workspace` | git worktree 하나 (본 체크아웃 포함) | 절대 경로 | STAND |
| `Ticket` | Linear 이슈 | `VOC-191` | FLIGHT NUMBER `VOC191` (브랜치·PR에는 `VOC-191` 그대로) |
| `Claim` | 세션이 워크스페이스를 점유한다는 기록 | `sessionId` + 경로 | STAND 점유. hook·cwd로 확인된 점유는 "IDENTIFIED", 기록 추정은 "ESTIMATED TRACK" |

| 저장소 / 본 체크아웃 | — | 본 체크아웃 경로 | AIRPORT 코드(대문자 4자) / TOWER `VCDO TWR` |

### AIRPORT 등록부

AIRPORT 목록은 `~/.local/state/atc/airports.json`(기계마다 다른 경로가 들어가므로 git 밖)에 있고, AIRPORT 탭이나 API로 관리한다.

- `~/projects` 아래 git 저장소는 자동으로 개설된다. 코드는 이름에서 만든다(첫 글자 + 자음, 예: `tennis` → `TNNS`).
- 그 밖의 저장소는 AIRPORT 탭에서 경로를 넣어 개설한다. 워크트리나 하위 폴더 경로를 넣어도 본 체크아웃을 찾는다. 홈 폴더 밖과 bare 저장소는 안 된다.
- AIRPORT는 **첫 커밋 해시**로 알아본다. 폴더를 옮기거나 이름을 바꿔도 같은 AIRPORT·같은 코드로 이어지고 등록부의 경로만 갱신된다. 같은 첫 커밋의 다른 클론은 `첫커밋~경로해시` id로 따로 개설되고, 여럿 중 옮겨진 것은 폴더 이름이 같은 쪽으로 이어 붙인다. 커밋이 없는 저장소는 경로로 알아본다.
- 폐쇄한 AIRPORT는 RADAR·FLIGHT STRIPS·STAND 목록에서 빠지지만 코드는 계속 예약된다. 삭제는 자동 발견이 아닌(수동 개설) AIRPORT만 된다.

**OUTSTATION**: 세션의 소속 AIRPORT(작업 폴더가 있는 저장소)가 아닌 AIRPORT의 STAND를 점유 중이면 OUTSTATION이다(`server/away.ts`). RADAR AIRCRAFT 블록과 FLIGHT STRIPS 콜사인 옆에 `OUTSTATION TNNS`, 스트립 해당 구간에 `OUTSTATION` 도장, AIRPORT 탭에 `TRANSIENT BRAVO(VCDO)`로 보인다. HANDOFF된 점유와 저장소 밖에서 연 세션은 치지 않는다. CONTROLLER 브리핑의 `traffic[].home`·`away`와 이벤트 `away.started`·`away.ended`로도 나온다.

| API | 하는 일 |
|---|---|
| `GET /api/airports` | 전체 AIRPORT와 상태(`open` 운영 / `closed` 폐쇄 / `missing` 경로 없음) |
| `POST /api/airports` | `{path, code?, name?}` 개설 |
| `PATCH /api/airports/:id` | `{code?, name?, closed?}` 코드·이름 변경, 폐쇄·재개 |
| `DELETE /api/airports/:id` | 등록부에서 삭제 (수동 개설한 것만) |

| 상태 | 화면 표기 |
|---|---|
| 세션 busy / idle+점유 / idle / dead | AIRBORNE / HOLDING / PARKED / NORDO |
| Backlog / Todo | SCHEDULED / FILED |
| In Progress / In Review / Ready to Merge | ENROUTE / APPROACH / CLEARED TO LAND |
| Done / Canceled / Duplicate | ARRIVED / CANCELLED / CONSOLIDATED |

## 데이터 소스와 연결 키

```
Session ──claim──▶ Workspace ──branch──▶ Ticket
```

| 소스 | 위치 | 얻는 것 |
|---|---|---|
| Claude 세션 | `~/.claude/sessions/*.json` | pid, sessionId, cwd, name, status |
| Claude 기록 | `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`, `…/<sessionId>/subagents/*.jsonl` | 도구 호출로 들어간 워크트리 (추정용) |
| Codex 세션 | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | Codex 세션과 cwd |
| git | 각 저장소 `git worktree list --porcelain` | 워크트리 경로, 브랜치, HEAD, dirty 여부 |
| Linear | GraphQL API (`LINEAR_API_KEY`) | 티켓 제목, 상태, 담당, URL |
| Claim | `~/.local/state/atc/claims/<sessionId>/*.json` | hook이 남긴 점유 기록 |

연결 규칙:

1. **Workspace → Ticket**: 브랜치 이름에서 `voc-(\d+)`를 뽑아 `VOC-n`. 디렉터리 이름은 쓰지 않는다(지금 이름이 제각각이라서).
2. **Session → Workspace**: hook 기록이 있으면 그것(`hook`). Codex는 세션 cwd(`cwd`). 둘 다 없으면 대화 기록(서브에이전트 기록 포함)의 **도구 호출**을 hook과 같은 규칙(`hooks/paths.mjs`)으로 읽어 가장 최근에 작업한 워크트리(`transcript`, ESTIMATED TRACK으로 표시). 도구 결과·메시지 본문에 경로가 나온 것은 세지 않고, 마지막 작업 시각이 TTL을 넘으면 버린다.
   팀 세션의 cwd는 모두 `vocado_nextjs` 본 디렉터리라 cwd로는 구분이 안 된다. 기록 추정은 한 세션이 여러 워크트리를 오가서 부정확하므로 Claim이 기준이다.

## 실행

```bash
npm install
npm run build && npm start      # http://localhost:7700 (web/dist 제공)
npm run dev                     # 개발: vite 7700 + API 서버 7701
npm run typecheck
npm test                        # HANDOFF·충돌 판정, 셸 파싱 단위 테스트
```

상시 실행은 systemd 사용자 서비스로 한다.

```bash
cp deploy/atc.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now atc     # 시작 + 부팅 시 자동 시작
systemctl --user restart atc          # 코드 수정 후 (빌드 포함)
journalctl --user -u atc -f           # 로그
```

`.env.local`에 `LINEAR_API_KEY`가 없으면 Linear 없이 브랜치에서 찾은 티켓만 보여준다.

## 점유 hook

`~/.claude/settings.json`의 `PostToolUse`(Edit·Write·MultiEdit·NotebookEdit·Bash, async)가 `hooks/claim.mjs`를 실행한다.

- Edit·Write의 파일 경로, Bash의 `cd <dir>`·`git -C <dir>` 대상, 세션 cwd를 보고 `.git`이 **파일**인 디렉터리(linked worktree)를 찾는다. 본 체크아웃은 기록하지 않는다.
- Bash에서 경로를 언급만 하는 명령(`ls`, `cat`, `grep` 등)은 점유로 치지 않는다. 그래서 리뷰어가 읽기만 해서는 점유가 생기지 않는다.
- Bash 명령은 `hooks/shell.mjs`가 간이 셸 문법으로 나눠, **명령 위치**의 `cd`와 `git -C`만 본다. `echo`·`printf`·`jq` 등의 인자 문자열, heredoc 본문, here-string, 주석은 건너뛴다. `bash -c "…"` 안은 한 번 더 들여다본다.
- `~/.local/state/atc/claims/<sessionId>/<인코딩된 경로>.json`을 처음 한 번 만들고 이후에는 mtime만 갱신한다. 동시 호출에도 안전하다.
- 마지막 갱신 뒤 `ATC_CLAIM_TTL_MIN`(기본 180분)이 지나면 점유가 끝난 것으로 본다.
- 점유 시작 시각(`since`)은 두 경우에 새로 시작한다. TTL이 지난 뒤 다시 건드릴 때, 그리고 내가 손을 뗀 뒤 다른 세션이 잡았던 워크트리를 되찾을 때(A → B → A).

## HANDOFF와 충돌

같은 워크트리를 여러 세션이 점유하면 `server/occupancy.ts`가 점유 구간 `[since, 마지막 접촉]`으로 판정한다. 기준 시간은 `ATC_HANDOFF_GRACE_MIN`(기본 5분)이다.

| 판정 | 조건 | 화면 |
|---|---|---|
| HANDOFF | 앞 세션이 뒤 세션 시작 뒤로 5분 넘게 더 건드리지 않았고, 뒤 세션이 더 늦게까지 건드림 | 앞 세션 점유가 흐려지고 "→ CHARLIE HANDOFF". HANDOFF 목록에 표시. 경보 아님 |
| LOSS OF SEPARATION(충돌) | HANDOFF가 아니고, 살아 있는 두 세션의 점유 구간이 5분 넘게 겹침 | 경보 |
| 잠깐 들름 | 겹침이 5분 이하 | 둘 다 점유로 보이고 경보 없음 |

- HANDOFF된 점유는 점유로 치지 않는다(티켓 배지, HOLDING 판정, 주인 없는 STAND 판정에서 빠진다).
- 종료된 세션이라도 넘겨준 점유는 고아(NORDO STAND)로 치지 않는다.
- ESTIMATED TRACK(대화 기록 추정) 점유는 판정에 쓰지 않는다.
- hook을 끄려면 settings.json에서 해당 항목을 지우면 된다. 기록 폴더는 지워도 된다.

## CONTROLLER (1단계, 조언 모드)

`controller/` 폴더에서 연 Claude 세션이 TOWER 세션(CONTROLLER)이 된다. atc RADAR를 읽고 팀 세션에 CLEARANCE를 보낸다. 결정은 CONTROLLER가, 기록과 표시는 atc가 한다.

```
1. Claude Desktop에서 /home/c10/projects/atc/controller 폴더로 새 세션을 열고 이름을 TOWER로 바꾼다
   (처음 한 번 폴더 신뢰 확인이 뜬다)
2. /loop 3m /tick
```

- 역할·판단 기준: [controller/CLAUDE.md](controller/CLAUDE.md), 한 바퀴 절차: `controller/.claude/skills/tick`.
- CONTROLLER는 조종하지 않는다: Edit·Write는 권한에서 빠져 있고, Bash는 `guard.mjs`가 `node atcctl.mjs …`와 `jq` 외에는 막는다(리다이렉션·명령 치환 포함).
- CLEARANCE 흐름: `atcctl issue`가 atc에 CLEARANCE를 기록하고 정해진 문구를 돌려준다 → CONTROLLER가 SendMessage로 팀 세션에 보낸다 → 팀이 `READBACK C-0007`로 답하면 CONTROLLER가 `atcctl readback`. FLIGHT STRIPS에 READBACK 대기(파랑)·NO READBACK 10분(주황)·READBACK(점선)으로 보인다.
- 정해진 문구(`server/controller.ts`의 `formatClearance`) 예:

  ```
  [ATC C-0007] BRAVO (TEAM_B) · HOLD
  STAND vocado-voc-175 · FLIGHT VOC175
  앞 팀이 끝나 HANDOFF할 때까지 이 STAND를 건드리지 말 것
  — 받았으면 이 메시지에 "READBACK C-0007"로 답장해 주세요.
  ```

- 팀 세션과 TOWER 세션의 권한 모드(자동 승인 여부)가 다르면 메시지가 사용자 승인 대기로 잡힐 수 있다.

| API | 하는 일 |
|---|---|
| `GET /api/controller/brief?consumer=controller` | 지난 ack 이후 이벤트 + 현재 상태(열린 경보, LANDING SEQUENCE, READBACK 안 된 CLEARANCE, 교통) |
| `POST /api/controller/ack` | `{cursor}` 처리 완료 표시 (`~/.local/state/atc/consumers/`) |
| `POST /api/clearances` | `{to, type, stand?, flight?, text}` CLEARANCE 기록, 보낼 문구 반환 |
| `POST /api/clearances/:id/readback` · `/cancel` | READBACK 확인 · 취소 |

이벤트(`server/events.ts`)는 스냅샷 사이의 차이다: 경보 발생·해제, HANDOFF, LANDING SEQUENCE(`ATC_LANDING_STATE`, 기본 `Ready to Merge`) 진입·이탈, 점유 중이던 세션 종료, OUTSTATION 시작·끝. 서버가 막 떠서 Linear·git을 다 읽기 전의 스냅샷과는 비교하지 않는다. CLEARANCE 기록은 `~/.local/state/atc/clearances.jsonl`(추가만 함).

## FLIGHT RECORDER와 운용 지표 (1.5단계)

atc 서버는 `~/.local/state/atc/flight-recorder/YYYY-MM-DD.jsonl`(UTC 날짜)에 추가만 하는 기록을 남기고 30일이 지나면 지운다.

| 기록 | 언제 |
|---|---|
| `event` | 스냅샷 차이 이벤트가 날 때마다 (경보, HANDOFF, LANDING SEQUENCE, NORDO, OUTSTATION) |
| `sample` | 5분마다 교통량: AIRBORNE, HOLDING, 점유, 충돌, 열린 경보, LANDING SEQUENCE, READBACK 안 된 CLEARANCE |
| `ack` | TOWER 세션이 브리핑을 처리할 때 — TOWER가 실제로 운용된 날을 센다 |

`GET /api/metrics?days=1..30`(지표 탭)이 이 기록과 CLEARANCE 기록(`clearances.jsonl`)을 집계한다(`server/metrics.ts`).

- 충돌: 건수, 지속 시간 중앙값, 5분 안에 풀린 비율(오경보 추정)
- CLEARANCE: 종류별 건수, READBACK 비율(취소 제외), READBACK까지 걸린 시간 중앙값, 10분 넘긴 CLEARANCE, 취소
- LANDING(머지) 대기: LANDING SEQUENCE 진입부터 이탈까지 중앙값·최대
- HANDOFF, NORDO, OUTSTATION 시작, NO CONTACT·UNIDENTIFIED 발생 수, 일별 표

**2단계 진입 점검**(제안 기준, `READINESS`): TOWER 운용 3일 이상, READBACK 비율 90% 이상, READBACK 중앙값 5분 이하, 5분 안에 풀린 충돌 30% 이하. CLEARANCE가 5건 미만이거나 풀린 충돌이 3건 미만이면 "데이터 부족"으로 표시한다.

## DISPATCH (2단계, 지금은 2a 그림자 운용)

설계는 [docs/dispatch.ko.md](docs/dispatch.ko.md). atc 서버가 5분마다 FLIGHT(Linear Todo 티켓)를 AIRCRAFT(TEAM 세션)에 배정하는 계획을 계산해(`server/dispatch.ts`) 제안으로 기록한다(`server/proposals.ts`, `~/.local/state/atc/proposals.jsonl`). **아무에게도 보내지 않는다.**

- 제안: `ASSIGN`(FLIGHT → AIRCRAFT, 요소별 점수: 우선순위·대기 일수·풀어 주는 FLIGHT·팀 적합도·충돌 위험), `RELEASE`(STAND 없이 3일 넘게 ENROUTE인 코드 작업 FLIGHT). 선행 FLIGHT에 막힌 것은 `HOLD_DEPARTURE`, 제외된 것은 사유와 함께 보인다.
- 한도: TEAM당 동시 FLIGHT 1, AIRPORT별 동시 AIRBORNE(VCDO 4, 그 밖 2), 열린 ASSIGN·RELEASE 각 5. 같은 짝은 24시간 안에 다시 제안하지 않고, 상황이 바뀌면 SUPERSEDED, 24시간 지나면 EXPIRED.
- 설정: `~/.local/state/atc/dispatch.json`(없으면 기본값) — 프로젝트 → AIRPORT 매핑, 슬롯, 가중치, RELEASE 기준.
- **DISPATCH 탭**: 제안 카드마다 SUPERVISOR가 "승인했을 것 / 거절했을 것"을 표시한다. 20건 이상, 합의율 80% 이상이면 2b(승인 운용) 진입 점검이 충족된다.
- **DISPATCH 세션**(`dispatch/` 폴더에서 연 세션, `/loop 10m /tick`): 메모 없는 제안마다 FLIGHT 본문·댓글을 읽고 메모와 CAUTION(DB·보안·권리, 사람 결정 대기, 본문에만 적힌 선행 작업)을 단다. 판정하지 않고, SendMessage는 권한에서 막혀 있다. guard는 TOWER와 같다.

| API | 하는 일 |
|---|---|
| `GET /api/dispatch/brief` | 지금 계획, 열린 제안, 최근 결정, 2b 점검, FLIGHT 요약 |
| `POST /api/dispatch/proposals/:id/verdict` | `{verdict: agree\|disagree, reason?}` 그림자 판정 |
| `POST /api/dispatch/proposals/:id/note` | `{text, caution?}` DISPATCH 검토 메모 |
| `GET /api/dispatch/flight/:key` | FLIGHT 본문·댓글(Linear 읽기 전용) |

## 폴더 구조

```
atc/
├── hooks/
│   ├── claim.mjs           # PostToolUse hook (의존성 없음)
│   ├── paths.mjs           # 도구 호출 → 작업 경로. hook과 서버 추정이 같이 씀
│   └── shell.mjs           # Bash 명령에서 cd·git -C 대상 추출 (shell.test.mjs)
├── server/                 # Node 24 + Hono. 2초마다 스냅샷을 만들어 SSE로 푸시
│   ├── sources/
│   │   ├── claude.ts       # ~/.claude/sessions, hook 기록, 대화 기록 추정 (claude.test.ts)
│   │   ├── codex.ts        # ~/.codex/sessions (cwd로 점유)
│   │   ├── git.ts          # git worktree list, dirty, 마지막 커밋
│   │   └── linear.ts       # Linear GraphQL, 1분마다
│   ├── model.ts            # Session / Workspace / Ticket / Claim / Alert
│   ├── airports.ts         # AIRPORT 등록부·API (airports.test.ts)
│   ├── away.ts             # OUTSTATION 판정 (화면과 공용)
│   ├── callsign.ts         # 콜사인·FLIGHT NUMBER (화면과 공용)
│   ├── clearances.ts       # CLEARANCE·READBACK 기록
│   ├── controller.ts       # CONTROLLER API·브리핑 (controller.test.ts)
│   ├── dispatch.ts         # DISPATCH 계획: 후보·슬롯·점수 (dispatch.test.ts)
│   ├── events.ts           # 스냅샷 차이 → 이벤트
│   ├── metrics.ts          # 운용 지표·2단계 점검 (metrics.test.ts)
│   ├── proposals.ts        # DISPATCH 제안 기록·API (proposals.test.ts)
│   ├── recorder.ts         # FLIGHT RECORDER 기록
│   ├── occupancy.ts        # HANDOFF·충돌 판정 (occupancy.test.ts)
│   ├── snapshot.ts         # 소스 병합 + 경고 계산
│   └── index.ts            # /api/snapshot, /api/events
├── web/src/                # Vite + React. 연결 / 팀 / 티켓 화면
├── dispatch/               # DISPATCH 세션 작업 폴더 (CLAUDE.md, /tick, 설정)
├── controller/             # TOWER 세션 작업 폴더
│   ├── CLAUDE.md           # 역할·판단 기준
│   ├── atcctl.mjs          # CONTROLLER용 atc CLI
│   ├── guard.mjs           # Bash 제한 hook (guard.test.mjs)
│   └── .claude/            # 권한·hook 설정, /tick 스킬
├── deploy/atc.service      # systemd 사용자 서비스
└── docs/naming.md
```

## 경고

| 종류 (`AlertKind`) | 화면 표기 | 조건 |
|---|---|---|
| `conflict` | LOSS OF SEPARATION | 살아 있는 두 세션이 같은 워크트리에서 5분 넘게 겹쳐 작업 (HANDOFF 제외) |
| `orphan` | NORDO STAND | 종료된 세션이 넘겨주지 않은 점유가 TTL 안에 남아 있음 |
| `unattended` | UNIDENTIFIED | 변경 파일이 있는데 점유한 세션이 없음 |
| `no-workspace` | NO CONTACT | Linear started 상태인데 브랜치가 가리키는 워크트리가 없음 |
