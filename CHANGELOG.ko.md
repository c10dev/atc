# 변경 기록

[English](CHANGELOG.md) · **한국어**

atc의 주요 변경 사항을 여기에 적는다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를, 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따른다.

## [Unreleased]

### 보안
- TOWER·OCC·CROSSCHECK의 Bash guard(`controller/guard.mjs`)가 `jq`를 인자 검사 없이 통과시켜, 관제 세션이 아무 파일이나 환경 변수를 읽을 수 있었다. gh의 내장 `--jq` 필터도 마찬가지였다. CROSSCHECK는 외부 제공자로 가는 모델이라 이렇게 읽은 비밀은 곧 반출이 된다. structure가 보고했다.
  - 통하던 경로: `jq -R . /home/c10/projects/atc/.env.local`(Linear API 키), `jq . ~/.local/state/atc/fleet.json`, `--rawfile`, `-f`, `jq -n env`·`'$ENV'`, `gh pr view … --jq '$ENV.X'`. stdin만 읽어도 `import "data" as $d {search: "/아무/폴더"}`가 `/아무/폴더/data.json`을 읽었다.
  - 이제 jq는 앞 명령의 출력만 다듬는다. 맨 앞 명령으로 쓸 수 없고, 위치 인자는 필터 하나까지다.
  - 옵션은 허용 목록이다: 출력 형식, `--arg`·`--argjson`·`--indent`만 된다. `-f`/`--from-file`, `--rawfile`, `--slurpfile`, `-L`, `--args`, `--jsonargs`를 포함해 나머지는 모두 막는다.
  - 필터에는 `env`·`$ENV`·`import`·`include`·`modulemeta`·`get_search_list`를 쓸 수 없다. gh의 `--jq`/`-q` 값에도 같은 필터 검사를 하고, `-q`를 다른 짧은 옵션과 붙인 꼴은 막는다.
  - TOWER·OCC·CROSSCHECK 규정에 "jq는 파이프 뒤에만"을 적었다.
- TOWER·OCC의 Bash guard(`controller/guard.mjs`)가 큰따옴표 안의 명령 치환을 통과시켰다: `node atcctl.mjs brief -- "$(touch /tmp/x)"`와 백틱이 막히지 않았다. 쉘은 명령보다 먼저 이것을 실행하므로 관제 세션이 아무 명령이나 돌릴 수 있었다. 이제 작은따옴표 밖의 명령 치환·변수 확장(`$(…)`, 백틱, `${…}`, `$VAR`)을 모두 막는다. 작은따옴표 안과 역슬래시로 이스케이프한 글은 그대로 된다. TEAM_H가 보고했다.

### 추가
- 착수 기록(DEPARTURE LOG)으로 LOGBOOK의 AIRCRAFT 모름 줄을 줄인다([docs/fleet.md](docs/fleet.md) 7.1, 7.5). 2026-09-27 기준 최근 14일 LOGBOOK 62건 중 48건이 AIRCRAFT를 몰랐다. 머지될 때쯤이면 claim이 정리되거나 다시 시작되고 워크트리도 지워지기 때문이다. 이제 따뜻한 tick마다 점유와 워크트리를 STAND별 마지막 AIRCRAFT와 비교해, 바뀔 때만 `~/.local/state/atc/departures.jsonl`에 `{t, flight, aircraft, stand, branch, repo, via}`를 추가한다. `via`는 `stand`(새 워크트리), `claim`(첫 `TEAM_X` 점유, 시각은 그 `since`), `handoff`(앞 팀이 손을 뗀 뒤 다른 팀이 잡음. 동시 점유 중에는 앞 팀 유지)다. 재시작하면 파일을 먼저 접어 같은 줄을 다시 쓰지 않는다. 새 ARRIVED 줄은 AIRCRAFT를 지금 점유에서, 없으면 머지 전 그 PR 브랜치(없으면 FLIGHT·STAND)의 착수 기록 마지막 AIRCRAFT에서 찾는다. 워크트리가 지워졌으면 STAND도 착수 기록에서 찾고, `departedAt`은 점유와 착수 기록 중 가장 이른 것(`departedFrom: "departure"`)이라 `blockMin` 모름도 줄어든다. 줄에 `branch`를 남긴다. AIRCRAFT를 몰랐던 옛 줄은 새 `attributed` op로 채운다(AIRCRAFT, 출발을 몰랐으면 `departedAt`·`blockMin`도). 아직 모르는 줄에만 적용되며, 착수 기록이 생기기 전 줄은 대부분 그대로 모름이 정상이다.
- DISPATCH RECALL(ATFM 결정 4: 자동 배정보다 먼저 만듦, [docs/dispatch.ko.md](docs/dispatch.ko.md) "RECALL").
  - SUPERVISOR가 보냈거나 READBACK 받은 FLIGHT PLAN을 거둬들인다: 진행 중 행의 "RECALL…" 버튼, 또는 `POST /api/dispatch/proposals/:id/recall {reason}`.
  - 새 상태 RECALLING·RECALLED. RECALLING은 AIRCRAFT·FLIGHT를 잡아 두고, DEPARTED로 바뀌지 않으며, 10분이면 overdue, 24시간이면 만료된다. DEPARTED는 RECALL하지 않는다.
  - 서버가 `[DISPATCH D-xxxx] RECALL · <callsign>` 문구(FLIGHT, 사유, "멈추고 STAND는 그대로", 답장 `READBACK D-xxxx RECALL`)를 만든다. OCC는 `atcctl dispatch recall-send`로 보내고 `atcctl dispatch recalled`로 답을 기록한다.
  - send-guard는 approval 모드이고, RECALLING 제안이고, 그 CAPTAIN에게, 문구 그대로일 때만 RECALL을 통과시킨다.
  - RECALLED FLIGHT는 다시 후보가 되지만, 같은 짝은 RECALL READBACK부터 24시간 제안하지 않는다.
  - ATFM 출발 중지는 RECALL을 막지 않는다.
  - OCC 규정·`/tick`, dispatch 문서와 guide, atfm.md(결정 4를 built로 표시)를 고쳤다.
