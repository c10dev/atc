# server — atc API

[English](README.md) · **한국어**

Node 24 + Hono. 2초마다 Claude Code, Codex, git, Linear, GitHub PR을 읽어 `Snapshot` 하나로 합치고 SSE로 웹 화면에 보낸다. 이벤트와 표본(FLIGHT RECORDER)을 기록하고, CONTROLLER의 CLEARANCE, DISPATCH 제안, OCC SCHEDULE 초안을 보관하고, `web/dist`를 제공한다. git·워크트리·Linear·GitHub에는 쓰지 않는다(`gh`는 PR 목록을 읽을 때만 쓴다).

Node가 TypeScript 파일을 바로 실행하므로 서버는 빌드 단계가 없다.

```bash
npm start          # node server/index.ts, 127.0.0.1:7700
npm run dev        # API :7701, --watch (화면은 vite가 :7700에서)
npm test           # server/**/*.test.ts, hooks, controller의 node --test
```

## 한 바퀴

`index.ts`가 2초마다 `tick()`을 돈다.

1. `buildSnapshot()`(`snapshot.ts`)이 소스를 읽어 세션 ─ 점유 ─ 워크트리 ─ 티켓을 잇고, HANDOFF·충돌을 판정하고(`occupancy.ts`), 경보를 계산하고, 열린 PR마다 CLEARED TO LAND 조건을 따진다(`landing.ts`).
2. `diffSnapshots()`(`events.ts`)가 직전 스냅샷과의 차이를 이벤트로 만들고, 이벤트마다 FLIGHT RECORDER에 기록한다.
3. 스냅샷이 준비되면(Linear·git·GitHub을 한 번 이상 읽은 뒤) 5분마다 교통량 표본을 남기고 DISPATCH(`runDispatch`)를 돌린다.
4. 시각 말고 바뀐 것이 있으면 SSE 구독자 모두에게 스냅샷을 보낸다.

tick마다 `web/dist/index.html`도 본다(mtime이나 크기가 바뀌었을 때만 다시 읽음). 화면이 불러오는 진입 스크립트 `/assets/index-<hash>.js`가 빌드 정체(build)다. 같은 번들로 재시작하면 그대로고, 다시 빌드하면 재시작하지 않아도 바뀐다. 빌드가 없으면 `null`.

`/api/events`는 연결하면 `event: version`(`{build, startedAt}`)과 현재 스냅샷을 보내고, 이후 스냅샷이 바뀔 때마다, build가 바뀔 때마다 `version`을 다시 보내며, 연결하자마자 `ping` 하나를 보내고 이어서 25초마다 `ping`을 보낸다(ATC-210). 재시작 뒤 EventSource가 스스로 다시 붙으므로, 열려 있던 탭은 폴링 없이 배포를 알고 "새 버전이 배포됨 · 새로고침" 알림을 띄운다.

## 소스 (`sources/`)

| 파일 | 읽는 것 | 얻는 것 |
|---|---|---|
| `claude.ts` | `~/.claude/sessions/*.json`, hook 점유 파일, 대화 기록(`~/.claude/projects/…`) | Claude 세션, `hook` 점유, `transcript` 점유(ESTIMATED TRACK, `hooks/paths.mjs`와 같은 규칙), 살아 있는 세션의 대화 기록 끝 64KB와 health hook의 마지막 기록에서 AIRCRAFT health(ATC-45·47) |
| `codex.ts` | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | Codex 세션(최근 90초 안에 움직였으면 busy), `cwd` 점유 |
| `git.ts` | AIRPORT마다 `git worktree list --porcelain` | 워크트리, 브랜치, HEAD, dirty 여부, 마지막 커밋(세부는 30초 캐시). 브랜치 이름에서 티켓 키 |
| `linear.ts` | Linear GraphQL(`LINEAR_API_KEY`), 60초마다, `LINEAR_TEAM_KEYS`의 팀마다 따로 | 티켓, 상태(팀끼리 이름으로 합침), 우선순위, 프로젝트, 관계. DISPATCH용 이슈 본문. 실패한 팀은 마지막 결과를 쓰고, 한 번도 읽지 못한 팀이 있으면 전체가 실패 |
| `linear-projects.ts` | Linear GraphQL, 프로젝트와 프로젝트 마일스톤을 읽는 읽기 전용 쿼리 둘. `LINEAR_TEAM_KEYS`의 팀마다 돌려 합친다(`mergeByTeam`, 각각 `teams`). 10분 캐시 | NETWORK ROUTE 목표용 프로젝트 `name`, `targetDate`, `progress`, `status { name type }`(`state`로: type, 없으면 name). 마일스톤(루트 `projectMilestones`, 쪽마다 50개씩 10쪽까지, 이슈는 50개까지 읽고 넘으면 `truncated`): `name`, `description`, `targetDate`, `progress`(0~100 → 0~1, 순수 함수 `toMilestone`), `sortOrder`, `status`, 이슈마다 key·제목·상태·`completedAt`. 키가 없거나 실패하면 목표는 `null`, 마일스톤만 실패하면 WAYPOINT만 빈다 |
| `github.ts` | git remote가 GitHub인 AIRPORT마다 `gh pr list --repo <owner/name> --state open --json …`, 90초마다 백그라운드로(`execFile`, 셸 없음) | AIRPORT별 열린 PR: head, 체크, 리뷰, 머지 상태, Draft. head에 통과 리뷰가 없거나 Codex 지적이 있는 Draft 아닌 PR은 Codex 봇의 👍 반응, head committer 시각(sha별 캐시), Codex의 PR 댓글도(`gh api`, 읽기 전용). 실패한 저장소는 마지막 결과를 두고 오류는 `snapshot.github.error`에. `gh`가 없으면 `enabled`가 false. `ATC_GITHUB=off`(`github-switch.ts`, 기본 켜짐)도 `enabled`를 false로 하고 `reason`에 "GitHub off (ATC_GITHUB=off)"를 둔다(오류 아님): `server/` 어디서도 `gh`를 부르지 않고(모든 `gh` 호출이 `assertGithubOn()`을 지나 `GithubOffError`를 받는다. 폴링, LOGBOOK, AUTOLAND는 건너뜀), 운영이 아닌 `ATC_STATE_DIR`에서 GitHub가 켜져 있으면 시작할 때 경고 한 줄을 남긴다(ATC-161). LOGBOOK용 `listMerged`는 기본 브랜치에 머지된 최근 PR 30건을 읽는다(`gh pr list --state merged --base <기본 브랜치>`, 기본 브랜치는 저장소별 캐시) |

## 모듈

