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

`/api/events`는 연결하면 `event: version`(`{build, startedAt}`)과 현재 스냅샷을 보내고, 이후 스냅샷이 바뀔 때마다, build가 바뀔 때마다 `version`을 다시 보내며, 25초마다 `ping`을 보낸다. 재시작 뒤 EventSource가 스스로 다시 붙으므로, 열려 있던 탭은 폴링 없이 배포를 알고 "새 버전이 배포됨 · 새로고침" 알림을 띄운다.

## 소스 (`sources/`)

| 파일 | 읽는 것 | 얻는 것 |
|---|---|---|
| `claude.ts` | `~/.claude/sessions/*.json`, hook 점유 파일, 대화 기록(`~/.claude/projects/…`) | Claude 세션, `hook` 점유, `transcript` 점유(ESTIMATED TRACK, `hooks/paths.mjs`와 같은 규칙) |
| `codex.ts` | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | Codex 세션(최근 90초 안에 움직였으면 busy), `cwd` 점유 |
| `git.ts` | AIRPORT마다 `git worktree list --porcelain` | 워크트리, 브랜치, HEAD, dirty 여부, 마지막 커밋(세부는 30초 캐시). 브랜치 이름에서 티켓 키 |
| `linear.ts` | Linear GraphQL(`LINEAR_API_KEY`), 60초마다, `LINEAR_TEAM_KEYS`의 팀마다 따로 | 티켓, 상태(팀끼리 이름으로 합침), 우선순위, 프로젝트, 관계. DISPATCH용 이슈 본문. 실패한 팀은 마지막 결과를 쓰고, 한 번도 읽지 못한 팀이 있으면 전체가 실패 |
| `linear-projects.ts` | Linear GraphQL, 프로젝트와 프로젝트 마일스톤을 읽는 읽기 전용 쿼리 둘. `LINEAR_TEAM_KEYS`의 팀마다 돌려 합친다(`mergeByTeam`, 각각 `teams`). 10분 캐시 | NETWORK ROUTE 목표용 프로젝트 `name`, `targetDate`, `progress`, `status { name type }`(`state`로: type, 없으면 name). 마일스톤(루트 `projectMilestones`, 쪽마다 50개씩 10쪽까지, 이슈는 50개까지 읽고 넘으면 `truncated`): `name`, `description`, `targetDate`, `progress`(0~100 → 0~1, 순수 함수 `toMilestone`), `sortOrder`, `status`, 이슈마다 key·제목·상태·`completedAt`. 키가 없거나 실패하면 목표는 `null`, 마일스톤만 실패하면 WAYPOINT만 빈다 |
| `github.ts` | git remote가 GitHub인 AIRPORT마다 `gh pr list --repo <owner/name> --state open --json …`, 90초마다 백그라운드로(`execFile`, 셸 없음) | AIRPORT별 열린 PR: head, 체크, 리뷰, 머지 상태, Draft. head에 통과 리뷰가 없거나 Codex 지적이 있는 Draft 아닌 PR은 Codex 봇의 👍 반응, head committer 시각(sha별 캐시), Codex의 PR 댓글도(`gh api`, 읽기 전용). 실패한 저장소는 마지막 결과를 두고 오류는 `snapshot.github.error`에. `gh`가 없으면 `enabled`가 false. LOGBOOK용 `listMerged`는 기본 브랜치에 머지된 최근 PR 30건을 읽는다(`gh pr list --state merged --base <기본 브랜치>`, 기본 브랜치는 저장소별 캐시) |

## 모듈