- NETWORK: 4단계 읽기 전용 운항 개요([docs/fleet.md](docs/fleet.md) 7.3, `server/network.ts`). `GET /api/network`는 아무것도 쓰지 않고 다음을 돌려준다. `routes`: ROUTE(Linear 프로젝트)마다 상태별 열린 FLIGHT(`todo`는 unstarted, `inReview`는 상태 이름 In Review·Ready to Merge, `inProgress`는 그 밖의 started. backlog·triage·끝난 것·상위 이슈는 세지 않음), `arrived14`(FLIGHT가 그 프로젝트인 최근 14일 LOGBOOK 기록), FLEET ROUTE에 그 프로젝트가 있는 AIRCRAFT, 그 기록의 착륙 대기 중앙값, 프로젝트 `goal`(`targetDate`, `progress`, `state`) 또는 `null`(`state`는 프로젝트 `status.type`, 없으면 `status.name`). `aircraft`: TARGETS(`flightsPerWeek`, `onTime`)와 FLEET 카드와 같은 `computeActuals` 숫자(퇴역 AIRCRAFT 제외). `trend.days`: 28일 동안 날마다 ARRIVED, 착륙 대기 중앙값, 머지된 되돌림. `trend.gates`: 28일 동안 날마다 DISPATCH·SCHEDULE 그림자 판정 수와 누적 합의율(마지막 날 값이 각 게이트의 `agreement`와 같다), 둘을 합친 누적 CROSSCHECK 일치율. `sources`: Linear·GitHub·LOGBOOK을 읽었나. 프로젝트 목표는 TEAM 프로젝트를 읽는 새 읽기 전용 Linear 쿼리 하나(`server/sources/linear-projects.ts`, 10분 캐시)에서 온다. 키가 없거나 실패하면 목표는 `null`. OCC의 TARGETS·ROUTE 변경 초안은 [docs/fleet.md](docs/fleet.md) 7.4에 설계만 적었다(만들지 않음).
- ATFM 3단계, [docs/atfm.md](docs/atfm.md) 8장의 1~5단계. SUPERVISOR의 결정 10가지를 설계에 반영했다. 스위치는 `~/.local/state/atc/atfm.json`(원자적 쓰기, 기본값 off·shadow)에 있다.
  - **데이터**: AIRPORT마다 기본 브랜치 head CI(`snapshot.atfm.mains`), PR 체크의 `completedAt`. 체크 소요 시간, BEHIND 전이, 대상 판정, 되돌린 S2 라벨, 출발 중지, 스위치 변경을 FLIGHT RECORDER의 `atfm` 줄로 남긴다(`atfm-state.json`으로 중복을 막는다).
  - **GROUND STOP**: `snapshot.atfm.groundStops`. 조건은 main 깨짐, CI 실패 몰림, CI 혼잡(GROUND DELAY), LOS 증가, 수동이다.
    - 켤 수 있는 것은 `groundStop.mainBroken`과 `groundStop.manual`뿐이고, 둘 다 기본은 켜져 있지 않다.
    - 켜진 출발 중지가 걸리면 그 AIRPORT의 ASSIGN이 계획에서 빠지고(`GROUND STOP — …`, 열린 제안은 이 사유로 SUPERSEDED), `dispatch release`가 거절되며, TOWER 브리핑의 `landingQueue` 항목에 `groundStop`이 붙는다.
    - 새 이벤트 `groundstop.started`·`groundstop.ended`에 TOWER가 HOLD·CONTINUE를 보낸다(TOWER·OCC `CLAUDE.md` 갱신).
  - **머지 슬롯(그림자)**: `landingQueue[].slot`. CI가 있는 저장소는 1개, 없으면 무제한. Urgent가 앞이되 LAND는 밀어내지 않고, LAND는 30분에 만료된다. TOWER는 아직 따르지 않는다.
  - **자동 배정 대상(그림자)**: 열린 ASSIGN은 A1~A10, CLASSIFY 초안은 S1~S4로 판정하고, 그림자 정확도와 켜는 조건을 보여 준다. 자동으로 승인하는 것은 없다.
  - **API와 화면**: `GET /api/atfm`, `POST /api/atfm/switch`·`/off`·`/stops`·`/stops/:airport/release`, DISPATCH 탭의 ATFM 블록.
  - **판정 출처**: `via: "atfm"`은 서버 안에서만 붙는다. `humanOf`, 2a·S1 게이트, `gate3`, CROSSCHECK 일치, 한 번 클릭 수에서 모두 뺀다.