| 파일 | 역할 |
|---|---|
| `index.ts` | 진입점: tick 반복, SSE, API 연결, `web/dist` 제공 |
| `config.ts` | `.env.local`과 환경 변수 읽기([deploy](../deploy/README.ko.md#설정)) |
| `model.ts` | 공용 타입: `Session`, `Airport`, `Workspace`, `Ticket`, `Claim`, `Handoff`, `Alert`, `Clearance`, `TrafficEvent`, `PullRequest`, `LandingBlockCode`, `Snapshot`. 웹 화면이 그대로 가져다 쓴다 |
| `snapshot.ts` | 소스 병합, TTL 안의 점유만 남기기, 경보와 `pulls` 계산. 스냅샷 필드: `linear`·`github` 상태(`{enabled, error, fetchedAt}`), `sessions`, `workspaces`, `tickets`, `columns`, `airports`, `claims`, `handoffs`, `alerts`, `clearances`, `pulls`(열린 PR, CLEARED 먼저) |
| `landing.ts` | PR마다 CLEARED TO LAND 조건(체크, head 리뷰, 머지 상태, Draft, LOS), head별 `readyAt`, LANDING SEQUENCE 순서(순수 함수 `buildPulls`, `landingBlocks`) |
| `autoland.ts` | AUTOLAND(ATC-34, [docs/occ.ko.md](../docs/occ.ko.md) 9.7): `autoland.json`의 스위치와 HOLD(`parseAutoland`, `saveAutoland`), `autoland-state.json` 상태, merge 제외 목록(순수 함수 `mergeExclusionOf`), GROUND STOP 걸기(순수 함수 `latchGroundStops`), 갱신이 끝났나(순수 함수 `settleOf`), 리뷰가 이어지지 않은 갱신의 재리뷰(ATC-38, 순수 함수 `reviewRequestOf`, `escalateOf`, `fastTrackOf`), AIRPORT마다 할 일 하나와 PR마다 표시(순수 함수 `planAutoland`, `snapshot.autoland`) |
| `human-check.ts` | HUMAN CHECK(ATC-37, [docs/occ.ko.md](../docs/occ.ko.md) 9.8): PR 본문 `## UI change` 블록(`uiChangeOf`), head에 묶인 상태와 ATC-31 잇기(`humanCheckStatusOf`, `waitsOnHuman`), AUTOLAND merge 제외(`humanCheckExclusionOf`), 본문 한 줄 고치기와 요청 확인(`setHumanCheckLine`, `checkRequestOf`), 증거 이미지와 RUN-UP 보고서 고르기(`imagesOf`, `pickRunup`, `runupViewOf`, `insideDir`). 모두 순수 함수 |
| `human-check-run.ts` | HUMAN CHECK 입출력: 증거 댓글 이미지(`body_html`, 메모리에 3분), AIRPORT 체크아웃과 STAND의 RUN-UP 보고서, SUPERVISOR의 PASS·FAIL(`Human check` 줄 하나, PR 댓글 하나), `human-checks.jsonl`. `GET /api/human-check`, `…/evidence`, `…/runup/:run/<파일>`(sandbox), `POST /api/human-check/:owner/:name/:number` |
| `standfree.ts` | STAND 없는 FLIGHT의 ARRIVED(ATC-72, [docs/fleet.ko.md](../docs/fleet.ko.md) 5.1.1): 팀 세션의 `post` 사건으로 팀을 아는 CHECK·SURVEY 후보 감지(`checkSuggestionOf`, `surveySuggestionOf`, `docsOnlyOf`), 직접 배정의 READBACK 착수(`readbackDeparturesOf`), 확인된 PR 없는 LOGBOOK 줄(`standFreeLine`, `directDepartureOf`), 24시간 지표(`timelinessOf`). 모두 순수 함수 |
| `standfree-run.ts` | 5분마다: READBACK 착수를 DEPARTURE LOG에 쓰고, 후보를 찾고(리뷰·댓글·파일은 읽기 전용 `gh`), dispatch brief에 `arrivalCandidates`를 준다. 확인된 ARRIVED(D-xxxx나 직접)면 FUEL F4와 함께 LOGBOOK 줄을 쓴다. `GET /api/standfree`, `POST /api/dispatch/standfree/:flight/arrived` |
| `autoland-run.ts` | GitHub을 새로 읽을 때마다 AUTOLAND 한 주기: GROUND STOP 걸기, 갱신 정리, `update-branch`(`expected_head_sha`)나 정확한 head 머지(`sha`), 리뷰가 이어지지 않은 갱신 뒤 head마다 PR 댓글 `@codex review` 하나(ATC-38). 쓰기 직전에 스위치를, 머지면 PR 자체를 다시 본다. `autoland.jsonl` 기록. `GET /api/autoland`, `POST /api/autoland/hold`, `POST /api/autoland/groundstop/clear` |
| `squelch.ts`, `squelch-run.ts` | SQUELCH 게이트([docs/squelch.md](../docs/squelch.md), S1 ATC-94): 순수 함수 `project`(관제 역할마다 그 세션이 다루는 안정한 객체), `fingerprint`(키를 정렬한 JSON의 sha256), `decide`·`naturalReason`(`first` → `manual` → `signal` → `heartbeat`, `off`, `shadow:*`). 입출력은 브리핑 핸들러를 서버 안에서 불러 입력을 만들고, 그 역할 폴더의 `manual check`를 보고, `squelch.json`(원자적)을 갱신하며 `squelch.jsonl`에 덧붙인다. 아직 부르는 곳이 없고 기본 모드가 `shadow`라 어떤 tick도 버리지 않는다. `GET /api/squelch`, `POST /api/squelch/:role` |
| `judges/classify.ts` | SCHEDULE CLASSIFY 판정 계열(ATC-36, [docs/fleet.ko.md](../docs/fleet.ko.md) 6.1): 입력 허용 목록(순수 함수 `classifyInputOf`, `bodyWithheld`), 질문(FLIGHT TYPE·WAKE Choice, TYPE RATING마다 Noul), 답 검사(`judgmentOf`), 초안과 비교한 mark(`verdictOf`) |
| `judges/engines.ts` | 판정 엔진: `stub`(녹화 응답, 네트워크 없음)과 `jev`(`POST https://api.typesafe.ai/v1/systemone`, `jev-latest`, Bearer `TYPESAFE_API_KEY`. 오류 문구에 키가 들어가지 않는다) |
| `judges/store.ts` | `judges.json` 스위치(`off`·`replay`·`shadow`, 기본 off), `judges.jsonl` 기록, `crosscheckRateOf`로 잰 계열별 일치율(`judgeRateOf`), SUPERVISOR 판정 뒤에만 mark를 보이는 브리핑 보기(`judgesViewOf`) |
| `judges/run.ts` | 스위치가 켜져 있으면 스냅숏마다 판정 한 주기: 1분에 3건까지, `replay`(판정된 초안)나 `shadow`(열린 초안). 대상은 순수 함수 `targetsOf`가 고른다 |
| `origin.ts` | `fromThisApp`: localhost `Origin`이 있는 JSON 요청(이 화면)만 설정, HOLD, GROUND STOP을 바꾼다. `atcctl`은 `Origin`을 보내지 않는다 |
| `occupancy.ts` | 점유 구간 `[since, lastAt]`으로 HANDOFF·충돌·잠깐 들름 판정 |
| `airports.ts` | AIRPORT 등록부: `~/projects` 아래 자동 개설, 첫 커밋 해시로 식별, 코드, 개설·폐쇄·이름 변경·삭제 |
| `away.ts` | OUTSTATION: 소속 AIRPORT 밖 STAND를 점유한 세션(화면과 공용) |
| `fleet-live.ts` | FLEET 라이브 부분(ATC-100): REGISTRATION마다 상태·FLYING FLIGHT·마지막 활동·health·ACCOUNT hold·칩을 `Snapshot`만으로 셈(순수 함수 `liveViewOf`, `mergeLive`). `fleetView`와 화면이 같이 씀 |
| `fleet-status.ts` | FLEET 운항 상태 목록(ATC-44): AIRCRAFT마다 AIRBORNE·HOLDING·PARKED·AOG·NORDO(순수 함수 `fleetStatusOf`), 상태 다음 AIRPORT 순으로 한 줄씩(순수 함수 `fleetRows`), 경과 시간 글(화면과 같이 씀) |
| `restarting.ts` | RESTARTING(ATC-91, docs/fleet.ko.md 8.5 "RESTARTING as built"), 순수 함수: `restartingOf`(정상으로 끝나 세션 파일이 없고 같은 REGISTRATION의 살아 있는 세션이 없는 것, `restartGraceMin` 안), `normalEndOf`, 화면과 같이 쓰는 글. 읽기는 `sources/claude.ts`의 `readEndedSessions` |
| `health-flights.ts` | FLIGHT를 쥔 AIRCRAFT의 health(ATC-86, docs/fleet.ko.md 8.8 "AIRCRAFT health from events as built"), 순수 함수 `applyFlightHealth`: 세션에 `STALLED`(STAND 점유나 `tail:` 라벨의 In Progress FLIGHT, `stalledMin` 넘게 idle, 열린 PR 없음)와 `keptFlights`(멈춘 AIRCRAFT가 점유가 `claimTtl`을 넘은 뒤에도 쥔 FLIGHT)를 붙인다 |
| `health.ts` | AIRCRAFT health(ATC-45·47, docs/fleet.ko.md 8.8): 대화 기록 줄에서 본문 없이 사실만(순수 함수 `factsOf`. ATC-86: `usageLimitNote` `wrap_up`·`release` 줄도 시각·종류만), 세션 하나의 코드 — `LIMIT`(`cut`: 오류 없이 끝남)·`RESUME`·`STALLED`·`THROTTLE`·`NETWORK`·`MODEL`·`CONTEXT`·`PROVIDER`·`PENDING`·`UNANSWERED`·`HUNG`·`DENIED`·`UNKNOWN`(순수 함수 `healthOf`), hook의 마지막 기록과 pull의 우선순위(순수 함수 `mergeHealth`), 기계 단위로 묶은 경보(순수 함수 `healthAlerts`), cut `LIMIT`의 reset을 ACCOUNT의 FUEL 기록에서 찾기(순수 함수 `cutResetOf`·`settleCut`), FLEET 표시 글(화면과 같이 씀) |
| `callsign.ts` | 콜사인(`TEAM_A` → `ALPHA`)과 FLIGHT NUMBER(화면과 공용) |
| `version.ts` | 빌드 정체: `index.html`의 진입 스크립트 경로(순수 함수 `entryScript`)와 탭이 새 버전 알림을 띄울지(순수 함수 `showNewVersion`, 화면과 공용) |
| `changelog.ts` · `changelog-fold.ts` | CHANGELOG 조각(ATC-64, [changelog.d](../changelog.d/README.ko.md)): `changelog.d/*.md`와 `*.ko.md` 짝 짓기(`pairFragments`), 조각 형식 확인(`parseFragment`), 조각을 `[Unreleased]`에 넣기(순수 함수 `foldChangelog`, DOCS 변경 기록 쪽과 함께 씀). `node server/changelog-fold.ts [--check]`는 모든 짝을 두 CHANGELOG에 넣고 지운다. 짝이 없거나 형식이 틀리면 아무것도 바꾸지 않는다 |
| `events.ts` | 스냅샷 차이 → 이벤트(경보, HANDOFF, LANDING SEQUENCE `landing.requested`·`cleared`·`blocked`·`left`, 세션 종료, OUTSTATION). 커서로 읽는 이벤트 기록 |
| `control-recycle.ts`, `control-recycle-run.ts` | CONTROL RECYCLE(ATC-166, [docs/control-recycle.md](../docs/control-recycle.md)): 순수 `controlRecycleOf`(CAP, job idle, 안전한 순간, cooldown, 한 번에 하나), `safeBlocksOf`, `goneOf`(저장한 pid로 STOP 확인), `contextTokensOf`, `parseRecycle`. 입출력은 대화 기록 꼬리에서 컨텍스트를 읽고 안전 조건 자료를 모아 `stopControl` → 확인 → `launchControl`(FLEET 버튼과 같은 함수)을 부른다. `control-recycle.json`의 모드 `off`(기본)·`shadow`·`on`, 세션별 `auto`(OCC는 `false`: 측정·알림만). 시도마다 FLIGHT RECORDER에 `control` `recycle` 한 줄. `GET /api/control/recycle`, `PUT /api/settings`의 `controlRecycleMode`·`controlRecycleCaps` |
| `control-bulk.ts`, `control-bulk-run.ts` | CONTROL SESSIONS 일괄 동작(ATC-255, [docs/fleet.ko.md](../docs/fleet.ko.md) 8.5.4): 순수 `bulkPlanOf`(순서, 세션별 동작·이유, `intendedAccountOf`의 ACCOUNT drift, 보류 행), `runBulkRows`(한 번에 하나, STOP ALL 말고는 첫 실패에서 멈춤), `allControlDown`(복구 배너). 입출력은 `claude agents`와 안전한 순간 사실을 읽고 `launchControl`·`stopControl`·CONTROL RECYCLE 재시작을 부른다. `GET`·`POST /api/control/bulk`. FLIGHT RECORDER `control` `bulk` 줄 |
| `reposition.ts`, `fleet-plan.ts`의 `repositionOf` | FLEET PLAN REPOSITION(ATC-179, [docs/fleet.ko.md](../docs/fleet.ko.md) 8.6): 순수 `repositionOf`(받을 `no-aircraft` FLIGHT가 있고 AIRCRAFT가 없는 목표, 떠난 뒤에도 충분히 남는 FLIGHT 사이의 출발, 이력→가장 오래 쉼, flaps), `autoRepositionOf`(하루 상한, flapping → approval), `parseReposition`(`fleet-plan.json`의 `off`·`shadow` 기본·`approval`·`auto`), 알림 문구. `fleet-plan-run.ts`가 돌린다: `runApproval`(승인과 `auto`가 같이 씀, STOP 전에 목표 확인, 단계 `stop` → `base` → `launch`), `fleet` `reposition` 한 줄, `reposition` `mode`·`would` 줄. `PUT /api/settings`의 `fleetPlanReposition` |
| `controller.ts` | CONTROLLER(TOWER) API: 브리핑, ack, CLEARANCE 발행·READBACK·취소, 정해진 문구, CLEARED PR의 LAND 문구(순수 함수 `landTextOf`), 누가 착륙시키나는 `land-by.ts`(`landByOf`, ATC-151) |
| `clearances.ts` | CLEARANCE 기록: 추가만 하는 JSONL을 접어 현재 상태를 만든다 |
| `response.ts` | 응답 속성(ATC-122, 순수): 어떤 답이 메시지를 닫나(W/U는 READBACK·UNABLE, STANDBY는 열어 둠. R은 ROGER), atc가 쓰는 끝줄, 첫 STANDBY 뒤 overdue 기준 |
| `milestones.ts` | FLIGHT별 OOOI(ATC-123): 이미 있는 기록에서 OUT·OFF·ON·IN 실제 시각(순수 함수 `milestonesOf`, `latestMilestone`, `milestoneLine`). 화면도 씀 |
| `milestones-run.ts` | OOOI 실행부: 기록과 로컬 저장소를 읽어(읽기만, 캐시) FLIGHT·이정표마다 `milestone` FLIGHT RECORDER 줄 한 번, `GET /api/milestones` |
| `voice-phrase.ts` | 라디오 음성 콜아웃(ATC-140): WARNING·CALL 알림 종류마다 고정 영어 문구, 콜사인과 한 자리씩 읽는 FLIGHT 번호, `[A-Za-z0-9 ,.'-]`만(순수 함수 `phraseOf`, `flightWords`, `kindOf`) |
| `tts.ts` | TTS 엔진 어댑터(ATC-140, ATC-143): `piper`·`espeak`·`kokoro`가 `execFile` 실행기 하나를 함께 쓴다(셸 없음, 문구는 stdin, 엔진별 시간 제한 — 5초, Kokoro 20초 — 엔진마다 한 번에 하나, 목소리는 `VOICE_NAME`과 그 엔진의 목록으로 둘 다 확인). 그 밖에 `stub`, `none`. 예외 대신 상태(`statusOf`, `voiceStatusOf`, `renderPhrase`). Kokoro 래퍼는 `tts/kokoro-say.py` |
| `voice-cache.ts` | 상태 폴더 `voice-cache/`의 버려도 되는 WAV 캐시(ATC-140): 200개 또는 20 MB, 오래된 것부터 지움 |
| `voice-run.ts` | `GET /api/voice/status`, `/api/voice/alert/:key.wav`(지금 있는 알림 key만), `/api/voice/preview.wav`. 파일만 만들고 소리는 내지 않는다 |
| `readability.ts`, `readability-run.ts` | READABILITY R0(ATC-176): `readabilityOf`(순수, 테스트 있음)가 답 지연, 무응답·overdue 수, UNABLE 사유 분류, 메시지 크기와 추정 토큰, 이행과 화법 위반을 잰다. `readability-run.ts`가 TOWER·OCC 대화 기록에서 팀 답의 첫 줄과 길이만 읽고(읽기만), 하루(UTC)에 한 줄씩 `readability.jsonl`에 더하며(추가만, 2026-09-26부터 빠진 날을 채우고 같은 날을 두 번 쓰지 않는다) `git log`의 화법 변경 표지를 붙이고, `GET /api/readability`를 연다 |
| `radio.ts`, `radio-run.ts` | RADIO R1(ATC-170): `radioOf`가 기록된 교신을 transmission으로 합친다(순수, 테스트 있음). `radio-run.ts`가 파일을 읽어 `GET /api/radio`를 열고 SSE 토픽 `radio`를 먹인다(듣는 이가 있을 때만 tick마다 파일을 읽는다) |
| `radio-phrase.ts` | RADIO R3(ATC-172, 순수): `radioPhraseOf`가 교신의 읽을 틀을 필드로만 만들고(`body`는 읽지 않는다), `voiceOf`가 스테이션·콜사인마다 안정적인 목소리를 고르고, `parseVoiceOverrides`가 `?voices=`를 읽는다 |
| `other-background.ts` | 그 밖의 백그라운드 세션(ATC-184, 순수): `otherBackgroundOf`가 AIRCRAFT도 관제 세션도 아닌 살아 있는 백그라운드 줄을 뽑고, `capHoldersOf`·`capHoldersText`·`capLine`이 `ATC_MAX_LAUNCHED` 자리를 누가 쥐었는지 적고, `capIdleHintsOf`가 120분 놀이 힌트(ADVISORY `cap|other|<id>`)를 고른다 |
| `recorder.ts` | FLIGHT RECORDER: 날짜별 JSONL(`event`, `sample`, `dispatch`, `ack`, `schedule`, `checkride`, `milestone`), 30일 보관 |
| `metrics.ts` | 운용 지표와 2단계 진입 점검(순수 함수 `computeMetrics`) |
| `logbook.ts` | LOGBOOK: 10분마다 머지된 PR → ARRIVED FLIGHT마다 `arrived` 줄, 머지된 Revert PR은 `reverted` 줄(순수 함수 `buildEntry`, `planLogbook`, `foldLogbook`). FLEET 카드의 TARGETS 실적(순수 함수 `computeActuals`, `expectationMin`). `GET /api/logbook`. AIRCRAFT와 출발은 착수 기록으로도 찾고, 옛 모름 줄은 `attributed` 줄로 채운다(순수 함수 `attribution`). `measured` 줄로 지시서(VECTORS·DIRECT), SOLO·CREW, PR 뒤 수정 커밋, P0–P2 지적을 더한다(순수 함수 `measureLines`). `GET /api/logbook/briefs`. 새 `arrived` 줄에는 14일 FUEL 읽기로 선택 필드 `fuel`을 붙인다(FUEL F4, ATC-53). 옛 줄은 그대로. `GET /api/logbook`의 `fuel`이 있는 항목에 `fuelCost`(ATC-59)를 붙인다. 읽을 때 지금 가격표로 값을 매긴다(`loadPricedLogbook`). `trip`(ATC-56: NET을 TRIP FUEL과 비교, `verdict`는 `inside`·`unexpected`·`null`)도 붙는다 |
| `briefs.ts` | DIRECT 지시서(ATC-32, 순수 함수): 이슈 본문에서 지시서 칸(`directSectionsOf`), 배정 문구(`formatAssignment`), 대화 기록 사건과 FLIGHT의 지시서 사실(`talkEventsOf`, `briefFactsOf`), STAND 안 쓰기로 SOLO·CREW(`crewModeOf`), P0–P2 지적(`findingsOf`), 수정 커밋(`reworkOf`), VECTORS 대 DIRECT 비교(`compareBriefs`) |
| `departures.ts` | 착수 기록(DEPARTURE LOG): 따뜻한 tick마다 점유·워크트리를 STAND별 마지막 AIRCRAFT와 비교해 `stand`·`claim`·`handoff` 줄을 추가(순수 함수 `diffDepartures`, `foldDepartures`). `matchDepartures`가 브랜치·FLIGHT·STAND로 AIRCRAFT와 첫 시각을 찾는다(맞는 줄은 `departureHits`, FUEL F4도 쓴다) |
| `crew-observed.ts` | OBSERVED CREW: AIRCRAFT 세션들의 최근 14일 서브에이전트 호출. 세션 메타데이터만 읽는다(`subagents/*.meta.json`의 agentType·model과 파일 시각, 세션 이름은 `custom-title.json`). mtime으로 캐시하고 30초에 한 번까지만 다시 훑는다. 순수 함수 `parseMeta`, `positionOf`(agentType + model → 선언된 POSITION), `observeCrew`(묶기와 drift. FUEL이 본 agent id별 실제 모델을 주면 그 모델을 쓰고 COMPLEMENT DRIFT를 `undeclared`에 올린다, ATC-57) |
| `fuel.ts` | FUEL(ATC-50, [docs/fuel.md](../docs/fuel.md) 4장): 대화 기록 줄 → 요청마다 기록(다섯 가지, 모델, `stop_reason`, version, effort). `"usage"`·`"compact_boundary"`·`"agent-name"`이 있는 줄만 파싱하고 숫자·모델·시각·id만 옮긴다. `message.content`, 도구 입력·결과는 옮기지 않고, 모르는 모양은 센다. 순수 함수 `parseFuelLines`, `kindsOf`(5m·1h 나누기), `dedupeKey`와 `dedupeFuel`(전역: `(message.id, requestId)`, 없으면 `(message.id, sessionId)`. non-sidechain 사본, 다음은 토큰 합이 큰 사본), `cacheHit`, `summarizeFuel`(세션·AIRCRAFT별, CAPTAIN 대 CREW, CREW 출력은 하한) |
| `fuel-flights.ts` | FUEL F4 FLIGHT별 귀속(ATC-53, [docs/fuel.md](../docs/fuel.md) 8.3), 순수 함수: `arrivedSpan`(LOGBOOK `departedAt`–`arrivedAt`, 착수 기록의 AIRCRAFT 구간, HANDOFF마다 나뉨. `segmentsOf`), `enRouteSpans`(아직 있는 STAND의 도착하지 않은 착수 기록), `flightOf`(요청 하나는 FLIGHT 하나: STAND 점유 먼저, 다음은 세션의 AIRCRAFT. 겹치면 늦게 출발한 쪽), `attributeFuel`(FLIGHT별, AIRCRAFT별 `flights`·`enRoute`·`unattributed`, CAPTAIN 대 CREW), `fuelForEntry`(LOGBOOK `fuel` 필드, 또는 없음). `attributeFuel`은 `leaks`와 CREW `warnings`도 같은 규칙으로 FLIGHT마다 나눈다(`crewWarnings`, `highCrewShare` 포함). 구간은 SESSION CHANGE 기준선을 위해 AIRPORT를 안다. FLIGHT의 `fuel`에 `byModel`(ATC-59)도 붙는다: 모델마다(값이 달라지는 `speed`·`geo`가 있으면 따로) CAPTAIN·CREW 토큰과 쓰기 층별 LEAK 토큰(CAPTAIN, F7부터 CREW도). 달러는 없다 |
| `fuel-cost.ts` | FUEL COST(ATC-54, [docs/fuel.md](../docs/fuel.md) 7장·8.4): 가격은 가격표에서만. 순수 함수 `parsePriceTable`, `mergePriceTables`(상태 폴더 표가 저장소 표를 모델 단위로 덮음), `modelPriceOf`(같은 이름이거나 날짜만 붙은 이름, 짐작 없음), `rateOf`(`speed:*`·`inferenceGeo:*` 배수. 모르는 모델·speed는 이유와 함께 값 없음), `costOf`(`input·P_in + 5m·1.25·P_in + 1h·2·P_in + read·readMult·P_in + output·P_out`), `leakPriceOf`(F3의 units와 USD를 같은 표에서), `priceFlightFuel`(ATC-59: LOGBOOK `fuel`의 `byModel`에 읽을 때 값을 매긴다. CAPTAIN·CREW·합 비용, LEAK 비용, NET, 값 없는 모델. `byModel`이 없는 옛 줄은 `null`, 값을 매긴 모델이 없으면 0이 아니라 `null`) |
| `fuel-prices.json` | 가격표(코드가 아닌 설정): `source`, `writeMult`, `multipliers`, 모델마다 `in`·`out`(USD / 백만 토큰), `readMult`, `multipliers`. `~/.local/state/atc/fuel-prices.json`이 모델 단위로 덮는다 |
| `fuel-leaks.ts` | FUEL LEAK(ATC-52·ATC-57, [docs/fuel.md](../docs/fuel.md) 5장·8.2·8.5): 세션마다 CAPTAIN 요청을, 서브에이전트마다 CREW 요청을 앞 요청과 비교한다. 앞 요청의 캐시 접두부 중 다시 처리한 몫(`rewritten`)이 5 %를 넘고 2,000 이상이면 miss. 차례로: 프록시 요청(`requestId` 없음)이면 `proxied`(LEAK 밖), `compact_boundary` 뒤면 캐시가 식었을 때 `compaction` 아니면 `expectedRebuild`(LEAK 밖), 모델이 바뀌면 `modelSwitch`, TTL(마지막 쓰기 층에 따라 1h·5m)을 넘겨 쉬었으면 `controlWake` 또는 `coldCache`, 아는 `version`·`effort`가 바뀌었으면 `upgrade`, 나머지는 `unexplained`. `sessionChangeLeaks`: 다른 세션이 몬 FLIGHT에서 새 세션 첫 요청이 AIRPORT 새 세션 기준선을 넘은 몫. atc 발신은 `clearances.jsonl`·`proposals.jsonl`·`crew-changes.jsonl`의 시각으로 맞춘다. 순수 함수 `rewrittenOf`, `ttlAfter`, `unitsOf`(`rewritten × (writeMult − readMult)`), `sessionLeaks`, `findLeaks`, `sessionChangeLeaks`, `controlSendsOf`, `addLeak`. 표시 전용 |
| `fuel-crew.ts` | CREW 경고(ATC-57, [docs/fuel.md](../docs/fuel.md) 5장). 보여 주기만 하고 LEAK에 넣지 않는다: 서브에이전트마다 HEAVY PREFIX, TRIVIAL DELEGATION, DEEP NESTING, EXPENSIVE READ-ONLY, COLD CREW, COMPLEMENT DRIFT(`agentWarnings`, `crewWarnings`), FLIGHT마다 HIGH CREW SHARE(`crewShareOf`). 순수 함수. `agentModels`(서브에이전트마다 답한 모델), `driftOf`도 |
| `fuel-context.ts` | CONTEXT SIZE(ATC-69, [docs/fleet.ko.md](../docs/fleet.ko.md) 8.6 "REFRESH 만든 것"). 순수 함수이고 화면도 같이 쓴다: `sessionContexts`(세션마다 마지막 CAPTAIN 요청의 `input + cacheRead + cacheWrite`, 뒤의 `compact_boundary`가 다시 센다), `windowOf`(설정 → `[1m]` → 200k 넘게 봄 → 200k), `refreshSavingOf`(새로 시작하면 아끼는 캐시 쓰기와 턴마다의 읽기, F5 가격표), `contextBadgeOf`와 글(ATC-81: FOB, 남은 몫과 그 색 기준, `fobPct`). ATC-85: 세션이 스스로 말한 창이 짐작보다 앞선다(`sessionContexts`가 `fuel.ts`가 읽은 `/model` 출력과 `readStatusWindows`가 읽은 statusline `context_window_size`를 받는다. `windowSource`는 `statusline`이나 `model-command`). FLEET API와 FLEET PLAN `REFRESH`는 `fuel-run.ts`의 `contextSizes`로 읽는다 |
| `agent-models.ts` | 서브에이전트 id → 실제로 답한 모델. FUEL 읽기가 훑을 때마다 채우고 OBSERVED CREW가 읽는다. `crew-observed.ts`가 대화 기록을 열지 않게(ATC-57) |
| `fuel-tree.ts` | `fs.watch`로 지키는 FUEL 대화 기록 목록(ATC-83): 바뀐 경로만 다시 stat하고, 전체 걷기는 대비책이자 60초 점검으로 남는다(`FuelTree`, `classifyFuelPath`) |
| `fuel-cache.ts` | `~/.cache/atc/fuel/`의 버려도 되는 대화 기록별 읽기 캐시(ATC-83): 읽은 자리, 중복을 없앤 `FuelRecord`와 요약. 대화 본문은 없다. 버전이 있고, 못 읽거나 낡았거나 다른 형식이면 무시한다 |
| `fuel-run.ts` | FUEL 읽기: 기간 안에 바뀐 본 대화 기록과 `subagents/**/agent-*.jsonl`을 파일마다 지난번 바이트 뒤부터 읽는다(파일이 줄거나 바뀌면 처음부터). `agent-*.meta.json`에서 `agentType`·`spawnDepth`. 읽기만 한다. `scanFuel`, `analyzeWindow`(LOGBOOK·착수 기록·hook과 스냅샷 점유·지금 있는 STAND로 구간을 만들고, F3·F7 LEAK과 SESSION CHANGE, FLEET COMPLEMENT로 본 CREW 경고, 귀속을 낸다), `addLogbookFuel`(LOGBOOK `fuel` 단계. 가져오기 순환을 피해 `index.ts`가 `runLogbook`에 넘긴다), `GET /api/fuel` |
| `fuel-view.ts` | FUEL F8(ATC-56, [docs/fuel.md](../docs/fuel.md) 8.6). 순수 함수이고 화면도 같이 쓴다: `tripFuelOf`(지난 NET FUEL COST의 p50–p90, TYPE × WAKE로 묶고 `MEDIAN_MIN_SAMPLES`보다 적으면 WAKE, 그다음 AIRPORT로 넓힘, 모델 세대별로도), `tripCheckOf`(`inside`·`unexpected`), `fleetFuelOf`(FLEET 카드의 14일 FUEL), `largeLeaksOf`, `coldCachesOf`, 글. 없는 값은 0이 아니라 `null`. 보여 주기만 한다 |
| `fuel-watch.ts` | TOWER·OCC 브리핑의 FUEL 경고(ATC-56): 24시간 FUEL 스캔과 `analyzeWindow`로 팀 AIRCRAFT의 큰 LEAK과 캐시가 식은 HOLDING CAPTAIN을 구해 60초 동안 쓴다. `index.ts`가 controller·DISPATCH에 넘긴다 |
| `fuel-prices.ts` | `readPrices`: 가격표(`server/fuel-prices.json` 위에 `~/.local/state/atc/fuel-prices.json`), 크기·시각으로 캐시. ATC-56에서 `fuel-run.ts`에서 옮겼다(FLEET·DISPATCH가 순환 없이 LOGBOOK 줄에 값을 매기도록) |
| `crew-change.ts` | CREW CHANGE: 운항 중인 AIRCRAFT의 COMPLEMENT가 `PATCH /api/fleet/:registration`으로 바뀌면 CAPTAIN에게 줄 지시문을 만들어 추가만 하는 기록에 남긴다. 상태는 pending → approved(SUPERVISOR, approval 모드만) → sent(OCC `atcctl crew-change send`) → acknowledged(READBACK), 또는 delivered·superseded(순수 함수 `diffCrew`, `ratingImpact`, `crewChangeText`, `crewChangeMessage`, `planCrewChange`, `foldCrewChanges`, `approveRefusal`, `sendRefusal`, `openCrewChangeOf`, `crewChangeBriefOf`, 2b 점검표용 `selfCheckCrewChange`). `withCrew`가 FLEET 화면에 `observedCrew`, `crewDrift`, `pendingCrewChange`를 붙인다. `GET /api/fleet/crew-changes`, `…/crew-changes/brief`, `…/crew-changes/:id`, `POST /api/fleet/:registration/crew-change/:id/{approve,delivered}`, `POST /api/fleet/crew-changes/:id/{send,readback}` |
| `checkride.ts` | CHECKRIDE: FLIGHT에 필요했던 rating을 라벨이나 받아들인 SCHEDULE CLASSIFY 초안에서 읽고(순수 함수 `flightRating`), AIRCRAFT·rating마다 GRANT·REVIEW·BLOCKED·BUILDING·HOLDS(순수 함수 `judge`, `checkrideRows`). `GET /api/fleet/checkride`, SUPERVISOR의 부여·회수 `POST /api/fleet/:registration/checkride`(`applyPatch`로 바꾸고 `checkride` 줄로 기록) |
| `rules-state.ts` | FLEET RULES 줄(ATC-42): 살아 있는 세션마다 `rules-ack` 기록을 지금 규칙 파일과 비교한다(순수 함수 `rulesOfAircraft`, `hooks/rules-drift.mjs`의 `statusOf`를 다시 씀). 바뀐 시각은 ref의 마지막 커밋이나 파일 mtime(`changedAt`). `GET /api/fleet`에 `rules`로 붙는다 |
| `session-origin.ts`, `session-proc.ts` | 세션 출처(ATC-76, [docs/fleet.ko.md](../docs/fleet.ko.md) 8.5.2): 순수 함수 `originOf`(`background`·`desktop`·`terminal`·`unknown`), `permissionModeOf`, `manualStepsOf`, `originBadgeOf`, `deliveryOf`(2b permission mode 경고), `launchModeOf`. `session-proc.ts`는 pid마다 한 번 `/proc/<pid>/cmdline`과 부모의 것을 읽기만 한다 |
| `routes.ts` | ROUTE MAP(읽기 전용, [docs/routes.ko.md](../docs/routes.ko.md)): WAYPOINT 상태(순수 함수 `waypointStates`), FLIGHT 단계(`phaseOf`, `isBlocked`), 완료 기준(`criteriaOf`), 28일 완료 수(`completedIn`: LOGBOOK ARRIVED ∪ Linear `completedAt`), 누적 ETA(`etaOf`)와 지연(`isLate`)을 `buildRoutes`가 묶는다. AIRCRAFT는 `following.targetsOf`. `GET /api/routes` |
| `briefing.ts` | DISPATCH 카드 BRIEFING(ATC-4, [docs/dispatch.ko.md](../docs/dispatch.ko.md) 5.5): OCC가 쓰는 세 줄(순수 함수 `parseBriefing`), 서버의 사실 줄(순수 함수 `factsOf`, `routes.ts` 위의 `waypointIndex`: PRIORITY, 대기 일수, ROUTE·WAYPOINT, 선행, 그 AIRCRAFT의 같은 ROUTE 최근 FLIGHT, CROSSCHECK), 대신 보일 첫 문장(순수 함수 `firstSentence`. `leadOf`가 Linear 본문을 백그라운드로 읽어 30분 캐시) |
| `blind.ts` | DISPATCH blind 표본(ATC-6, [docs/dispatch.ko.md](../docs/dispatch.ko.md) 5.6): 제안 ID의 FNV-1a 해시로 약 5개에 1개(순수 함수 `isBlind`), 게이트가 센 판정 중 blind 판정의 합의율(순수 함수 `blindStatsOf`, `gate.blind`) |
| `network.ts` | NETWORK(4단계, 읽기 전용): ROUTE마다 열린 FLIGHT, 14일 ARRIVED, AIRCRAFT, 착륙 대기(순수 함수 `routeRows`, `openPhase`). AIRCRAFT마다 TARGETS 대 `fleetView` 실적(순수 함수 `aircraftRows`). 28일 LOGBOOK·게이트 추세(순수 함수 `logbookTrend`, `gateTrend` — `proposals.ts`·`schedule.ts` fold와 `crosscheckRateOf` 위에서). `GET /api/network` |
| `dispatch.ts` | DISPATCH 계획: 후보, 슬롯, 점수(순수 함수 `planDispatch`). 설정은 `dispatch.json`(`teamAirports`, `candidateTeams` 포함. `airportOfTicket`, `candidateTeamsOf`) |
| `linear-keys.ts` | Linear 팀·이슈 key: `parseTeamKeys`(`LINEAR_TEAM_KEY` + `LINEAR_TEAM_KEYS`), 읽는 모든 팀의 key를 브랜치·워크트리 이름과 PR 제목에서 찾기 |
| `registration.ts` | 한 REGISTRATION(ATC-67, 순수, 화면과 함께 씀): `registrationOf(name, teamPattern)`는 `teamPattern`이 받는 표기를 `TEAM_X`(대문자, `_`)로 바꾸고, `regKey`·`sameReg`는 이름 비교(팀이 아닌 이름은 대문자), `fleetKeyOf`는 어떻게 적혔든 `fleet.json` 키를 찾고, `registrationNamesOf`는 FLEET의 이름 바꾸기 힌트와 같은 REGISTRATION 충돌을 준다 |
| `proposals.ts` | DISPATCH 제안 기록(추가만 하는 JSONL), 상태 전이(그림자 판정, approve → sent → accepted → departed, STAND 없는 FLIGHT는 READBACK에 departed → CAPTAIN 보고로 arrived), 예약, FLIGHT PLAN 문구(DIRECT 지시서, 보낼 때 이슈 본문을 읽음), 브리핑, 2b·3단계 점검, 2b 점검표용 코드 사실(`selfCheck2b`) |
| `readiness.ts` | "2b 켜기 점검표"(순수 함수 `readiness2bOf`, `vocadoReadbackOf`, `airportReadbackOf`, `sendGuardOf`. 코드 사실은 `selfCheck2b`와 `selfCheckCrewChange`. `candidateTeams`가 배정할 수 있는 AIRPORT마다 `readback-*` 항목 하나, 각각 `[DISPATCH D-xxxx]`와 `[OCC CC-xxxx]` 규칙이 다 있어야 ready). `occ/send-guard.mjs`, vocado `CLAUDE.md`(`ATC_VOCADO_CLAUDE_MD`, 없으면 `<projectsDir>/vocado_nextjs/CLAUDE.md`), 이 저장소의 루트 `CLAUDE.md`, 등록부의 다른 AIRPORT `CLAUDE.md`를 모두 읽기만 한다 |
| `schedule.ts` | OCC SCHEDULE 초안 기록(추가만 하는 JSONL, S1 그림자 운용): `CLASSIFY`·`PRIORITIZE`·`TAIL` 초안(TAIL 검사·라벨 집합·CAUTION·`candidates.tail` 신호는 `schedule-tail.ts`, Linear `tail:` 라벨 이름은 `sources/linear-labels.ts`), `WAYPOINT` 초안(ATC-77: 검사, 후보, 마일스톤 쪽으로 본 APPLIED·SUPERSEDED, WAYPOINT 없는 ROUTE 알림은 `schedule-waypoint.ts`)과 `NEW`(CHARTER DESK의 AD HOC FLIGHT: 본문 칸, 프로젝트·tail·key 검사, 최근 45일 스냅샷에서 찾은 비슷한 제목 `similar`), 열린 초안 5건 한도, SUPERSEDED·EXPIRED 동기화, 그림자 판정, 후보, S2 점검 |
| `waypoint-gaps.ts` | OCC용 WAYPOINT gap(ATC-8, [docs/occ.ko.md](../docs/occ.ko.md) 5.6): ROUTE마다 지금·다음 WAYPOINT의 완료 기준(없으면 설명), 이슈, `truncated`(순수 함수 `waypointGapsOf`, `routes.ts`의 `waypointStates`·`criteriaOf` 위). 기준과 이슈 짝짓기는 OCC 몫 |
| `network-drafts.ts` | OCC의 `TARGET`·`ROUTE` 초안(ATC-25, [docs/fleet.ko.md](../docs/fleet.ko.md) 7.4): 검사(`applyPatch`와 같음, 변화 한도, 14일 ARRIVED 3건, AOG·퇴역 아님), NETWORK 함수로 만든 근거, FLEET 프로필과 비교한 변경, SUPERSEDED 사유. `schedule.ts`가 끼우고, 그림자 판정만 |
| `waypoint-gates.ts` | WAYPOINT 완료 기준에 atc 게이트([docs/routes.ko.md](../docs/routes.ko.md) 6단계): 완료 기준을 DISPATCH·SCHEDULE 게이트, 2b 점검표, 모드, ATFM 켜기 조건 행, RECALL에 맞추는 규칙과 점검 만들기(`criterionCheck`, 순수 함수). `routes.ts`가 사실을 모으고(60초 캐시) WAYPOINT마다 `checks`를 더한다 |
| `waypoint-slips.ts` | OCC용 WAYPOINT ETA와 지연 경고(ATC-24, [docs/occ.ko.md](../docs/occ.ko.md) 5.7): ROUTE MAP 위의 `waypointEtasOf`, `slipOf`(`target-passed`, `eta-after-target`, `linear-overdue`), 보고한 key를 두는 `waypoint-slips.json`(`ackSlips`, FOLLOWING과 같은 방식) |
| `crosscheck.ts` | DISPATCH·SCHEDULE가 함께 쓰는 CROSSCHECK mark: 입력 검사(agree/disagree, 이유 500자 이내), 사람 판정과의 일치율, 보정용 예시, 판정 방식(`via`, 순수 함수 `viaOf`)과 한 번 클릭 건수(순수 함수 `oneClickOf`) |
| `reasons.ts` | DISPATCH 거절 사유 칩(`REASON_CODES`), 입력 검사, 기록할 `reason` 글(순수 함수 `composeReason`), 칩별 건수 |

모듈 옆의 `*.test.ts`가 그 모듈의 단위 테스트다.

## API

| 메서드와 경로 | 하는 일 |
|---|---|
| `GET /api/snapshot` | 현재 스냅샷 |
| `GET /api/events` | SSE 스트림: 연결할 때와 바뀔 때 `version`·`snapshot`, `alert`, 그리고 `ping`. `?topics=`는 `snapshot`·`alert`·`version`·`summary` 중 쉼표로 고르는 선택 항목이다(ATC-153). 없으면 지금까지처럼 `summary`만 뺀 전부를 보낸다. `ping`은 늘 보내고 모르는 이름은 `400`이다. `summary`는 연결할 때와 내용이 바뀔 때 아래 요약을 보낸다 |
| `GET /api/supervisor/queue` | SUPERVISOR QUEUE(ATC-194), 읽기만, 5초 캐시. 본문 `{ v: 1, at, count, counts, items }`: `counts`는 여덟 kind(`PROPOSAL`, `SCHEDULE`, `FLEET PLAN`, `HUMAN CHECK`, `LANDING`, `UPDATE`, `NEEDS YOU`, `GO`)를 0도 포함해 모두 담고, `items`는 `{ kind, key, since, title, hash }`로 `since`가 오래된 것부터(모르면 맨 뒤) 나열한다. `title`은 atc 말(FLIGHT key·REGISTRATION·PR 번호)만 쓰고 티켓·PR 제목은 싣지 않는다. `hash`는 화면 주소. 순수 함수 `supervisorQueueOf`는 `supervisor-queue.ts`, 자료 모으기는 `supervisor-queue-run.ts` |
| `GET /api/supervisor-summary` | SUPERVISOR 요약(ATC-153), 읽기만, 첫 스냅샷 전에는 `503`. 본문 `{ v: 1, at, master, counts, pending, fuel, rts, working, needsYou }`: `at`은 ISO 8601 UTC, `master`는 `"warning"`·`"caution"`·`null`(알림 목록의 가장 높은 등급), `counts`는 `{ warning, caution, advisory }`(`GET /api/supervisor-alerts`의 등급별 수, 등급 없는 항목은 세지 않는다), `pending`은 `{ dispatch, humanCheck, tool, schedule }`(`schedule`은 approval 모드에서 SUPERVISOR를 기다리는 SCHEDULE 판정 수, ATC-162), `fuel`은 `null`이거나 `{ label, windows: [{ name, pct, resetsAt }] }`(가장 많이 쓴 ACCOUNT, `label`은 ACCOUNT 라벨이나 `group`), `rts`는 `null`이거나 `{ result, at, from, to }`(마지막 RTS 기록), `working`은 `{ aircraft, control }`(busy인 AIRCRAFT REGISTRATION 수와 busy인 관제 세션 수), `needsYou`는 SUPERVISOR를 기다리는 항목(cue `call`)의 AIRCRAFT 이름(중복 없이 정렬). 필드 이름은 `v: 1` 안에서 바뀌지 않고, 깨는 변경은 `v`를 올린다 |
| `GET /api/readability?days=<n>` | READABILITY R0(ATC-176, [docs/readability.md](../docs/readability.md)), 읽기만. `{ at, days, today }`: 저장된 최근 n일 줄(기본 7, 1~60, 아니면 `400`)과 요청 때 계산한 오늘의 부분 지표. 답은 첫 줄(200자까지)과 길이만 둔다. 본문은 두지 않는다 |
| `GET /api/radio?since=<iso>&freq=<list>&limit=<n>` | RADIO R1(ATC-170, [docs/radio.md](../docs/radio.md) "R1 as built"), 읽기만. `{ at, since, transmissions }`, 오래된 것부터: 기록된 교신(CLEARANCE, FLIGHT PLAN, RECALL, CREW CHANGE, ARRIVED 보고, MCC·RTS)을 `radioOf`(`radio.ts`)가 `{ id, at, freq, from, to, kind, head, body?, flight?, airport?, aircraft?, replyTo?, open?, overdueAt?, orphan? }`로 합친 것. `since` 기본은 지난 6시간, `freq`는 `DELIVERY`·`TOWER`·`GROUND`·`COMPANY`의 쉼표 목록, `limit`은 최근 n개(상한 2000). 잘못된 값은 `400` |
| `GET /api/radio/<id>.wav[?voices=TOWER:name,…]` | RADIO R3(ATC-172), 교신 하나의 문구를 요청 때만 WAV로 만든다(고른 엔진, 기존 음성 캐시. 미리 만들지 않는다). 모르는 교신이나 문구가 없는 교신은 `404`, `.wav`가 없으면 `400`, 엔진·목소리가 없으면 `503`. 문구는 필드로만 만들고 기록된 본문은 쓰지 않는다 |
| `GET /api/version` | `{build, startedAt}`: 지금 내주는 번들(`/assets/index-<hash>.js`, 빌드가 없으면 `null`)과 서버 시작 시각 |
| `GET /api/airports` | 전체 AIRPORT와 상태 |
| `POST /api/airports` | AIRPORT 개설 `{path, code?, name?}` |
| `PATCH /api/airports/:id` | 이름·코드 변경, 폐쇄·재개 `{code?, name?, closed?}` |
| `DELETE /api/airports/:id` | 수동 개설한 AIRPORT 삭제 |
| `GET /api/controller/brief?consumer=controller` | 지난 ack 이후 이벤트 + 현재 상태(`landingQueue` 항목에 `landBy`(`mcc`·`supervisor`·`holder`, ATC-151), CLEARED 항목에 `repoSeq`와 `landBy`가 `holder`일 때만 `landText`, APPROACH 항목에 `blocks[].en`(한국어 `text` 옆의 영어)과 `infoText`(`PR #n cannot land yet: …`, ATC-174). FUEL 경고 `open.fuelLeaks`·`open.coldCache`·`open.fuelError`, ATC-56) |
| `POST /api/controller/ack` | 브리핑 처리 완료 `{cursor}` |
| `POST /api/clearances` | CLEARANCE 기록 `{to, type, stand?, flight?, text}`, 보낼 문구 반환 |
| `POST /api/clearances/:id/readback` · `/roger` · `/unable` · `/standby` · `/cancel` | 팀의 답(ATC-122, `response.ts`): READBACK·ROGER(R만)·UNABLE `{reason}`은 닫고, STANDBY(W/U만)는 overdue를 한 번 다시 센다 · 취소 |
| `GET /api/metrics?days=1..30` | 운용 지표 |
| `GET /api/fuel?days=1..30` | FUEL BURN(읽기 전용, 기본 7일. METRICS FUEL 개요(ATC-137)용 `byDay`(UTC 날짜별), `byModel`, `teamPattern`도 싣는다): 세션·AIRCRAFT(세션 이름)별 다섯 가지, CAPTAIN 대 CREW(`outputLowerBound`, `nullStopShare`, agent 종류), CACHE HIT, 모델, compaction과 모르는 줄 수. 규칙별 FUEL LEAK(`leak`: `coldCache`, `controlWake`, `modelSwitch`, `compaction`, `sessionChange`, `upgrade`, `unexplained`, `total`과 그중 CREW 몫 `crew`. `expectedRebuild`·`proxied`는 밖에 따로)와 큰 순서 20개 `leakEvents`. CREW 경고(`crewWarnings` 수, 최근 50개 `crewWarningEvents`), `sessionBaselines`(AIRPORT별 새 세션 기준선). `scan`에 읽은 파일·바이트·시간. FLIGHT별 귀속(F4): `aircraft[].attribution`이 AIRCRAFT마다 `flights`(ARRIVED)·`enRoute`·`unattributed`(UNATTRIBUTED)로 나누고 각각 CAPTAIN·CREW·합. `attribution.totals`(모든 세션), `attribution.flights`(기간 안 FLIGHT별, `leak`·`crewWarnings`와 ATC-59부터 `byModel`로 매긴 `fuelCost` 포함). 토큰 옆에 USD FUEL COST(F5, CAPTAIN·CREW·total마다 `cost`, 값 없는 `unpriced` 요청), NET FUEL(`netCost`), 값 없는 모델의 `priceWarnings`, `prices`(가격표 출처·파일·오류) |
| `GET /api/routes` | ROUTE MAP: ROUTE마다 열린 FLIGHT, AIRCRAFT, 완료 속도, WAYPOINT(FLIGHT·완료 기준·ETA)(읽기 전용) |
| `GET /api/network` | NETWORK 개요: ROUTE, AIRCRAFT TARGETS 대 실적, 28일 추세, 출처 상태(읽기 전용) |
| `GET /api/squelch` | SQUELCH `config`(`mode` `off` \| `shadow` \| `on`, 역할별 `heartbeatMin`)와 역할별 마지막 통과 `{fp, openedAt, quietSince, quietCount}` |
| `POST /api/squelch/:role` | `tower` \| `mcc` \| `occ` \| `crosscheck` \| `review`의 판정: `{open, reason, quietSince, quietCount}`. `reason`은 `first`·`manual`·`signal`·`heartbeat`·`off`이고, `shadow`(기본, 늘 `open: true`)에서는 `shadow:quiet`나 `shadow:<reason>`. 내부 오류는 `200 {open: true, reason: "fail-open", error}`, 모르는 역할은 404. `squelch.json`을 쓰고 `squelch.jsonl`에 한 줄을 붙인다 |
| `GET /api/dispatch/brief` | DISPATCH 계획, 열린·최근 제안(`via`, `reasonCodes`), `delivery`(ATC-76: 제안 AIRCRAFT마다 출처·permission mode·OCC mode·`warn`), 2b 점검(`crosscheck.oneClick`, `reasonCounts`), `gate3.standFree`, 2b 켜기 점검표 `readiness2b`(`readiness.ts`), FLIGHT 요약, 거절 칩 `reasonCodes: [{code, label}]`. 열린·HELD 카드의 `briefs`(`facts`, `lead`. `facts.tripFuel`·`facts.coldCache`, ATC-56). `fuel`(`coldCache`, `largeLeaks`, `error`: OCC가 보는 FUEL 경고, ATC-56) |
| `POST /api/dispatch/proposals/:id/verdict` | SUPERVISOR의 그림자 판정 `{verdict: "agree" \| "disagree", reason?, via?, reasonCodes?}`(`reasonCodes`는 `disagree`에만, 모르는 code는 400) |
| `POST /api/dispatch/proposals/:id/note` | DISPATCH 검토 메모 `{text, caution?}` |
| `POST /api/dispatch/proposals/:id/briefing` | BRIEFING `{what, why, risk}`(열린·HELD 제안에만, 앞의 것을 덮어씀) |
| `POST /api/dispatch/proposals/:id/hold` | DISPATCH가 선행 FLIGHT로 HOLD `{blockedBy: ["VOC-180"]}`, 제안은 HELD로 간다. `[]`는 선행 없는 HOLD(메모 필요) |
| `POST /api/dispatch/proposals/:id/unhold` | SUPERVISOR가 HOLD를 풂(제안은 SUPERSEDED) |
| `POST /api/dispatch/proposals/:id/{approve,reject}` | approval 모드에서 SUPERVISOR 결정, 둘 다 `{via?}`, `reject`는 `{reason?, reasonCodes?}`도 |
| `POST /api/dispatch/proposals/:id/release` | 승인 → SENT, `sendTo`와 FLIGHT PLAN 문구 반환 |
| `POST /api/dispatch/proposals/:id/undelivered` | OCC의 FLIGHT PLAN `SendMessage`가 실패함(ATC-183): `{reason}`(필수, 300자 이내), `sent` 제안에만(아니면 `409`). `undelivered` op를 더해 제안을 `approved`로 돌리고(승인 시각 유지, SUPERVISOR 판정 아님) `undelivered: { at, reason, n }`, FOLLOWING CAUTION 경보 하나, RADIO 호출에 `undelivered` 표시. `…/release`는 그 AIRCRAFT에 살아 있는 세션이 없으면 `409` `AIRCRAFT 세션 없음 — 보내지 않음 (LAUNCH 필요)`(`launch` 카드는 뺀다) |
| `POST /api/dispatch/proposals/:id/await-supervisor` | CAPTAIN이 자기 사용자를 기다리는 sent 제안(ATC-120): `{reason}`. `sent` 그대로 `awaitSupervisor`, 경보는 제안마다 한 번. `GET /api/dispatch/brief`는 `confirm`(SUPERVISOR CONFIRM AT AIRCRAFT, `supervisor-confirm.ts`)도 싣는다 |
| `POST /api/dispatch/proposals/:id/{accept,decline,standby}` | CAPTAIN READBACK, `{reason}`과 함께 거절(`UNABLE D-xxxx`), 또는 STANDBY(ATC-122). STAND 없는 FLIGHT는 READBACK에 DEPARTED(`readbackOps`) |
| `POST /api/dispatch/proposals/:id/arrived` | STAND 없이 DEPARTED한 FLIGHT의 CAPTAIN 보고 `{note}`를 OCC가 적음 → ARRIVED |
| `GET /api/dispatch/proposals/:id` | 제안 하나와 지금 모드(send-guard용) |
| `POST /api/dispatch/mode` | `{mode: "shadow" \| "approval"}` 전환(`dispatch.json`에 저장) |
| `GET /api/dispatch/flight/:key` | Linear에서 티켓 본문과 댓글(읽기 전용) |
| `GET /api/duty/brief` | DUTY L0(ATC-219): atc가 아는 것의 한 장 글 요약(`{v, at, chars, truncated, text}`), `duty.briefMaxChars`까지. 읽기 전용 |
| `POST /api/duty/card` `{kind, key}` | DUTY 초안: `<kind>/<key>`가 지금 SUPERVISOR QUEUE의 줄일 때만 받는다. 상태 폴더의 `duty-drafts.jsonl`에 한 줄을 붙일 뿐 밖으로 나가는 것은 없다 |
| `POST /api/duty/note` `{text, until?}` | DUTY 초안: 정해 둘 결정의 제안(`decisions.jsonl`은 D4). `duty-drafts.jsonl`에 붙인다 |
| `POST /api/duty/charter` `{text}` | DUTY 초안: CHARTER REQUEST, 영어만. `duty-drafts.jsonl`에 붙인다. OCC는 아직 읽지 않는다(D5) |
| `POST /api/duty/stand` `{name}` · `POST /api/duty/stand-done` `{name}` | DUTY L1(D7a, ATC-235): `.claude/worktrees/duty-<name>`을 만들거나 치운다(브랜치 `claude/duty-<name>`을 `origin/main`에서, `node_modules` 하드링크). git 명령은 서버가 돌린다. 외부 부작용. **`duty.json`의 `l1`이 꺼져 있으면 403이고, `Origin` 헤더가 있는 요청은 모두 403**(atcctl만). 한 번마다 FLIGHT RECORDER 한 줄 |
| `POST /api/duty/linear` `{action: create\|update\|comment, …}` | DUTY L1(D7a): 서버의 키로 Linear **ATC** 팀에 쓴다(`create`는 우선순위 1~4 필수, 상태는 Backlog·Todo만, 있는 라벨만, 삭제·닫기 없음). STAND 길과 같은 스위치·Origin 규칙. 한 번마다 FLIGHT RECORDER 한 줄, 본문은 적지 않는다 |
| `GET /api/flight/:key/detail` | FLIGHT 서랍(DUTY G1): Linear 이슈 본문, 상태, 라벨, 막는 FLIGHT, 상위·하위, 붙은 PR, 댓글 20개. 읽기 전용, 60초 캐시 |
| `POST /api/flight/:key/state` | FLIGHT 상태 버튼(DUTY G3, [docs/duty.md](../docs/duty.md)): 본문 `{ from, to }`(상태 이름). Linear에 쓰는 유일한 길. 이 화면에서 온 요청만(`fromThisApp`, 아니면 `403`), 지금 상태가 아직 `from`일 때만(아니면 `409`), `to`는 그 팀의 Backlog·Todo·Canceled 상태만(아니면 `400`), 옮기는 출발점도 그런 상태일 때만(아니면 `409`). 시도마다 FLIGHT RECORDER 한 줄 |
| `GET /api/pr/:airport/:number/detail` | PR 서랍(DUTY G1): `gh pr view`의 본문·체크·파일·리뷰, 폴링하는 열린 PR은 착륙 상태·등급·MCC INSPECTION도. 읽기 전용, 60초 캐시. `ATC_GITHUB=off`면 `503 {off:true}` |
| `POST /api/pr/:airport/:number/merge` `{head}` | MERGE(DUTY G2, SUPERVISOR 전용: `fromThisApp`, 아니면 403): MCC AIRPORT의 user 등급(또는 MCC가 ESCALATE한) CLEARED PR을 정확히 `head`(40자 sha, `gh api PUT …/merge -f sha=`)로, AIRPORT의 머지 방식으로 머지한다. auto-merge는 켜지 않는다. head가 움직였거나(`currentHead`) CLEARED가 아니거나 HOLD면 409, auto·flagged는 403. 시도마다 FLIGHT RECORDER 한 줄 |
| `GET /api/dispatch/flight/:key/brief?to=TEAM_X` | 그 FLIGHT의 DIRECT 배정 문구 `{key, brief, text}`(Linear 읽기 전용) |
| `GET /api/schedule/brief` | SCHEDULE 모드(`shadow`), 열린 초안과 초안마다 바뀔 것, 최근 7일에 닫힌 초안(`via`), S2 점검(`crosscheck.oneClick`), 열린 초안 한도, 후보, FLIGHT 요약. `waypointGaps`(ATC-8), `waypointEtas`와 `fresh`가 붙은 `slips`(ATC-24). 후보의 `candidates.waypoint`와 `fresh`가 붙은 `routesWithoutWaypoints`(ATC-77). `judges`(ATC-36: 스위치, 계열별 일치율, 판정한 초안의 mark만) |
| `POST /api/schedule/routes/ack` | OCC가 알린 WAYPOINT 없는 ROUTE를 `routes-without-waypoints.json`에 적는다(ATC-77, ROUTE 이름 `{keys?}`, 없으면 지금 fresh 전부) |
| `POST /api/schedule/slips/ack` | OCC가 보고한 WAYPOINT 지연 경고를 `waypoint-slips.json`에 적는다(`{keys?}`, 없으면 지금 fresh 전부) |
| `GET /api/schedule/ops/:id` | SCHEDULE 작업 하나와 모드 |
| `POST /api/schedule/ops` | OCC 초안. `CLASSIFY`·`PRIORITIZE`: `{kind, flight, reason, type?, wake?, ratings?, priority?}`. `TAIL`: `{kind: "TAIL", flight, registration, reason}`. `WAYPOINT`: `{kind: "WAYPOINT", flight, milestone, reason}`(마일스톤 이름이나 id). `NEW`: `{kind: "NEW", title, body, project, reason, priority?, type?, wake?, ratings?, tail?, parent?, related?, blockedBy?}` → `flight: null`, `payload.similar: [{key, title}]`인 작업. 입력이 틀리면 400, 열린 초안이 한도면 409 |
| `POST /api/schedule/ops/:id/verdict` | SUPERVISOR 그림자 판정 `{verdict: "agree" \| "disagree", reason?, via?}` |
| `POST /api/schedule/ops/:id/approve`, `/reject` | S2에서만: SUPERVISOR 승인, 또는 `{reason?}`와 함께 거절. 둘 다 `{via?}` |
| `POST /api/schedule/ops/:id/release` | S2에서만: OCC가 승인된 작업을 발부. 정확한 Linear 호출을 돌려준다(이미 발부됐으면 같은 호출) |
| `GET /api/schedule/released` | 모드와 발부된 호출 전부, 호출마다 `used`(linear-guard가 읽음) |
| `POST /api/schedule/released/claim` | `{tool, input}`: linear-guard가 맞는 발부 호출을 한 번 쓴 것으로 기록. 이미 쓴 호출이나 없는 호출은 409 |
| `POST /api/schedule/mode` | `{mode: shadow\|approval}` |
| `GET /api/autoland` | AUTOLAND 설정, 상태, 지금 계획(`view`), 최근 기록 50줄 |
| `POST /api/autoland/hold` | SUPERVISOR만(이 화면): `{repo, number, hold}` PR에 HOLD를 달거나 푼다 |
| `GET /api/human-check` | HUMAN CHECK 대기열(class PR 중 head에 `done`이 아닌 것)과 최근 기록 50줄(ATC-37) |
| `GET /api/human-check/:owner/:name/:number/evidence` | 그 PR head의 증거 댓글 이미지와 RUN-UP 요약 |
| `GET /api/human-check/:owner/:name/:number/runup/:run/<파일>` | 그 head의 RUN-UP 보고서 파일. 보고서 폴더 안만, `Content-Security-Policy: sandbox`로 |
| `POST /api/human-check/:owner/:name/:number` | SUPERVISOR만(이 화면): `{result: pass\|fail, head, note}` `Human check` 줄 하나를 쓰고 댓글 하나를 단다. head에 묶임 |
| `GET /api/standfree` | STAND 없는 FLIGHT의 ARRIVED 후보와 24시간 지표(ATC-72) |
| `POST /api/dispatch/standfree/:flight/arrived` | 직접 배정된 STAND 없는 FLIGHT를 OCC가 확인한 ARRIVED: `{aircraft, note}`. 착수는 DEPARTURE LOG의 `readback` 줄. PR 없는 LOGBOOK 줄을 쓴다 |
| `POST /api/autoland/groundstop/clear` | SUPERVISOR만(이 화면): `{airport}` AUTOLAND GROUND STOP을 푼다. 그 main SHA로는 다시 걸지 않는다 |

## 디스크에 두는 상태

모두 `ATC_STATE_DIR`(기본 `~/.local/state/atc`) 아래, git 밖에 있다.

| 경로 | 쓰는 곳 | 내용 |
|---|---|---|
| `claims/<sessionId>/*.json` | [점유 hook](../hooks/README.ko.md) | 워크트리 점유(서버는 읽기만 함) |
| `rules-ack/<sessionId>.json`, `rules-ack/blobs/` | [rules-drift hook](../hooks/README.ko.md#rules-drift-hook) | 세션마다 확인한 규칙 파일 해시와 diff용 내용(서버는 읽기만 함, ATC-42) |
| `airports.json` | `airports.ts` | AIRPORT 등록부 |
| `clearances.jsonl` | `clearances.ts` | CLEARANCE 기록(추가만 함) |
| `crew-changes.jsonl` | `crew-change.ts` | CREW CHANGE 지시문(추가만 함, `created`·`approved`·`sent`(보낸 문구 그대로)·`acknowledged`·`delivered`·`superseded` 줄) |
| `consumers/<name>.json` | `controller.ts` | 소비자별 브리핑 커서 |
| `flight-recorder/YYYY-MM-DD.jsonl` | `recorder.ts` | FLIGHT RECORDER(UTC 날짜, 30일 보관) |
| `logbook.jsonl` | `logbook.ts` | ARRIVED FLIGHT의 LOGBOOK(추가만 함, `arrived`·`reverted`·`attributed`·`measured` 줄). ATC-53 뒤에 쓴 `arrived` 줄에는 `fuel: {captain, crew, cacheHit, leak, crewWarnings, models}`가 있을 수 있다 |
| `departures.jsonl` | `departures.ts` | 착수 기록(DEPARTURE LOG): FLIGHT의 첫 STAND·claim과 HANDOFF, 바뀔 때만(추가만 함) |
| `proposals.jsonl` | `proposals.ts` | DISPATCH 제안(추가만 함) |
| `schedule.jsonl` | `schedule.ts` | OCC SCHEDULE 초안과 SUPERVISOR 판정(추가만 함) |
| `autoland.json` | `autoland.ts` | AUTOLAND 스위치(`mode`, 기본 off), `airports`, `mergeMethod`, `applicationCheck`, `holds`(원자적으로 바꿔 씀) |
| `autoland-state.json` | `autoland-run.ts` | AUTOLAND 비행 중인 갱신, GROUND STOP, 푼 main SHA, 건너뛴·머지한 head, head별 재리뷰 요청 |
| `human-checks.jsonl` | `human-check-run.ts` | SUPERVISOR가 기록한 HUMAN CHECK 결과: PR, head, pass·fail, class, 메모, 댓글 URL, 오류(추가만) |
| `autoland.jsonl` | `autoland-run.ts` | AUTOLAND 기록: 갱신, 머지, 결과, GROUND STOP, 스위치·HOLD 변경(추가만 함) |
| `judges.json` | `judges/store.ts` | 판정 계열 스위치(`jev`: `off`·`replay`·`shadow`, 기본 off). SUPERVISOR만, 설정 창에서(원자적으로 바꿔 씀) |
| `judges.jsonl` | `judges/run.ts` | 판정 계열 mark(`judge`: 계열, 초안, 분류, 판정, 엔진, 모델, 보낸 칸)와 스위치 변경(`mode`), 추가만 함 |
| `dispatch.json` | 사용자(선택, 없으면 기본값) | DISPATCH 설정: 프로젝트 → AIRPORT 매핑, 슬롯, 가중치, 모드(`shadow` / `approval`) |