| 파일 | 역할 |
|---|---|
| `index.ts` | 진입점: tick 반복, SSE, API 연결, `web/dist` 제공 |
| `config.ts` | `.env.local`과 환경 변수 읽기([deploy](../deploy/README.ko.md#설정)) |
| `model.ts` | 공용 타입: `Session`, `Airport`, `Workspace`, `Ticket`, `Claim`, `Handoff`, `Alert`, `Clearance`, `TrafficEvent`, `PullRequest`, `LandingBlockCode`, `Snapshot`. 웹 화면이 그대로 가져다 쓴다 |
| `snapshot.ts` | 소스 병합, TTL 안의 점유만 남기기, 경보와 `pulls` 계산. 스냅샷 필드: `linear`·`github` 상태(`{enabled, error, fetchedAt}`), `sessions`, `workspaces`, `tickets`, `columns`, `airports`, `claims`, `handoffs`, `alerts`, `clearances`, `pulls`(열린 PR, CLEARED 먼저) |
| `landing.ts` | PR마다 CLEARED TO LAND 조건(체크, head 리뷰, 머지 상태, Draft, LOS), head별 `readyAt`, LANDING SEQUENCE 순서(순수 함수 `buildPulls`, `landingBlocks`) |
| `autoland.ts` | AUTOLAND(ATC-34, [docs/occ.ko.md](../docs/occ.ko.md) 9.7): `autoland.json`의 스위치와 HOLD(`parseAutoland`, `saveAutoland`), `autoland-state.json` 상태, merge 제외 목록(순수 함수 `mergeExclusionOf`, `humanPreviewOf`), GROUND STOP 걸기(순수 함수 `latchGroundStops`), 갱신이 끝났나(순수 함수 `settleOf`), 리뷰가 이어지지 않은 갱신의 재리뷰(ATC-38, 순수 함수 `reviewRequestOf`, `escalateOf`, `fastTrackOf`), AIRPORT마다 할 일 하나와 PR마다 표시(순수 함수 `planAutoland`, `snapshot.autoland`) |
| `autoland-run.ts` | GitHub을 새로 읽을 때마다 AUTOLAND 한 주기: GROUND STOP 걸기, 갱신 정리, `update-branch`(`expected_head_sha`)나 정확한 head 머지(`sha`), 리뷰가 이어지지 않은 갱신 뒤 head마다 PR 댓글 `@codex review` 하나(ATC-38). 쓰기 직전에 스위치를, 머지면 PR 자체를 다시 본다. `autoland.jsonl` 기록. `GET /api/autoland`, `POST /api/autoland/hold`, `POST /api/autoland/groundstop/clear` |
| `origin.ts` | `fromThisApp`: localhost `Origin`이 있는 JSON 요청(이 화면)만 설정, HOLD, GROUND STOP을 바꾼다. `atcctl`은 `Origin`을 보내지 않는다 |
| `occupancy.ts` | 점유 구간 `[since, lastAt]`으로 HANDOFF·충돌·잠깐 들름 판정 |
| `airports.ts` | AIRPORT 등록부: `~/projects` 아래 자동 개설, 첫 커밋 해시로 식별, 코드, 개설·폐쇄·이름 변경·삭제 |
| `away.ts` | OUTSTATION: 소속 AIRPORT 밖 STAND를 점유한 세션(화면과 공용) |
| `callsign.ts` | 콜사인(`TEAM_A` → `ALPHA`)과 FLIGHT NUMBER(화면과 공용) |
| `version.ts` | 빌드 정체: `index.html`의 진입 스크립트 경로(순수 함수 `entryScript`)와 탭이 새 버전 알림을 띄울지(순수 함수 `showNewVersion`, 화면과 공용) |
| `events.ts` | 스냅샷 차이 → 이벤트(경보, HANDOFF, LANDING SEQUENCE `landing.requested`·`cleared`·`blocked`·`left`, 세션 종료, OUTSTATION). 커서로 읽는 이벤트 기록 |
| `controller.ts` | CONTROLLER(TOWER) API: 브리핑, ack, CLEARANCE 발행·READBACK·취소, 정해진 문구, CLEARED PR의 LAND 문구(순수 함수 `landTextOf`) |
| `clearances.ts` | CLEARANCE 기록: 추가만 하는 JSONL을 접어 현재 상태를 만든다 |
| `recorder.ts` | FLIGHT RECORDER: 날짜별 JSONL(`event`, `sample`, `dispatch`, `ack`, `schedule`, `checkride`), 30일 보관 |
| `metrics.ts` | 운용 지표와 2단계 진입 점검(순수 함수 `computeMetrics`) |
| `logbook.ts` | LOGBOOK: 10분마다 머지된 PR → ARRIVED FLIGHT마다 `arrived` 줄, 머지된 Revert PR은 `reverted` 줄(순수 함수 `buildEntry`, `planLogbook`, `foldLogbook`). FLEET 카드의 TARGETS 실적(순수 함수 `computeActuals`, `expectationMin`). `GET /api/logbook`. AIRCRAFT와 출발은 착수 기록으로도 찾고, 옛 모름 줄은 `attributed` 줄로 채운다(순수 함수 `attribution`). `measured` 줄로 지시서(VECTORS·DIRECT), SOLO·CREW, PR 뒤 수정 커밋, P0–P2 지적을 더한다(순수 함수 `measureLines`). `GET /api/logbook/briefs` |
| `briefs.ts` | DIRECT 지시서(ATC-32, 순수 함수): 이슈 본문에서 지시서 칸(`directSectionsOf`), 배정 문구(`formatAssignment`), 대화 기록 사건과 FLIGHT의 지시서 사실(`talkEventsOf`, `briefFactsOf`), STAND 안 쓰기로 SOLO·CREW(`crewModeOf`), P0–P2 지적(`findingsOf`), 수정 커밋(`reworkOf`), VECTORS 대 DIRECT 비교(`compareBriefs`) |
| `departures.ts` | 착수 기록(DEPARTURE LOG): 따뜻한 tick마다 점유·워크트리를 STAND별 마지막 AIRCRAFT와 비교해 `stand`·`claim`·`handoff` 줄을 추가(순수 함수 `diffDepartures`, `foldDepartures`). `matchDepartures`가 브랜치·FLIGHT·STAND로 AIRCRAFT와 첫 시각을 찾는다 |
| `crew-observed.ts` | OBSERVED CREW: AIRCRAFT 세션들의 최근 14일 서브에이전트 호출. 세션 메타데이터만 읽는다(`subagents/*.meta.json`의 agentType·model과 파일 시각, 세션 이름은 `custom-title.json`). mtime으로 캐시하고 30초에 한 번까지만 다시 훑는다. 순수 함수 `parseMeta`, `positionOf`(agentType + model → 선언된 POSITION), `observeCrew`(묶기와 drift) |
| `crew-change.ts` | CREW CHANGE: 운항 중인 AIRCRAFT의 COMPLEMENT가 `PATCH /api/fleet/:registration`으로 바뀌면 CAPTAIN에게 줄 지시문을 만들어 추가만 하는 기록에 남긴다. 상태는 pending → approved(SUPERVISOR, approval 모드만) → sent(OCC `atcctl crew-change send`) → acknowledged(READBACK), 또는 delivered·superseded(순수 함수 `diffCrew`, `ratingImpact`, `crewChangeText`, `crewChangeMessage`, `planCrewChange`, `foldCrewChanges`, `approveRefusal`, `sendRefusal`, `openCrewChangeOf`, `crewChangeBriefOf`, 2b 점검표용 `selfCheckCrewChange`). `withCrew`가 FLEET 화면에 `observedCrew`, `crewDrift`, `pendingCrewChange`를 붙인다. `GET /api/fleet/crew-changes`, `…/crew-changes/brief`, `…/crew-changes/:id`, `POST /api/fleet/:registration/crew-change/:id/{approve,delivered}`, `POST /api/fleet/crew-changes/:id/{send,readback}` |
| `checkride.ts` | CHECKRIDE: FLIGHT에 필요했던 rating을 라벨이나 받아들인 SCHEDULE CLASSIFY 초안에서 읽고(순수 함수 `flightRating`), AIRCRAFT·rating마다 GRANT·REVIEW·BLOCKED·BUILDING·HOLDS(순수 함수 `judge`, `checkrideRows`). `GET /api/fleet/checkride`, SUPERVISOR의 부여·회수 `POST /api/fleet/:registration/checkride`(`applyPatch`로 바꾸고 `checkride` 줄로 기록) |
| `routes.ts` | ROUTE MAP(읽기 전용, [docs/routes.ko.md](../docs/routes.ko.md)): WAYPOINT 상태(순수 함수 `waypointStates`), FLIGHT 단계(`phaseOf`, `isBlocked`), 완료 기준(`criteriaOf`), 28일 완료 수(`completedIn`: LOGBOOK ARRIVED ∪ Linear `completedAt`), 누적 ETA(`etaOf`)와 지연(`isLate`)을 `buildRoutes`가 묶는다. AIRCRAFT는 `following.targetsOf`. `GET /api/routes` |
| `briefing.ts` | DISPATCH 카드 BRIEFING(ATC-4, [docs/dispatch.ko.md](../docs/dispatch.ko.md) 5.5): OCC가 쓰는 세 줄(순수 함수 `parseBriefing`), 서버의 사실 줄(순수 함수 `factsOf`, `routes.ts` 위의 `waypointIndex`: PRIORITY, 대기 일수, ROUTE·WAYPOINT, 선행, 그 AIRCRAFT의 같은 ROUTE 최근 FLIGHT, CROSSCHECK), 대신 보일 첫 문장(순수 함수 `firstSentence`. `leadOf`가 Linear 본문을 백그라운드로 읽어 30분 캐시) |
| `blind.ts` | DISPATCH blind 표본(ATC-6, [docs/dispatch.ko.md](../docs/dispatch.ko.md) 5.6): 제안 ID의 FNV-1a 해시로 약 5개에 1개(순수 함수 `isBlind`), 게이트가 센 판정 중 blind 판정의 합의율(순수 함수 `blindStatsOf`, `gate.blind`) |
| `network.ts` | NETWORK(4단계, 읽기 전용): ROUTE마다 열린 FLIGHT, 14일 ARRIVED, AIRCRAFT, 착륙 대기(순수 함수 `routeRows`, `openPhase`). AIRCRAFT마다 TARGETS 대 `fleetView` 실적(순수 함수 `aircraftRows`). 28일 LOGBOOK·게이트 추세(순수 함수 `logbookTrend`, `gateTrend` — `proposals.ts`·`schedule.ts` fold와 `crosscheckRateOf` 위에서). `GET /api/network` |
| `dispatch.ts` | DISPATCH 계획: 후보, 슬롯, 점수(순수 함수 `planDispatch`). 설정은 `dispatch.json`(`teamAirports`, `candidateTeams` 포함. `airportOfTicket`, `candidateTeamsOf`) |
| `linear-keys.ts` | Linear 팀·이슈 key: `parseTeamKeys`(`LINEAR_TEAM_KEY` + `LINEAR_TEAM_KEYS`), 읽는 모든 팀의 key를 브랜치·워크트리 이름과 PR 제목에서 찾기 |
| `proposals.ts` | DISPATCH 제안 기록(추가만 하는 JSONL), 상태 전이(그림자 판정, approve → sent → accepted → departed, STAND 없는 FLIGHT는 READBACK에 departed → CAPTAIN 보고로 arrived), 예약, FLIGHT PLAN 문구(DIRECT 지시서, 보낼 때 이슈 본문을 읽음), 브리핑, 2b·3단계 점검, 2b 점검표용 코드 사실(`selfCheck2b`) |
| `readiness.ts` | "2b 켜기 점검표"(순수 함수 `readiness2bOf`, `vocadoReadbackOf`, `sendGuardOf`. 코드 사실은 `selfCheck2b`와 `selfCheckCrewChange`, `vocado-readback`은 `[DISPATCH D-xxxx]`와 `[OCC CC-xxxx]` 규칙이 다 있어야 ready). `occ/send-guard.mjs`와 vocado `CLAUDE.md`를 읽기만 한다(`ATC_VOCADO_CLAUDE_MD`, 없으면 `<projectsDir>/vocado_nextjs/CLAUDE.md`) |
| `schedule.ts` | OCC SCHEDULE 초안 기록(추가만 하는 JSONL, S1 그림자 운용): `CLASSIFY`·`PRIORITIZE` 초안과 `NEW`(CHARTER DESK의 AD HOC FLIGHT: 본문 칸, 프로젝트·tail·key 검사, 최근 45일 스냅샷에서 찾은 비슷한 제목 `similar`), 열린 초안 5건 한도, SUPERSEDED·EXPIRED 동기화, 그림자 판정, 후보, S2 점검 |
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
| `GET /api/events` | SSE 스트림: 연결할 때와 바뀔 때 `version`·`snapshot`, 그리고 `ping` |
| `GET /api/version` | `{build, startedAt}`: 지금 내주는 번들(`/assets/index-<hash>.js`, 빌드가 없으면 `null`)과 서버 시작 시각 |
| `GET /api/airports` | 전체 AIRPORT와 상태 |
| `POST /api/airports` | AIRPORT 개설 `{path, code?, name?}` |
| `PATCH /api/airports/:id` | 이름·코드 변경, 폐쇄·재개 `{code?, name?, closed?}` |
| `DELETE /api/airports/:id` | 수동 개설한 AIRPORT 삭제 |
| `GET /api/controller/brief?consumer=controller` | 지난 ack 이후 이벤트 + 현재 상태(CLEARED `landingQueue` 항목에 `repoSeq`·`landText`) |
| `POST /api/controller/ack` | 브리핑 처리 완료 `{cursor}` |
| `POST /api/clearances` | CLEARANCE 기록 `{to, type, stand?, flight?, text}`, 보낼 문구 반환 |
| `POST /api/clearances/:id/readback` · `/cancel` | READBACK 확인 · 취소 |
| `GET /api/metrics?days=1..30` | 운용 지표 |
| `GET /api/routes` | ROUTE MAP: ROUTE마다 열린 FLIGHT, AIRCRAFT, 완료 속도, WAYPOINT(FLIGHT·완료 기준·ETA)(읽기 전용) |
| `GET /api/network` | NETWORK 개요: ROUTE, AIRCRAFT TARGETS 대 실적, 28일 추세, 출처 상태(읽기 전용) |
| `GET /api/dispatch/brief` | DISPATCH 계획, 열린·최근 제안(`via`, `reasonCodes`), 2b 점검(`crosscheck.oneClick`, `reasonCounts`), `gate3.standFree`, 2b 켜기 점검표 `readiness2b`(`readiness.ts`), FLIGHT 요약, 거절 칩 `reasonCodes: [{code, label}]`. 열린·HELD 카드의 `briefs`(`facts`, `lead`) |
| `POST /api/dispatch/proposals/:id/verdict` | SUPERVISOR의 그림자 판정 `{verdict: "agree" \| "disagree", reason?, via?, reasonCodes?}`(`reasonCodes`는 `disagree`에만, 모르는 code는 400) |
| `POST /api/dispatch/proposals/:id/note` | DISPATCH 검토 메모 `{text, caution?}` |
| `POST /api/dispatch/proposals/:id/briefing` | BRIEFING `{what, why, risk}`(열린·HELD 제안에만, 앞의 것을 덮어씀) |
| `POST /api/dispatch/proposals/:id/hold` | DISPATCH가 선행 FLIGHT로 HOLD `{blockedBy: ["VOC-180"]}`, 제안은 HELD로 간다. `[]`는 선행 없는 HOLD(메모 필요) |
| `POST /api/dispatch/proposals/:id/unhold` | SUPERVISOR가 HOLD를 풂(제안은 SUPERSEDED) |
| `POST /api/dispatch/proposals/:id/{approve,reject}` | approval 모드에서 SUPERVISOR 결정, 둘 다 `{via?}`, `reject`는 `{reason?, reasonCodes?}`도 |
| `POST /api/dispatch/proposals/:id/release` | 승인 → SENT, `sendTo`와 FLIGHT PLAN 문구 반환 |
| `POST /api/dispatch/proposals/:id/{accept,decline}` | CAPTAIN READBACK, 또는 `{reason}`과 함께 거절. STAND 없는 FLIGHT는 READBACK에 DEPARTED(`readbackOps`) |
| `POST /api/dispatch/proposals/:id/arrived` | STAND 없이 DEPARTED한 FLIGHT의 CAPTAIN 보고 `{note}`를 OCC가 적음 → ARRIVED |
| `GET /api/dispatch/proposals/:id` | 제안 하나와 지금 모드(send-guard용) |
| `POST /api/dispatch/mode` | `{mode: "shadow" \| "approval"}` 전환(`dispatch.json`에 저장) |
| `GET /api/dispatch/flight/:key` | Linear에서 티켓 본문과 댓글(읽기 전용) |
| `GET /api/dispatch/flight/:key/brief?to=TEAM_X` | 그 FLIGHT의 DIRECT 배정 문구 `{key, brief, text}`(Linear 읽기 전용) |
| `GET /api/schedule/brief` | SCHEDULE 모드(`shadow`), 열린 초안과 초안마다 바뀔 것, 최근 7일에 닫힌 초안(`via`), S2 점검(`crosscheck.oneClick`), 열린 초안 한도, 후보, FLIGHT 요약. `waypointGaps`(ATC-8), `waypointEtas`와 `fresh`가 붙은 `slips`(ATC-24) |
| `POST /api/schedule/slips/ack` | OCC가 보고한 WAYPOINT 지연 경고를 `waypoint-slips.json`에 적는다(`{keys?}`, 없으면 지금 fresh 전부) |
| `GET /api/schedule/ops/:id` | SCHEDULE 작업 하나와 모드 |
| `POST /api/schedule/ops` | OCC 초안. `CLASSIFY`·`PRIORITIZE`: `{kind, flight, reason, type?, wake?, ratings?, priority?}`. `NEW`: `{kind: "NEW", title, body, project, reason, priority?, type?, wake?, ratings?, tail?, parent?, related?, blockedBy?}` → `flight: null`, `payload.similar: [{key, title}]`인 작업. 입력이 틀리면 400, 열린 초안이 한도면 409 |
| `POST /api/schedule/ops/:id/verdict` | SUPERVISOR 그림자 판정 `{verdict: "agree" \| "disagree", reason?, via?}` |
| `POST /api/schedule/ops/:id/approve`, `/reject` | S2에서만: SUPERVISOR 승인, 또는 `{reason?}`와 함께 거절. 둘 다 `{via?}` |
| `POST /api/schedule/ops/:id/release` | S2에서만: OCC가 승인된 작업을 발부. 정확한 Linear 호출을 돌려준다(이미 발부됐으면 같은 호출) |
| `GET /api/schedule/released` | 모드와 발부된 호출 전부, 호출마다 `used`(linear-guard가 읽음) |
| `POST /api/schedule/released/claim` | `{tool, input}`: linear-guard가 맞는 발부 호출을 한 번 쓴 것으로 기록. 이미 쓴 호출이나 없는 호출은 409 |
| `POST /api/schedule/mode` | `{mode: shadow\|approval}` |
| `GET /api/autoland` | AUTOLAND 설정, 상태, 지금 계획(`view`), 최근 기록 50줄 |
| `POST /api/autoland/hold` | SUPERVISOR만(이 화면): `{repo, number, hold}` PR에 HOLD를 달거나 푼다 |
| `POST /api/autoland/groundstop/clear` | SUPERVISOR만(이 화면): `{airport}` AUTOLAND GROUND STOP을 푼다. 그 main SHA로는 다시 걸지 않는다 |

## 디스크에 두는 상태

모두 `ATC_STATE_DIR`(기본 `~/.local/state/atc`) 아래, git 밖에 있다.

| 경로 | 쓰는 곳 | 내용 |
|---|---|---|
| `claims/<sessionId>/*.json` | [점유 hook](../hooks/README.ko.md) | 워크트리 점유(서버는 읽기만 함) |
| `airports.json` | `airports.ts` | AIRPORT 등록부 |
| `clearances.jsonl` | `clearances.ts` | CLEARANCE 기록(추가만 함) |
| `crew-changes.jsonl` | `crew-change.ts` | CREW CHANGE 지시문(추가만 함, `created`·`approved`·`sent`(보낸 문구 그대로)·`acknowledged`·`delivered`·`superseded` 줄) |
| `consumers/<name>.json` | `controller.ts` | 소비자별 브리핑 커서 |
| `flight-recorder/YYYY-MM-DD.jsonl` | `recorder.ts` | FLIGHT RECORDER(UTC 날짜, 30일 보관) |
| `logbook.jsonl` | `logbook.ts` | ARRIVED FLIGHT의 LOGBOOK(추가만 함, `arrived`·`reverted`·`attributed`·`measured` 줄) |
| `departures.jsonl` | `departures.ts` | 착수 기록(DEPARTURE LOG): FLIGHT의 첫 STAND·claim과 HANDOFF, 바뀔 때만(추가만 함) |
| `proposals.jsonl` | `proposals.ts` | DISPATCH 제안(추가만 함) |
| `schedule.jsonl` | `schedule.ts` | OCC SCHEDULE 초안과 SUPERVISOR 판정(추가만 함) |
| `autoland.json` | `autoland.ts` | AUTOLAND 스위치(`mode`, 기본 off), `airports`, `mergeMethod`, `applicationCheck`, `holds`(원자적으로 바꿔 씀) |
| `autoland-state.json` | `autoland-run.ts` | AUTOLAND 비행 중인 갱신, GROUND STOP, 푼 main SHA, 건너뛴·머지한 head, head별 재리뷰 요청 |
| `autoland.jsonl` | `autoland-run.ts` | AUTOLAND 기록: 갱신, 머지, 결과, GROUND STOP, 스위치·HOLD 변경(추가만 함) |
| `dispatch.json` | 사용자(선택, 없으면 기본값) | DISPATCH 설정: 프로젝트 → AIRPORT 매핑, 슬롯, 가중치, 모드(`shadow` / `approval`) |