- DISPATCH가 이미 끝났거나 작업 중인 FLIGHT를 뺀다([docs/dispatch.md](docs/dispatch.md) 5.1.2). 그림자 판정에서 가장 흔한 거절이 "이미 완료됨"이었다. 이제 planner는 PR이 LOGBOOK에 ARRIVED로 있고 되돌리지 않은 FLIGHT(Linear가 아직 Todo여도, `이미 완료됨 — PR <repo>#N 머지됨(LOGBOOK)`)와 열린 PR(Draft 포함)이 있는 FLIGHT(`열린 PR #N 있음`)를 제외한다. 진행 중인 제안보다 먼저 보므로, `syncOps`가 그런 FLIGHT의 열린 제안, 승인했지만 안 보낸 제안, HOLD를 같은 사유로 SUPERSEDED하고, AIRCRAFT 쪽 사유보다 이 사유를 먼저 쓴다. 문구는 `dispatch.ts`(`landedWhy`, `openPrWhy`, `workedWhy`)에 있고, `planDispatch`와 `syncOps`는 LOGBOOK 색인(`landedOf`)을 새 선택 인자로 받아 순수 함수로 남는다.
- DISPATCH 브리핑 `reasonStats`: 거절 사유 칩마다 건수, 최근 예시 FLIGHT 3건까지, planner가 그 사유를 이미 거르는지(`auto`, `partial`, `manual`과 방법, `dispatch.ts`의 `REASON_FILTERS`). DISPATCH 점검 패널의 한 줄 칩 건수 자리에 "거절 사유 → 배정 규칙"으로 보인다.
- CHECKRIDE로 rating을 부여·회수하면 그 AIRCRAFT의 대기 중인 CREW CHANGE를 다시 써서 TYPE RATING 줄과 rating 영향이 새 rating을 따른다(TEAM_H가 알려 옴). `checkride.ts`가 저장 뒤 기존 `noteCrewChange` 훅을 부르고, 대기 중인 CREW CHANGE가 없으면 아무것도 쓰지 않는다.
- 3단계 ATFM 설계 초안([docs/atfm.md](docs/atfm.md))을 썼다. 설계만 했고 만든 것은 없다. 저위험 배정 자동 승인, S3 자동 CLASSIFY, 머지 슬롯, 출발 중지(GROUND STOP), 공통 안전장치(스위치, 하루 상한, 스스로 꺼지는 조건, FLIGHT RECORDER `atfm` 줄)를 다룬다. 그림자 운용을 먼저 하는 구현 순서와 SUPERVISOR가 정할 것도 담았다. 숫자는 운영 데이터(LOGBOOK, METRICS, 판정 점검)를 읽기 전용으로 보고 댔다.
- FLEET 카드의 관측 CREW([docs/fleet.md](docs/fleet.md) 8.3, `server/crew-observed.ts`). AIRCRAFT마다 그 세션들(그 이름의 살아 있는 세션, `custom-title.json`의 이름이 같은 지난 세션)이 최근 14일 동안 부른 서브에이전트를 모은다: agent type, 부를 때 준 모델, 횟수, 마지막 시각. 세션 메타데이터만 읽는다: `subagents/*.meta.json`의 `agentType`·`model`(`description` 등 나머지는 바로 버린다), 호출 시각은 meta 파일 mtime, 세션이 기간 안에 움직였는지는 폴더·대화 기록 파일의 mtime. 대화 기록과 지시문은 읽지도 저장하지도 않는다. `positionOf`가 선언한 POSITION에 맞춘다: 팀원의 position·agent와 이름이 같으면 그대로(`ui-builder`, `ui-qa`, `flash-helper`), `general-purpose`·`claude`는 모델 계열로(`opus` → `claude-opus-5-5` 팀원, `backend`), 모델이 없으면 CAPTAIN 모델을 물려받으므로 Opus로 본다. 내장 타입(`Explore`, `Plan`, `claude-code-guide`)과 그 밖의 타입은 선언에 이름으로 적지 않으면 맞추지 않는다. `GET /api/fleet`에 `observedWindowDays: 14`, AIRCRAFT마다 `observedCrew: {agentType, position, model, count, lastAt}[] | null`와 `crewDrift: {undeclared, unused} | null`가 붙는다(이어진 세션이 없으면 `null`). 폴더 훑기는 30초에 한 번까지, 이름과 호출은 mtime으로 캐시한다. agent team처럼 따로 세션으로 도는 팀원은 보이지 않는다(빈틈으로 적어 둠).
- CREW CHANGE 1단계([docs/fleet.md](docs/fleet.md) 8.4, `server/crew-change.ts`). `PATCH /api/fleet/:registration`이 운항 중인 AIRCRAFT(퇴역 아님, 세션 살아 있음)의 COMPLEMENT를 바꾸면, CREW BRIEFING 형식으로 CAPTAIN에게 줄 지시문을 쓴다: `[ATC FLEET] CREW CHANGE · <CALLSIGN> (<REG>) · CC-0001`, 내리고 타고 바뀌는 팀원과 모델, 새 COMPLEMENT, TYPE RATING과 영향(BUILD·MAINT·TEST나 CHECK를 잃음, SEC를 맡을 팀원, 더하거나 뺀 자격, `ui-builder`·`ui-qa`가 다 없는 UI), 적용하는 법. `~/.local/state/atc/crew-changes.jsonl`에 추가만 한다(`created`·`delivered`·`superseded`). 대기 중에 또 바꾸면 처음 구성 기준으로 합친 새 지시문이 대신하고, 원래대로 돌리면 대기 건만 닫힌다. atc는 보내지 않는다: FLEET 카드가 `pendingCrewChange: {id, at, text, added, removed, ratingImpact}`를 복사·전달함과 함께 보여 주고, 전달함은 `POST /api/fleet/:registration/crew-change/:id/delivered`(404·409)를 부른다. 기록은 `GET /api/fleet/crew-changes?registration=&limit=`. `docs/guide`의 FLEET 쪽에 읽는 법을 적었다.
- CHECKRIDE: LOGBOOK으로 본 TYPE RATING 근거와 추천([docs/fleet.md](docs/fleet.md) 8.2, `server/checkride.ts`). AIRCRAFT·rating(`SEC`, `UI`, `DATA`, `DOCS`)마다 AIRCRAFT를 아는 ARRIVED FLIGHT 중 그 rating이 필요했던 것을 모은다. rating은 먼저 FLIGHT의 라벨(`rating:X`, Risk 그룹은 `SEC`. 지금 티켓, 없으면 LOGBOOK 줄의 class)에서, 없으면 SUPERVISOR가 받아들인 가장 최근 SCHEDULE CLASSIFY 초안에서 읽고, 근거마다 출처를 보여 준다. 상태는 `GRANT`(없는 rating. 30일: 3건 이상, 되돌림 0, Codex 지적 라운드 평균 3 미만), `REVIEW`(가진 rating. 14일: 되돌림, 또는 2건 이상의 평균 3 이상), `BLOCKED`(`SEC`를 맡을 CREW가 없음, 이유 표시), `BUILDING`, `HOLDS`. 처음 제안값이고 상수로 둔다. `GET /api/fleet/checkride`. `POST /api/fleet/:registration/checkride` `{rating, action}`은 `applyPatch`와 `fleet.json` 원자적 쓰기로 부여·회수하고, FLIGHT RECORDER에 `checkride` 줄(누가, 추천이었나, 근거)을 남긴다. FLEET 탭 카드 아래에 CHECKRIDE 목록과 확인 창을 거치는 부여·회수 버튼이 있다. 자동으로 바뀌는 것은 없다. `docs/guide`(FLEET, 화면, 개념)에 적었다.
- LOGBOOK과 TARGETS 실적([docs/fleet.md](docs/fleet.md) 7.1~7.2). atc가 10분마다 AIRPORT마다 기본 브랜치에 머지된 최근 PR 30건을 읽고(`gh pr list --state merged`, 열린 PR 읽기와 별도의 가벼운 읽기), 새 PR마다 `~/.local/state/atc/logbook.jsonl`에 `arrived` 줄을 추가한다. 키가 `owner/repo#번호`라 재시작 뒤 첫 번에 과거분도 채운다. 한 줄에는 AIRCRAFT(FLIGHT RECORDER의 landing 이벤트, 그 브랜치의 워크트리, ticket key로 찾은 STAND를 가장 늦게까지 점유한 `TEAM_X` 세션, 모르면 `null`), FLIGHT와 `classOf` 분류, AIRPORT, PR, `departedAt`(가장 이른 점유, PR을 연 시각이 더 이르면 그것), `arrivedAt`(머지), `blockMin`(팀 소요 시간: 출발 → PR을 연 시각. PR 전에 점유가 없으면 `null`), `landingWaitMin`(착륙 대기: PR을 연 시각 → 머지. 리뷰·머지 대기라 팀 시간과 나눔), `codexFindings`(모든 커밋에 걸친 Codex `COMMENTED` 리뷰 회차), `changesRequested`, `los`(그 STAND의 비행 중 LOS)가 들어간다. `Revert "…"` PR이 머지되면 되돌린 PR에 `reverted` 줄을 덧붙인다(`Reverts owner/repo#N`, 없으면 따옴표 안 제목으로 찾음). `GET /api/logbook?aircraft=TEAM_X&days=14`. `fleetView`에 `actuals`를 더했고, FLEET 카드가 TARGETS 아래에 보여 준다: "이번 주 3/3 · 정시 67% (목표 80%)", 14일 ARRIVED·되돌림·LOS, 착륙 대기 중앙값, 최근 FLIGHT 5건(팀 소요 시간, 착륙 대기, ON TIME / DELAYED). 정시는 팀 소요 시간이 WAKE 기대치(WAKE 라벨이 있을 때 L 60분, M 4시간, H 2일) 안인지, 기대치가 없으면 AIRCRAFT와 팀 소요 시간을 아는 같은 FLIGHT TYPE·WAKE 기록(3건 이상)의 중앙값 이하인지로 본다. 팀 소요 시간을 모르는 기록은 정시율에서 빼고, 착륙 대기는 정시율에 넣지 않는다. 보여 주기만 하고 점수나 배정에 쓰지 않는다. `docs/guide`(FLEET, 화면, 개념)에 적었다.
- 한 번 클릭 판정을 기록한다. CROSSCHECK를 따르는 습관이 게이트를 부풀리는지 보기 위해서다. DISPATCH `verdict`·`approve`·`reject`와 SCHEDULE `verdict`·`approve`·`reject`가 `via: "crosscheck" | "manual"`을 받는다. 그 밖의 값이나 없으면 `"manual"`로 기록하고, 옛 기록은 `via` 없이 둔다(채워 넣지 않음). "CROSSCHECK에 동의" 버튼이 `via: "crosscheck"`를 보낸다. 제안과 ScheduleOp에 `via`가 있고, CROSSCHECK 일치율의 사람 판정에도 들어간다. 두 게이트에 `gate.crosscheck.oneClick: {count, decided}`가 생겼다. `decided`는 한 번 클릭이 가능했던 사람 판정(판정 전에 CROSSCHECK mark가 있었고 `via`가 기록됨), `count`는 그중 `via: "crosscheck"`인 것(`server/crosscheck.ts`의 `oneClickOf`). 읽는 법은 사용 안내의 판정하기 쪽에 있다.
- DISPATCH 거절 사유 칩. 서버에 목록 하나를 두고(`server/reasons.ts`), 지금까지 제안 기록에 남은 사유에서 골랐다: `already-done` 이미 완료됨, `parent-issue` 상위 이슈(하위로 나뉨), `waiting-on-prior` 선행 FLIGHT·PR 대기, `needs-human` 사람 결정 필요, `no-priority` 우선순위 미정, `out-of-repo` 저장소 밖 작업, `wrong-aircraft` AIRCRAFT 부적합, `other` 기타. `GET /api/dispatch/brief`가 `reasonCodes: {code, label}[]`로 주고, DISPATCH 탭의 거절 창이 그 목록을 쓴다.
  - `disagree`인 `verdict`와 `reject`가 `reasonCodes: string[]`와 자유 사유 `reason`을 받는다. 모르는 code는 400, 중복은 빼고 목록 순서를 지킨다. `agree`·`approve`에 칩을 보내면 400.
  - 기록되는 `reason`에 칩 이름이 들어간다(CROSSCHECK 예시와 OCC가 읽도록): `"<label> · <label> — <자유 사유>"`, 칩만 있으면 label만, 자유 사유만 있으면 그것만(`composeReason`). op와 제안에 `reasonCodes`가 남는다.
  - DISPATCH 게이트에 `reasonCounts: Record<code, number>`. 칩이 있는 사람 disagree·reject 판정을 칩별로 센다(모든 code를 0부터).
  - DISPATCH 탭: 거절 버튼이 사유 하나를 고르던 창 대신 카드 안의 양식(SCHEDULE과 같은 모양)을 연다. 서버 목록의 칩을 여러 개 고르고 메모를 붙이며, 사유 없이도 거절할 수 있다. RECENT에 칩과 1-CLICK 표시가 붙고, 640px 이하에서는 줄마다 쌓아 휴대폰에서도 사유가 보인다. 두 게이트 패널에 한 번 클릭 줄이 있다.
