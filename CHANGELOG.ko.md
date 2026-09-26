# 변경 기록

[English](CHANGELOG.md) · **한국어**

atc의 주요 변경 사항을 여기에 적는다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를, 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따른다.

## [Unreleased]

### 추가
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
