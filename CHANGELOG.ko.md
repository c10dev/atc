# 변경 기록

[English](CHANGELOG.md) · **한국어**

atc의 주요 변경 사항을 여기에 적는다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를, 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따른다.

## [Unreleased]

### 추가
- DISPATCH 2b 승인 운용. `mode`(`shadow` / `approval`) 뒤에 있고 기본은 꺼짐. approval 모드에서 SUPERVISOR가 DISPATCH 탭에서 제안을 승인·거절하고, DISPATCH는 승인된 ASSIGN을 정해진 FLIGHT PLAN으로 CAPTAIN에게 보내며(`dispatch release`), `READBACK D-xxxx`나 거절을 기록한다. 그 FLIGHT의 STAND가 생기면 atc가 DEPARTED로 바꾼다. 승인·전달·수락된 제안은 AIRCRAFT와 FLIGHT를 예약한다. 탭에 IN FLIGHT 목록(NO READBACK / NO DEPARTURE 표시), 3단계(ATFM) 점검, 확인 창을 거치는 모드 전환이 생겼다.
- `dispatch/send-guard.mjs`: DISPATCH의 SendMessage는 approval 모드에서, SENT 상태인 제안을, 그 CAPTAIN에게, atc가 만든 FLIGHT PLAN 문구 그대로 보낼 때만 통과한다.
- 설정 창에 LINEAR·AGENTS 탭. 새 `GET /api/settings`로 서버 설정을 읽기 전용으로 보여 주고, 비밀 값은 돌려주지 않는다.
  - LINEAR: 연결 상태, 마지막 동기화, API 키 설정 여부, 팀 키, LANDING 상태.
  - AGENTS: 세션 수, 세션 폴더, 점유 hook 설치 여부, TTL과 HANDOFF 기준 시간.
- README에 릴리스 배지.
- 이 변경 기록.

### 변경
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