- OCC CLASSIFY 보정. SUPERVISOR가 거절한 SCHEDULE 초안 3건은 모두 CLASSIFY를 잘못 읽은 경우였다: MAINT인 VOC-195·VOC-196에 `BUILD`, L인 VOC-181에 WAKE `M`.
  - `occ/CLAUDE.md`와 `/tick`(ko/en)은 CLASSIFY 전에 `docs/fleet.md` 4.1~4.3을 읽고, FLIGHT TYPE을 정해진 순서(CHECK → SURVEY → TEST → FERRY → MAINT → BUILD)로 정하게 한다. BUILD는 사용자가 보는 동작이 바뀔 때만이고, WAKE는 실제 바뀔 크기로 정하며, 근거에 절 번호를 인용한다.
  - OCC settings에 `permissions.additionalDirectories: ["../docs"]`를 더해 실제로 읽히게 했다.
  - `schedule brief`에 `examples`를 더했다: 최근 SUPERVISOR 판정 8건까지, OCC가 냈던 분류 `proposed`, 그때 근거 `draft`, 판정과 거절 사유. CROSSCHECK의 `examplesOf`를 재사용한다. OCC는 거절된 실수를 되풀이하지 않도록 이것을 본다.
- 새 버전 알림. 배포 전에 열어 둔 탭은 옛 번들을 계속 돌려서 새 기능("CROSSCHECK에 동의" 버튼)을 못 보고 지나칠 수 있었다. 이제 서버가 `web/dist/index.html`의 진입 스크립트 경로(`/assets/index-<hash>.js`)를 빌드 정체로 삼고, 파일이 바뀌면 다시 읽는다(재시작 없이 다시 빌드해도 알아챈다). `GET /api/version`은 `{build, startedAt}`를 주고, `/api/events`는 연결할 때와 build가 바뀔 때 `event: version`을 보낸다. 화면은 자기 번들(`import.meta.url`)과 비교해 다르면 머리글 아래에 "새 버전이 배포됨 · 새로고침"을 띄운다. 새로고침과 닫기(그 빌드에 대해서는 숨김) 버튼이 있다. 입력 중인 내용(거절 사유 등)이 날아가지 않게 저절로 새로고침하지 않고, 개발 서버나 빌드가 없을 때는 뜨지 않는다. 새로고침이나 새 탭이 늘 지금 번들을 받도록 `index.html`은 `Cache-Control: no-cache`로 보낸다. `docs/guide`의 문제 해결과 화면 안내에 적었다.
- CROSSCHECK가 atc의 `docs/`를 읽을 수 있다(읽기만; SUPERVISOR 결정). CLASSIFY·NEW mark는 먼저 `docs/fleet.md` 4.1~4.3(FLIGHT TYPE, WAKE, TYPE RATING)을 읽고 인용한다. settings에 `permissions.additionalDirectories: ["../docs"]`를 더했다. 새 fail-closed hook `crosscheck/read-guard.mjs`(Read·Glob·Grep)가 `crosscheck/`, `../docs/`, 그 세션이 저장한 도구 출력만 허용하고, atc 소스·`~/.local/state/atc`·다른 저장소는 막는다(대화형 세션에서 권한 창으로 넘어가지 않는다). `crosscheck/CLAUDE.md`와 `/tick`은 기준을 인용하라고 안내한다.
- CROSSCHECK가 GitHub PR 사실을 읽기 전용 `gh pr view|checks|list`로 확인한다(SUPERVISOR 결정). MCP는 쓰지 않고 `--strict-mcp-config`는 그대로다. Bash hook은 `guard.mjs --crosscheck --gh-read`가 됐다. 두 옵션을 같이 주면 `gh pr`은 `view`·`checks`·`list`만(OCC와 달리 `diff`는 뺌), `--crosscheck`만 주면 `gh`는 계속 막힌다. settings allow에 세 명령을 넣었다. `crosscheck/CLAUDE.md`와 `/tick`은 본문·댓글·OCC 메모에 나온 PR 조건을 `gh pr view <N> --repo <owner/name> --json state,mergedAt,title`로 확인한 뒤 mark를 달라고 하고, AIRPORT별 저장소 표를 두며, 쓰는 gh 명령을 금지한다.
- CROSSCHECK 모델별 일치율. mark마다 `model`이 남는다. `atcctl`이 세션 settings `env`의 `ATC_CROSSCHECK_MODEL`에서 가져오고(세션이 스스로 적지 않음, 명령 앞 환경 변수로 바꾸는 것은 guard가 막음), 없는 mark는 `unknown`으로 읽는다. `gate.crosscheck`는 전체 `{marked, matched, rate}`를 그대로 두고 `byModel`을 더했다. DISPATCH·SCHEDULE 점검 패널에 모델마다 한 줄, 칩과 RECENT 툴팁에 모델 이름. `crosscheck/settings.test.mjs`가 settings 모델과 기록될 모델이 같은지, DeepSeek이 아닌지 확인한다.
- CROSSCHECK: SUPERVISOR가 판정하기 전에 OCC와 다른 계열의 모델이 예비 판정을 먼저 달아 둔다([docs/occ.md](docs/occ.md) "CROSSCHECK"). 게이트에는 계속 사람 판정만 세고, CROSSCHECK와 사람의 일치율은 따로 잰다.
  - 서버: `proposals.jsonl`·`schedule.jsonl`의 `crosscheck` op(`{op, id, at, by, verdict, reason}`). `note`처럼 상태를 바꾸지 않는다. HOLD가 아닌 `proposed` 제안과 `draft` 초안에만 받고, 나중 mark가 앞의 것을 대신한다. Proposal·ScheduleOp에 `crosscheck`, ScheduleOp에 `decision`(발부 뒤에도 남는 SUPERVISOR 판정)이 생겼다. `POST /api/dispatch/proposals/:id/crosscheck`, `POST /api/schedule/ops/:id/crosscheck`는 모드와 상관없이 받고, `reason`은 필수·500자 이내. 두 게이트에 `crosscheck: {marked, matched, rate}`(판정 전에 mark가 있던 사람 판정만; agree ↔ agreed·approved, disagree ↔ disagreed·rejected), 두 브리핑에 `crosscheck: {pending, examples}`.
  - `atcctl crosscheck brief`, `atcctl dispatch crosscheck D-xxxx agree|disagree -- <이유>`, `atcctl schedule crosscheck S-xxxx agree|disagree -- <이유>`.
  - 세션 폴더 `crosscheck/`(`CLAUDE.md`, `/tick`, 영어 번역). 설정은 fail-closed: `controller/guard.mjs --crosscheck`가 atcctl 읽기와 crosscheck 명령만, `occ/mcp-guard.mjs --read-only`가 읽기 MCP 도구만 통과시키고, Edit·Write·SendMessage·Agent는 막는다. 모델은 `claude-ocx-native--gpt-5.6-terra`로 고정했고 `ocx claude`로만 닿는다(정확한 실행 명령은 문서). 평범한 `claude`로 열면 Claude로 몰래 돌지 않고 오류로 멈춘다.
  - DISPATCH·SCHEDULE 탭: 열린 카드에 점선 칩 `CROSSCHECK agree · <이유>`, 같은 판정을 한 번에 내는 "CROSSCHECK에 동의" 버튼(shadow는 verdict, approval은 approve/reject; disagree에 동의하면 그 이유가 판정 사유), RECENT에 흐린 mark, 점검 패널에 참고 줄 "CROSSCHECK 일치 n/m".
- OCC S2, SCHEDULE 승인 운용. `mode` 뒤에 만들어 두었고 기본은 꺼짐([docs/occ.md](docs/occ.md) "Turning on S2"). approval 모드에서 SUPERVISOR가 SCHEDULE 탭에서 초안을 승인·거절하고, OCC는 `atcctl schedule release S-xxxx`로 정확한 Linear MCP 호출(`save_issue`, CLASSIFY·PRIORITIZE에는 근거 댓글; 계획 필드만)을 받아 그대로 부른다. `occ/mcp-guard.mjs`에 linear-guard가 들어가 approval 모드에서 발부된 호출과 도구·입력이 같은 Linear 쓰기만 통과한다. Linear에 반영이 보이면 atc가 APPLIED로 바꾼다. 새 상태 APPROVED·REJECTED·RELEASED·APPLIED, 탭의 IN PROGRESS 목록과 모드 전환, `POST /api/schedule/ops/:id/{approve,reject,release}`, `GET /api/schedule/released`, `POST /api/schedule/mode`. MCP guard는 hook 입력을 읽지 못하면 이제 막는다(전에는 통과시켰다).
- DOCS 탭(`#docs`, `#docs/<쪽>`): 문서 사이트 같은 사용 안내. 왼쪽 목차, 가운데 본문, 오른쪽 "이 쪽에서" 목차, 이전·다음 링크. 원본은 `docs/guide/`의 한국어 Markdown이고 빌드 때 묶여 `marked`로 그린다(새 의존성이라 다음 빌드 전에 `npm install`). 쪽: 소개, 빠른 시작, 개념, 일 맡기기(CHARTER DESK / AD HOC), 판정하기, FLEET, 교신 규칙, 화면, 단계, 문제 해결. 쪽 사이 링크는 탭 안에서 움직인다. 루트 `CLAUDE.md`에 사용 방법이 바뀌면 안내도 고치라고 넣었다.
- CHARTER DESK, OCC의 요청 창구: SCHEDULE `NEW` 초안(여전히 S1 그림자 운용이라 Linear에는 쓰지 않는다). SUPERVISOR가 OCC 세션에서 CHARTER REQUEST를 하면 OCC가 AD HOC FLIGHT(정기 스케줄 밖의 새 이슈) 초안을 쓰고, 승인되어 S2부터 Linear Todo가 되면 FILED다.
  - 서버: `POST /api/schedule/ops`가 `{kind: "NEW", title, body, project, reason, priority?, type?, wake?, ratings?, tail?, parent?, related?, blockedBy?}`를 받고, 작업의 `flight`는 `null`이다. 본문에는 vocado 네 칸(목표, 수정 허용 범위, 금지 사항, 완료 기준 또는 영어 이름)이 있어야 하고, `rating:SEC`는 Codex Engineering Task 칸(Allowed files, Forbidden changes, Invariants, Acceptance Criteria, Verification)도 있어야 한다. 프로젝트, tail(퇴역하지 않은 FLEET 등록번호), parent·related·blockedBy key를 검사한다. 근거에는 "중복 검색:"이 있어야 한다. atc가 제목이 비슷한 티켓을 5개까지 `similar`로 남기며, 찾는 범위는 스냅샷(최근 45일 안에 바뀐 이슈)뿐이다. `NEW` 초안은 열린 초안 5건 한도에 들고, 서로 대신하지 않으며, 초안 뒤에 같은 제목의 이슈가 Linear에 생기면 SUPERSEDED로 닫힌다.
  - `atcctl schedule draft NEW --title … --project … [--priority n] [--type X] [--wake Y] [--rating Z]… [--tail TEAM_X] [--parent K] [--related K]… [--blocked-by K]… --reason … -- <본문>`. 본문의 `\n`은 줄바꿈이고, 초안 ID, "AD HOC FLIGHT 초안", 비슷한 FLIGHT를 출력한다.
  - OCC 규정(`occ/CLAUDE.md`, `/tick`): CHARTER DESK 절 — CHARTER REQUEST가 있을 때만 쓰고, 먼저 중복을 찾고, 템플릿대로 본문을 쓰고, 팀이 분명하면 tail을 제안하고, 초안 ID를 SUPERVISOR에게 알린다.
- OCC S1, 그림자 운용의 SCHEDULE 초안([docs/occ.md](docs/occ.md) 5~7장, 영어). OCC가 분류 라벨이나 우선순위가 없는 Todo·Backlog FLIGHT에 `CLASSIFY`(`type:`, `wake:`, `rating:` 라벨, [docs/fleet.md](docs/fleet.md) 4장 기준)와 `PRIORITIZE` 초안을 쓴다. Linear에는 아무것도 쓰지 않는다.
  - 서버: 추가만 하는 기록 `~/.local/state/atc/schedule.jsonl`(`server/schedule.ts`)과 `GET /api/schedule/brief`, `GET /api/schedule/ops/:id`, `POST /api/schedule/ops`, `POST /api/schedule/ops/:id/verdict`. 열린 초안은 5건까지(넘으면 409). 같은 FLIGHT·종류로 새 초안을 쓰면 앞의 것은 SUPERSEDED. FLIGHT가 Todo·Backlog를 벗어나거나 Linear에 이미 반영되면 SUPERSEDED, 3일이 지나면 EXPIRED로 닫힌다.
  - `atcctl schedule brief`, `schedule draft CLASSIFY <FLIGHT> [--type X] [--wake Y] [--rating Z]… -- <근거>`, `schedule draft PRIORITIZE <FLIGHT> --priority 1-4 -- <근거>`. 한도에 차면 `LIMIT: …`을 출력해 세션이 초안 쓰기를 멈추게 한다.
  - OCC 규정(`occ/CLAUDE.md`, `/tick`): 한 바퀴에 후보 FLIGHT 3개까지 읽고 초안을 쓴다. PRIORITIZE는 본문·댓글에 근거가 있을 때만, `LIMIT`이 나오면 멈춘다.
  - DISPATCH 다음에 SCHEDULE 탭: S2 진입 점검(판정 20건, 합의율 80%), 열린 초안 카드(FLIGHT, 제목, 지금 분류, 바뀔 것, OCC 근거), "승인했을 것 / 거절했을 것" 버튼과 선택 거절 사유, Linear에서 손으로 붙일 라벨 안내, 후보 수, 최근 7일 표.
- 루트 `CLAUDE.md`(한국어, 세션이 읽는 원본)와 `CLAUDE.en.md`(번역): atc 코드를 고치는 세션의 작업 규칙. 운영 체크아웃이 아니라 워크트리에서 작업하고, 테스트·타입·빌드와 임시 상태 폴더의 7702 시험 서버로 확인하며(Linear 키는 복사하지 않음), 서비스 재시작·머지는 하지 않고, 커밋은 영어로 attribution 줄 없이, 항공 용어는 영어로, 문서는 영어판·한국어판을 함께 고친다. `controller/`·`occ/`의 관제 세션은 자기 폴더의 `CLAUDE.md`를 계속 따른다.
- FLEET 탭의 팀 빌딩([docs/fleet.md](docs/fleet.md) 8.1): **ENTRY INTO SERVICE**로 **CONFIGURATION** 템플릿(`general`, `security`, `ui`, `research`)을 골라 새 AIRCRAFT를 들인다(비어 있는 다음 `TEAM_X`, 기본 AIRPORT는 팀들이 있는 곳). **CREW BRIEFING**은 새 세션에 붙여 넣을 시작 지시문을 주고, **AOG**는 사유와 해제 예정일을 남기고 잠시 배정을 멈추며(planner가 건너뜀), **RETIREMENT**는 목록과 계획에서 뺀다(복귀 가능). atc는 세션을 직접 띄우지 않는다.
- planner의 FLIGHT 분류([docs/fleet.md](docs/fleet.md) 3단계): Linear 라벨 `type:`, `wake:`, `rating:`(Risk 그룹 라벨은 `SEC`). FLIGHT는 필요한 TYPE RATING을 모두 가졌고 팀원이 그 종류의 일을 할 수 있는 AIRCRAFT에만 간다. 슬롯은 WAKE로 세고(L 0.5, M 1, H 2), `wake:J`는 나누기 전까지 제외하며, 새 ROUTE 요소가 AIRCRAFT의 담당 프로젝트에 +1을 준다. 자격 있는 AIRCRAFT가 아예 없으면 사유와 함께 제외한다. Linear 라벨 그룹의 하위 라벨은 이제 `그룹:이름`(예: `Risk:Security`)으로 읽는다. DISPATCH 카드에 분류가 보인다.
- FLEET 등록부와 탭([docs/fleet.md](docs/fleet.md) 2단계): `~/.local/state/atc/fleet.json`에 팀마다 CREW COMPLEMENT, TYPE RATING(`SEC`, `UI`, `DATA`, `DOCS`), ROUTE, TARGETS를 두고, 기본값은 vocado 팀원 규칙에서 온다. 보안 작업을 맡을 팀원이 없는 구성에는 `SEC`를 줄 수 없다. FLEET 탭은 AIRCRAFT마다 상태(AIRBORNE / HOLDING / PARKED), 지금 FLIGHT, 프로필을 보여 주고 고친다(`GET /api/fleet`, `PATCH /api/fleet/:registration`). planner는 아직 쓰지 않는다.
- OCC 세션 S0(`occ/`, [docs/occ.md](docs/occ.md), 영어). DISPATCH 세션 폴더가 `dispatch/`에서 `occ/`로 옮겨졌고 하던 일(제안 검토, HOLD, FLIGHT PLAN, READBACK)은 그대로다. OCC는 운항 추적을 더한다: `guard.mjs --gh-read`로 읽기 전용 `gh pr view|checks|diff|list`를 쓴다. `occ/mcp-guard.mjs`가 읽기 MCP 도구만 통과시켜 S0에서는 Linear·GitHub에 쓸 수 없다.
- `atcctl manual check` / `manual ack`: 관제 세션(OCC, TOWER)의 `/tick`은 마지막 ack 뒤 `CLAUDE.md`나 `/tick`이 바뀌었는지부터 확인하고, 바뀌었으면 다시 읽는다.
- TAIL ASSIGNMENT, Linear 라벨 `tail:TEAM_X`(처음엔 `lane:TEAM_X`로 나왔고, 2026-10-10까지 별칭으로 읽으며 제외 사유에 바꾸라고 적는다): planner가 그 FLIGHT를 그 팀에만 제안한다. 그 팀이 못 받으면(AIRBORNE, HOLDING, 세션 없음, 다른 AIRPORT) 다른 팀에 주지 않고 사유와 함께 제외한다.
- 상위 이슈(Linear `children`이 있거나 다른 이슈가 `parent`로 지목한 것)를 작업으로 보지 않는다. ASSIGN 제안도, STAND 없이 아무리 오래 ENROUTE여도 RELEASE 제안도, NO CONTACT 경보도 만들지 않는다. 작업은 그 하위 이슈다. 보드 쿼리가 `parent` / `children`을 읽고, DISPATCH 탭의 "제외" 목록에 하위 건수와 함께 뜬다.
- `dispatch note --hold <FLIGHT>`: 본문에만 적혀 있고 `blocks` 관계로는 없는 선행 작업을 DISPATCH 세션이 지정한다. 제안은 DISPATCH 탭의 새 HELD 목록으로 가고, 제안 자신의 FLIGHT는 예약된 채로 남아 planner가 다시 올리지 않으며(AIRCRAFT는 다른 FLIGHT가 쓸 수 있게 놓아 둔다), 보낼 수는 없고, FLIGHT PLAN에 `HOLD — 선행 FLIGHT …` 줄이 들어간다. 지정한 FLIGHT가 모두 끝나면 atc가 그 제안을 SUPERSEDED로 풀어 planner가 다시 후보로 올린다. 값 없는 `--hold`는 선행 FLIGHT 없는 HOLD(사람 결정 대기, 사유는 메모)이고, HOLD 뒤에 FLIGHT가 수정되면 풀린다. HOLD에는 24시간 만료가 없다. 대신 FLIGHT 자체가 Todo가 아니게 되거나 SUPERVISOR가 "HOLD 풀기"(`POST /api/dispatch/proposals/:id/unhold`)를 누르면 닫힌다. 선행 FLIGHT는 열린 FLIGHT 목록에 있는 key여야 하고 제안 자신의 FLIGHT일 수 없다.
- 우선순위가 없는 FLIGHT는 ASSIGN 후보가 아니다. 사람이 아직 언제 할지 정하지 않은 것이라 "제외" 목록에 뜬다.
- DISPATCH 탭의 거절 사유 칩. 거절할 때 사유 목록(상위 이슈, 본문에만 있는 선행 작업, 사람 결정 대기, 이미 진행 중, 우선순위 낮음, 슬롯 없음, 다른 팀이 더 적합, 이미 완료됨) 중 하나를 고르고 메모를 선택으로 덧붙이며, `"<칩> — <메모>"` 형태로 제안의 사유에 저장된다.
- SUPERSEDED 사유가 계획의 제외 사유를 그대로 쓴다. FLIGHT가 상위 이슈·HOLD·라벨·STAND 때문에 빠진 경우 "더 나은 배정으로 바뀜" 대신 그 이유(`HOLD D-0005 — 선행 FLIGHT 대기`)가 남는다.
- DISPATCH 2b 승인 운용. `mode`(`shadow` / `approval`) 뒤에 있고 기본은 꺼짐. approval 모드에서 SUPERVISOR가 DISPATCH 탭에서 제안을 승인·거절하고, DISPATCH는 승인된 ASSIGN을 정해진 FLIGHT PLAN으로 CAPTAIN에게 보내며(`dispatch release`), `READBACK D-xxxx`나 거절을 기록한다. 그 FLIGHT의 STAND가 생기면 atc가 DEPARTED로 바꾼다. 승인·전달·수락된 제안은 AIRCRAFT와 FLIGHT를 예약한다. 탭에 IN FLIGHT 목록(NO READBACK / NO DEPARTURE 표시), 3단계(ATFM) 점검, 확인 창을 거치는 모드 전환이 생겼다.
- `dispatch/send-guard.mjs`: DISPATCH의 SendMessage는 approval 모드에서, SENT 상태인 제안을, 그 CAPTAIN에게, atc가 만든 FLIGHT PLAN 문구 그대로 보낼 때만 통과한다.
- 설정 창에 LINEAR·AGENTS 탭. 새 `GET /api/settings`로 서버 설정을 읽기 전용으로 보여 주고, 비밀 값은 돌려주지 않는다.
  - LINEAR: 연결 상태, 마지막 동기화, API 키 설정 여부, 팀 키, LANDING 상태.
  - AGENTS: 세션 수, 세션 폴더, 점유 hook 설치 여부, TTL과 HANDOFF 기준 시간.
- README에 릴리스 배지.
- 이 변경 기록.

### 변경
- TOWER의 `LAND` 문구를 서버가 만든다. LAND마다 글이 같아진다. `GET /api/controller/brief`의 CLEARED `landingQueue` 항목에 `repoSeq`와 `landText`가 있다(`server/controller.ts`의 `landTextOf`). 순서와 앞 PR은 같은 저장소·base의 CLEARED PR 안에서만 센다(다른 저장소의 머지는 rebase가 필요 없다): 첫 번째는 `LANDING 순서 1번 (<AIRPORT>): PR #<n> (<FLIGHT>). 지금 LANDING 가능 — 머지 전에 base가 최신인지 확인.`, 그 뒤는 `LANDING 순서 <k>번 (<AIRPORT>): PR #<n> (<FLIGHT>). 앞 PR #<m> 머지 뒤 rebase하고 LANDING.`. FLIGHT가 없으면 괄호를 뺀다. APPROACH 항목은 `repoSeq`·`landText`가 `null`이고, 전체 `seq`는 그대로다. TOWER 규칙(`controller/CLAUDE.md`, 영어 번역)은 `atcctl issue … LAND`의 `--` 뒤 문구를 `landText` 그대로 쓰게 한다. 전에는 TOWER가 직접 써서 seq 1에도 "앞 PR이 머지되면 rebase하고 LANDING"이 붙었다.
- CROSSCHECK mark를 세션의 실제 모델로 확인한다(SUPERVISOR 결정). Claude Desktop은 settings의 model을 따르지 않아 두 세션이 `claude-opus-5-5`로 돌았는데, mark에는 settings `env`의 Muse 이름이 남았다. 이제 `atcctl dispatch|schedule crosscheck`이면 `guard.mjs --crosscheck`가 hook 입력의 `transcript_path`에서 마지막 assistant `message.model`을 읽어 `/muse-spark|gpt-5\.6-terra/i`만 통과시킨다. Claude 모델·DeepSeek, 기록이 없거나 깨졌거나 model이 없으면 막고 "앱에서 모델을 Muse로 바꾸거나 터미널에서 ocx claude로 여세요"라고 안내한다. 통과한 명령은 PreToolUse `updatedInput`으로 앞에 `ATC_CROSSCHECK_MODEL='<실제 모델>'`을 붙여 실행해 mark에 실제 이름이 남는다(ocx는 `claude-ocx-opencode-go--muse-spark-1.3-contributor`, ClaudeRipple·Desktop은 `muse-spark-1.3-contributor`). mark 명령의 `--model`과 이어 쓴 mark 명령은 막고, settings의 `env.ATC_CROSSCHECK_MODEL`은 뺐다. 읽기 명령은 그대로다.
- LANDING SEQUENCE를 Linear 상태 `Ready to Merge`가 아니라 GitHub에 열린 PR로 만든다. vocado의 Linear에는 그 상태가 없어서 대기열이 늘 비어 있었다. GitHub remote가 있는 AIRPORT마다 열린 PR을 읽고(`server/sources/github.ts`: 90초마다 백그라운드로 `gh pr list`, 실패하면 마지막 결과 유지) PR마다 **CLEARED TO LAND**를 따진다(`server/landing.ts`): head 커밋의 체크가 모두 통과, head 커밋에 작성자도 Codex 봇도 아닌 리뷰어의 리뷰(또는 head 뒤 Codex 👍), head에 Codex 지적 없음, CHANGES_REQUESTED 없음, `mergeStateStatus`가 CLEAN·UNSTABLE·HAS_HOOKS, Draft 아님, STAND에 LOSS OF SEPARATION 없음. 아니면 막힌 조건(`draft`, `checks-pending`, `checks-failed`, `no-checks`, `no-review`, `review-stale`, `review-findings`, `changes-requested`, `behind`, `dirty`, `blocked`, `merge-unknown`, `los`)과 한국어 한 줄씩을 붙여 **APPROACH**. 결정 사항은 [docs/occ.md](docs/occ.md) 9절(영어).
  - 스냅샷: `pulls`(열린 PR 전부. FLIGHT, STAND, `landing`, `blocks`, `readyAt`, `createdAt`. CLEARED가 `readyAt` 순으로 먼저, 그다음 APPROACH가 연 순서)와 `github`(`{enabled, error, fetchedAt}`).
  - TOWER 브리핑: `landingQueue`는 Draft가 아닌 PR이고, 항목마다 `seq`(CLEARED 안의 순번), AIRPORT, PR 번호·URL·브랜치·head, STAND와 `holders`, `landing`, `blocks`, `readyAt`, `landClearance`. 브리핑에 `github`도 있다. 이벤트: `landing.requested`, `landing.cleared`(새로), `landing.blocked`(새로: CAPTAIN이 손써야 할 막힘이 생김), `landing.left`. PR(`repo`, `pull`) 단위다. LANDING 이벤트는 양쪽 스냅샷 다 PR을 읽었을 때만 비교하고, GitHub이 실패해도 다른 이벤트는 막지 않는다.
  - TOWER 규정(`controller/CLAUDE.md`, `/tick`): `LAND`는 CLEARED TO LAND PR에만, 번호는 `seq`. APPROACH PR은 `landing.requested`·`landing.blocked` 이벤트에 기다리면 풀리는 것 말고 다른 막힘이 있을 때만 그 STAND의 holders에게 `INFO`로 알리고, 같은 막힘으로 다시 보내지 않으며 서버 재시작 뒤에도 보내지 않는다.
  - Codex의 👍를 head 리뷰로 친다: Codex는 문제가 없는 PR에 리뷰 대신 `+1` 반응만 남기므로, head 커밋의 committer 시각 이후에 Codex 봇이 단 👍는 리뷰 조건을 채운다(이전 head 때부터 남아 있던 👍는 세지 않는다). 반응, head committer 시각, Codex의 PR 댓글은 head에 통과 리뷰가 없거나 Codex 지적이 있는 Draft 아닌 PR에만 읽기 전용 `gh api`로 읽는다. head 뒤 Codex의 마지막 댓글이 "usage limits" 안내면 막힘 문구가 "Codex 한도 — 사람 리뷰 필요"다.
  - Codex 리뷰는 통과로 치지 않는다: Codex는 문제를 찾았을 때만 COMMENTED 리뷰("💡 Codex Review", P1·P2 줄 댓글)를 단다. head에 그 리뷰가 있으면 그 리뷰 뒤에 Codex 👍가 달리거나 사람(Codex·작성자 아님)이 head에 APPROVED할 때까지 `review-findings`("Codex 지적 있음(head sha7) — 반영 후 재리뷰 필요", STRIPS 짧은 이름 "Codex 지적")로 막는다. 지적 전 APPROVED나 사람 COMMENTED로는 풀리지 않는다. TOWER는 다른 손쓸 막힘처럼 CAPTAIN에게 알린다. 사람 리뷰어의 head APPROVED·COMMENTED는 그대로 통과다.
  - 브랜치에 `voc-<n>`이 없는 PR은 제목 끝의 `(VOC-n)`으로 FLIGHT를 찾는다.
  - STRIPS: 맨 위 LANDING SEQUENCE(CLEARED TO LAND는 `readyAt` 순번, APPROACH는 PR마다 막는 조건과 함께 접어서, Draft는 흐리게 접어서. AIRPORT, FLIGHT, `#PR` 링크, STAND를 쥔 팀), STAND 줄 REMARKS의 PR 배지(`CLEARED TO LAND`, CLEARED PR이 둘 이상이면 `SEQ n`. 또는 `APPROACH`와 막는 조건 수, 펼치는 조건 목록), GitHub을 못 읽으면 "GitHub 조회 실패 · PR 상태가 오래됐을 수 있음".
  - 지표의 LANDING 대기는 PR 단위로 센다. 교통량 표본의 `landing`은 Draft가 아닌 PR 수다.
- `ATC_LANDING_STATE` 설정을 없앴다(LINEAR 설정 탭, `PUT /api/settings`의 `landingState`). `.env.local`에 남은 줄은 무시한다.
- CROSSCHECK 기본 모델을 Muse Spark 1.3(`claude-ocx-opencode-go--muse-spark-1.3-contributor[1m]`)으로 바꿨다(SUPERVISOR 결정). GPT-5.6 Terra는 대체 모델로 문서에 남겼다. DeepSeek은 flash-helper와 같은 모델이라 FLEET 규칙상 판정에 쓰지 않는다. Muse가 일부 도구 스키마를 받지 못해 CROSSCHECK 설정에서 `Artifact`도 막고, 세션은 `ocx claude --strict-mcp-config`(MCP 서버 없음; GitHub 읽기는 아직 미정)로 연다. [docs/occ.md](docs/occ.md) "CROSSCHECK" 참고.
- 티켓 없는 작업을 "티켓 없음"·"—" 대신 **AD HOC**으로 표시한다(FLIGHT STRIPS, planner의 HOLDING 사유, 이름 규칙). 티켓이 필요한 일은 OCC의 요청 창구 CHARTER DESK에서 AD HOC FLIGHT가 되고, 이것은 그 짝이다.
- SUPERSEDED 사유가 계획의 제외 목록에 그 FLIGHT가 없을 때도 실제 규칙을 밝힌다: 이미 STAND가 있음, 우선순위 없음, 매핑 밖 프로젝트, 다른 운항사 라벨. planner와 사유 문구가 같은 문구 모음을 써서 서로 어긋나지 않는다.
- TOWER·DISPATCH hook은 `$CLAUDE_PROJECT_DIR` 기준으로 돌고 fail-closed(`… || exit 2`)다. hook이 없거나 실패하면 이제 도구를 통과시키지 않고 막는다.
- FIDS 스플릿 플랩 모션이 실제 안내판처럼 보인다. 판(타일)이 넘어가는 중간에 비지 않는다. 새 글자는 떨어지는 판 뒤에 미리 걸려 있고, 판은 중력처럼 점점 빨라지며 기울수록 어두워진다. 판 없는 글자(TIME, REMARKS, Glass Cockpit·Night Sky 테마)는 반쪽 글자 대신 한 글자씩 떨어져 앉는다. 칸마다 최대 6판이고, 안내판이 더 빨리 멈춘다.

## [0.1.0] — 2026-09-26

첫 릴리스. ✈️ Ready for takeoff.

### 추가

#### 레이더와 화면
- RADAR: 세션 ─ 워크트리 ─ 티켓 3열을 선으로 연결한다. 주인 없는 워크트리와 워크트리 없는 진행 티켓을 강조한다.
- FLIGHT STRIPS: 세션마다 스트립 하나. 상태, 점유한 STAND, 티켓, CLEARANCE를 보여 준다.
- FIDS: DEPARTURES 안내판. 목록이나 비행 단계별 보드로 보고, 글자는 스플릿 플랩으로 넘어간다.
- AIRPORTS: 저장소 등록부. `~/projects` 아래 자동 개설, 4자 코드, 첫 커밋 해시로 식별, 개설·폐쇄·이름 변경·삭제.
- OUTSTATION: 소속 AIRPORT 밖 STAND를 점유한 세션.
- 화면 전체에 항공 용어와 음성 알파벳 콜사인(`TEAM_A` → `ALPHA`).
- 흐르는 ALERT 티커.
- 테마: Radar Console, Glass Cockpit, Night Sky.
- 설정 창: 애니메이션, 시각(UTC / 지역), 밀도(보통 / 촘촘), FIDS 보기와 범위.

#### 점유, HANDOFF, 충돌
- 점유 hook(`hooks/claim.mjs`): 세션마다 어느 linked worktree에서 일하는지 기록하는 Claude Code `PostToolUse` hook. 고친 파일과 명령 위치의 `cd`·`git -C`만 센다. echo 문자열, heredoc, 읽기만 하는 명령은 세지 않는다.
- ESTIMATED TRACK: hook 기록이 없을 때 대화 기록의 도구 호출로 추정한 점유.
- Codex 세션. cwd로 점유를 잡는다.
- 점유 구간으로 판정: HANDOFF, LOSS OF SEPARATION, 잠깐 들름.
- 경보: LOSS OF SEPARATION, NORDO STAND, UNIDENTIFIED, NO CONTACT.

#### 1단계 — CONTROLLER (TOWER)
- `controller/`에서 여는 권한 제한 Claude 세션. 교통 브리핑을 읽고 팀 세션에 CLEARANCE(TRAFFIC, HOLD, CONTINUE, LAND, REPORT, INFO)를 보낸다.
- FLIGHT STRIPS에서 READBACK 추적.
- `atcctl` CLI와 Bash 제한 guard.

#### 1.5단계 — FLIGHT RECORDER와 METRICS
- 이벤트와 5분 교통량 표본을 날짜별로 추가만 하는 기록. 30일 보관.
- METRICS 탭: 충돌, CLEARANCE READBACK 비율과 시간, 머지 대기, 2단계 진입 점검.

#### 2a단계 — DISPATCH (그림자 운용)
- 배정 제안: 어떤 FLIGHT(티켓)를 어떤 AIRCRAFT(팀 세션)에 보낼지. 요소별 점수와 슬롯을 함께 보인다.
- 방치된 작업에 대한 RELEASE 제안.
- `dispatch/`에서 여는 권한 제한 DISPATCH 세션. 제안을 검토하고 메모와 CAUTION을 단다.
- SUPERVISOR가 동의·비동의를 표시하는 DISPATCH 탭. 아직 아무에게도 보내지 않는다.

#### 운용과 문서
- systemd 사용자 서비스(`deploy/atc.service`).
- 루트 README와 모든 폴더의 영어·한국어 문서.
- MIT 라이선스.

[Unreleased]: https://github.com/chaehy5665/atc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chaehy5665/atc/releases/tag/v0.1.0
