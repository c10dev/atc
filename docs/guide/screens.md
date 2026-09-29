# 화면 안내

| 탭 | 주소 | 보는 것 | 할 수 있는 것 |
|---|---|---|---|
| RADAR | `#radar` | 세션 ─ STAND ─ FLIGHT 3열을 선으로 연결. 주인 없는 STAND, STAND 없는 진행 FLIGHT 강조. ARRIVED·취소된 FLIGHT의 STAND와 그것만 쥔 AIRCRAFT는 기본으로 접고 툴바에 `ARRIVED STAND N 숨김`을 보임 | 전체 보기 전환, `ARRIVED STAND 포함` |
| STRIPS | `#strips` | 맨 위 HUMAN CHECK(사람 확인을 기다리는 PR, 있을 때만)와 LANDING SEQUENCE(열린 PR), 세션마다 FLIGHT STRIP(쥔 STAND가 모두 ARRIVED·취소된 FLIGHT의 것인 AIRCRAFT는 맨 아래 접힌 `GATE CLEANUP`에 모임. 미완 FLIGHT의 STAND를 쥔 NORDO는 NORDO에 그대로): 상태, 쥔 STAND, FLIGHT(없으면 AD HOC), STAND의 PR 착륙 배지, 마지막 교신 | PR 링크 열기, 막는 조건 펼치기 |
| FIDS | `#board` | Linear 상태 열별 FLIGHT 카드와 점유 팀 배지. ARRIVED는 기본으로 STAND가 남은 것과 가장 최근 갱신된 10건만 보이고, 맨 아래 `ARRIVED N more · 전체 보기` 줄이 그 자리에서 나머지를 펼친다(누를 때마다 접기와 펼치기, 저장하지 않음). 표시 옵션의 "SCHEDULED · ARRIVED · CANCELLED 포함"을 켜면 전부 보인다. 목록과 보드가 같다. 목록 보기에서는 REMARKS 옆에 그 FLIGHT의 가장 늦은 이정표(`ON 04:02`)가 보이고, 행에 마우스를 올리면 OUT·OFF·ON·IN 넷이 나온다(OOOI, concepts의 FLIGHT FOLLOWING) | 표시 옵션(목록·보드, 포함 범위), ARRIVED 펼치기 |
| AIRPORTS | `#airports` | 저장소 등록부, 소속 AIRCRAFT, OUTSTATION으로 와 있는 AIRCRAFT | AIRPORT 개설·코드 변경·폐쇄 |
| FLEET | `#fleet` | 팀별 상태, 지금 FLIGHT, 판정 계열의 REPORT 칩(`JEV REPORT`, 켜져 있을 때 · 카드에서 맞음·틀림 표시), RULES(규칙 파일을 확인했나: `RULES current` 또는 `RULES 미확인 since <시각>`과 파일, rules-drift hook이 있을 때), 팀원, 자격, ROUTE, TARGETS와 LOGBOOK 실적(이번 주, 정시, 되돌림, LOS, 최근 FLIGHT), CHECKRIDE(TYPE RATING 근거와 추천), FLEET PLAN(atc의 제안과 AIRPORT별 수요, 그림자·승인 운용), CONTROL SESSIONS(관제 세션 배지·NEEDS YOU·ACCOUNT, `#fleet/control`) | 프로필 편집, ENTRY INTO SERVICE, LAUNCH·STOP(팀과 관제 세션 띄우기·멈추기), CREW BRIEFING, AOG, 퇴역, rating 부여·회수, FLEET PLAN 동의·반대, 승인 운용 켜기·끄기, 승인(실행) |
| NETWORK | `#network` | 4단계 운항 개요(읽기 전용): ROUTE MAP(ROUTE마다 WAYPOINT 경로·지금 구간·ETA), ROUTE(Linear 프로젝트)별 열린 FLIGHT·14일 ARRIVED·도는 AIRCRAFT·착륙 대기·프로젝트 목표, AIRCRAFT별 TARGETS 대 실적, 28일 추세(ARRIVED·착륙 대기·되돌림, 게이트 판정·합의율·CROSSCHECK 일치율) | — |
| METRICS | `#metrics` | FLIGHT RECORDER로 본 운용 지표와 추이 | — |
| DISPATCH | `#dispatch` | 위에서부터 "지금 내가 할 일" 순서: 모드 줄, 예외(걸린 ATFM GROUND STOP·main CI 실패와 그 스위치·ATFM OFF, 지연·불일치가 있는 FLIGHT FOLLOWING 줄 최대 3건과 "전체" 버튼), 배정 계획과 제안(CROSSCHECK 동의 묶음, BRIEFING 세 줄, 사실 줄, CROSSCHECK 칩, `CROSSCHECK 대기`, BLIND 표본, 접힌 점수 요소·본문·메모), HELD(PREFLIGHT), RELEASE, IN FLIGHT, ARRIVED 후보, 제외된 FLIGHT, RECENT, 맨 아래 접힌 **READINESS** 한 줄(`READINESS · 2b 5/8 · gate 12/20 ✗ · agree 92% ✓ · CROSSCHECK 93%`, 펼침은 탭마다 기억. 펴면 2b 점검표와 STAGE 2b·3, 2b·3단계 점검과 CROSSCHECK 일치, 판정 계열 세 줄(`JEV Ready`·`Prerequisite`·`Same area`, 켜져 있을 때), RECENT의 `JEV` 칩(닫힌 제안에만), BLIND 합의율, PREFLIGHT HELD·준비율, ATFM 블록(출발 중지, main CI, 머지 슬롯, 자동 배정·S3 대상 그림자 판정), FLIGHT FOLLOWING 블록(배정된 FLIGHT의 단계 막대, 지연·불일치, OCC가 보고했는지), VECTORS · DIRECT 블록(지시서별·SOLO·CREW별·2×2로 묶어 FLIGHT당 중간 질문, 질문 없이 PR, READBACK → PR 중앙값, P0–P2 지적, PR 뒤 수정 커밋, 14·30·90일, FLIGHT별 행이 원래 모양 그대로 들어 있다) | 판정, CROSSCHECK에 동의, HELD 대기열로·FLIGHT 보류 확정, 모드 전환, ATFM 스위치(main 깨짐·수동)와 수동 출발 중지, ATFM OFF |
| SCHEDULE | `#schedule` | 위에서부터 모드 줄, LATE WAYPOINTS(지연 경고, 예외라 늘 펴 둠), OCC 초안(CLASSIFY·PRIORITIZE·TAIL·WAYPOINT·NEW, CROSSCHECK 칩), 후보 수, RECENT의 판정 계열 칩(`JEV agree`, 판정한 초안에만), 맨 아래 접힌 **READINESS** 한 줄(`READINESS · gate 12/20 ✗ · agree 92% ✓ · CROSSCHECK 93%`, 펼침은 탭마다 기억. 펴면 S2 점검과 CROSSCHECK 일치, 판정 계열 일치(`JEV 일치`, 켜져 있을 때), ROUTES WITHOUT WAYPOINTS(WAYPOINT 없는 ROUTE)가 원래 모양 그대로 들어 있다) | 판정, CROSSCHECK에 동의 |
| DOCS | `#docs` | 이 안내와 변경 기록(`CHANGELOG.ko.md`에 아직 접지 않은 `changelog.d/` 조각까지 `[Unreleased]` 아래에) | — |

## NETWORK

ROUTE·AIRCRAFT·추세를 한 화면에서 보는 읽기 전용 개요다. 아무것도 바꾸지 않고, 배정 점수에도 쓰지 않는다. 숫자를 읽는 법:

- **ROUTE MAP**: 맨 위. ROUTE(Linear 프로젝트)마다 WAYPOINT(프로젝트 마일스톤)를 가로 경로로 잇는다. ●는 지난 WAYPOINT(Linear에서 done), ◉는 지금 구간(끝나지 않은 것 중 순서상 첫 번째)과 진행률, ○는 앞으로 갈 WAYPOINT다. 지금 구간 위의 ✈는 그 WAYPOINT의 FLIGHT를 모는 AIRCRAFT다(FOLLOWING과 같은 규칙: ASSIGN 제안, 없으면 `tail:` 라벨). 주황은 지연이다. WAYPOINT를 누르면 완료 기준이 보이고, atc가 잴 수 있는 기준(판정 게이트, 2b 점검표, 모드, ATFM 켜기 조건) 아래에는 지금 상태가 ✓ 충족 · ✗ 미달 · ○ 데이터 부족 · △ 확인 필요로 붙는다.
  - WAYPOINT를 누르면(Tab으로 옮겨 Enter·Space도 된다) 진행률, 목표일, ETA, 완료 기준(마일스톤 설명의 "Exit criteria" 번호 목록), FLIGHT 목록(진행·막힘·계획·완료와 AIRCRAFT)이 열린다. 한 번 더 누르거나 ✕로 닫는다.
  - **ETA**: 그 ROUTE에서 최근 28일에 끝난 FLIGHT 수(LOGBOOK ARRIVED와 Linear 완료 시각)로 하루 속도를 내고, 이 WAYPOINT까지 남은 FLIGHT(앞 구간 것 포함)를 나눈다. 28일 완료가 3개 미만이거나, 남은 FLIGHT가 없거나, FLIGHT가 50개를 넘으면 "모름"이다. 목표일이 ETA보다 앞이거나 이미 지났으면 "지연"이다.
  - 마일스톤이 없는 ROUTE는 아래쪽에 "WAYPOINT 없음" 점선으로, 열린 FLIGHT 수(진행·계획·막힘)와 AIRCRAFT만 보인다. WAYPOINT를 만들려면 Linear 프로젝트에 마일스톤을 추가한다(atc는 읽기만 한다).
  - 좁은 화면에서는 경로가 자기 상자 안에서 가로로 넘어간다.
- **ROUTE 표**: Linear 프로젝트마다 한 줄. 열린 FLIGHT는 Todo(FILED)·In Progress(ENROUTE)·In Review(APPROACH, Ready to Merge 포함)로 나눠 센다. Backlog·끝난 것·상위 이슈는 세지 않는다. ARRIVED 14일은 그 프로젝트 FLIGHT의 LOGBOOK 기록이고, 착륙 대기는 그 기록의 중앙값이다. 목표(목표일·진척·상태)는 Linear 프로젝트에서 10분마다 읽고, 못 읽으면 비어 있다.
- **AIRCRAFT 표**: FLEET 카드와 같은 숫자다(이번 주 ARRIVED 대 `flightsPerWeek`, 14일 정시율 대 `onTime`, 착륙 대기, 되돌림, LOS). 퇴역 AIRCRAFT는 빠진다.
- **추세**: 최근 28일. 날마다 ARRIVED 수, 착륙 대기 중앙값, 되돌림. 게이트 줄은 날마다 DISPATCH·SCHEDULE 그림자 판정 수와 그날까지의 누적 합의율(마지막 날이 DISPATCH·SCHEDULE 탭의 게이트 숫자와 같다), 둘을 합친 CROSSCHECK 일치율.
- Linear·GitHub·LOGBOOK 중 못 읽은 것이 있으면 그 표시가 뜬다. 그 출처에서 온 숫자는 비거나 0일 수 있다.

TARGETS·ROUTE를 바꾸는 것은 지금처럼 FLEET 탭에서 SUPERVISOR가 한다. OCC가 변경 초안을 내는 흐름은 설계만 있다(`docs/fleet.ko.md` 7.4).

## STRIPS의 HUMAN CHECK

PR 본문 `## UI change` 블록의 class가 CHOICE·ACCOUNT·DEVICE인데 이 head에 `Human check: done`이 없는 PR만 LANDING SEQUENCE 위 `HUMAN CHECK n`에 모인다. 없으면 이 칸이 보이지 않는다.

- 줄마다 `#번호`, AIRPORT·FLIGHT, STAND를 쥔 팀, class 칩, 상태(`pending`, `FAILED`, `옛 head에 기록됨 (sha)`, `채우지 않음`), 제목.
- 증거: Evidence pack 링크가 가리키는 PR 댓글의 스크린샷 썸네일, 이 head의 RUN-UP 보고서가 있으면 바뀐 화면·컷 수, UNEXPECTED 경고, 바뀐 컷 썸네일과 보고서 링크. 증거가 없으면 "증거 없음".
- ACCOUNT·DEVICE면 **Preview ↗**(현재 head의 Preview)와 사람이 할 1~3 단계.
- **PASS**·**FAIL**: 메모 칸에 본 것을 적고 누른다(FAIL은 메모 필수). atc가 PR 본문의 `Human check:` 줄 하나를 `done <날짜> <sha> <메모>`(또는 `failed`)로 바꾸고 PR 댓글 하나를 단다. 결과는 이 head에 묶인다. 그 뒤 main 병합만 한 head는 결과를 잇고, PR 변경이 바뀐 head는 다시 확인해야 한다. 화면이 본 head가 그새 바뀌었으면 거절된다.
- 누르면 "PASS 기록됨 · sha · 댓글"이 뜨고, GitHub을 다시 읽으면(90초 안) 줄이 대기열에서 빠진다.
- AUTOLAND `merge`는 이 대기열의 PR과 `## UI change` 블록이 없는 PR을 머지하지 않는다. LANDING SEQUENCE 줄에는 `HUMAN CHECK ACCOUNT: pending`처럼 보인다.

## STRIPS의 LANDING SEQUENCE

STRIPS 맨 위에 GitHub에 열린 PR을 LANDING 순서대로 보여 준다([개념](concepts.md)의 LANDING SEQUENCE).

- **CLEARED TO LAND**: 조건을 모두 채운 PR. 준비된 순서(`readyAt`)대로 번호가 붙고 펼쳐 둔다. 제목의 숫자가 CLEARED TO LAND PR 수다.
- **APPROACH**: 막는 조건이 남은 PR(Draft 제외). PR을 연 순서로, 접어 둔 줄을 누르면 열린다. 줄마다 막는 조건이 한국어 한 줄씩 붙는다.
- **DRAFT**: 흐리게, 접어 둔다. LANDING SEQUENCE에는 들지 않는다.
- 줄마다 AIRPORT·FLIGHT(없으면 AD HOC), `#번호`(GitHub PR로 열림)와 제목, 그 STAND를 쥔 팀(없으면 STAND 이름이나 "STAND 없음").
- GitHub 조회가 실패하면 위에 "GitHub 조회 실패 · PR 상태가 오래됐을 수 있음"이 뜬다(마우스를 올리면 오류).
- **AUTOLAND**가 켜져 있으면 제목 아래에 AIRPORT마다 한 줄: `UPDATE VCDO AUTOLAND: updating #383`(갱신함, CI 대기), `AUTOLAND: waiting — #383 CLEARED, SUPERVISOR 머지 대기`(먼저 머지하거나 HOLD), `AUTOLAND: GROUND STOP — main Application Check 실패`(빨강, 설정 창에서 푼다), `AUTOLAND: 갱신할 PR 없음`.
- PR 줄마다 AUTOLAND 표시: `AUTOLAND update 대기 2번째`, `AUTOLAND 대기 — 리뷰 없음 먼저`(behind 말고도 막힘이 있음), `AUTOLAND 제외 — DIRTY(충돌)`(Draft, STACKED, 충돌, LOS는 건드리지 않음), `AUTOLAND: review requested (codex)`·`(deepseek)`(갱신한 head에 리뷰가 이어지지 않아 atc가 재리뷰를 요청함), `AUTOLAND: SUPERVISOR 리뷰 필요 — 외부 리뷰 제외(…)`, merge 모드면 `AUTOLAND merge 대상` 또는 `SUPERVISOR 머지 — rating:SEC`(머지하지 않는 까닭).
- **HOLD** 버튼(AUTOLAND가 켜졌을 때, 맡은 AIRPORT의 PR): 누르면 `HOLD ✓`. AUTOLAND가 그 PR을 머지하지 않고, CLEARED여도 다음 PR 갱신을 막지 않는다. 다시 누르면 풀린다.

STAND 줄의 REMARKS 칸에도 그 STAND 브랜치의 PR 배지가 붙는다.

| 배지 | 뜻 |
|---|---|
| `CLEARED TO LAND` (+ `SEQ n`) | 머지할 수 있음. `SEQ n`은 CLEARED TO LAND PR이 둘 이상일 때 몇 번째인지 |
| `APPROACH` + 숫자 | 막는 조건 수. 아래 줄에 짧은 이름(CI 실패, 리뷰 없음, BEHIND …)이 있고, 누르면 전체 문장이 펼쳐진다 |
| `#번호` | GitHub PR 링크 |

## 상단

- **숫자판**: AIRBORNE(작업 중 세션), STANDS(점유), ENROUTE(진행 FLIGHT), HANDOFF, ALERTS(WARNING·CAUTION만 센다. ADVISORY는 `+n ADV`로 옆에 보인다. 색: WARNING이 있으면 빨강, CAUTION만 있으면 호박, 없으면 기본).
- **UPDATE 막대**: 서비스가 `origin/main`보다 뒤이고 main CI가 통과했으면 `업데이트 있음 · c0ca22e → 4678e03 · PR 2 · CI ✓ [업데이트]`가 뜬다. 버튼이 MCC와 같은 `atc-rts`를 시작하고 막대가 진행·거절·ROLLBACK을 보인다. 사람이 배포해야 하면 버튼 대신 사유가 뜬다([배포하기](deploy.md)).
- **새 버전 알림**: 이 탭을 연 뒤에 atc가 새로 배포되면 콘솔 바로 아래에 "새 버전이 배포됨"과 새로고침·닫기 버튼이 뜬다. 저절로 새로고침하지 않는다(입력 중인 내용을 지키려고). 닫으면 다음 배포 때까지 안 뜬다.
- **ALERT 줄**: WARNING·CAUTION이 흘러간다(WARNING이 있으면 빨강). ADVISORY만 있으면 줄이 없다. 누르면 목록이 열린다(등급별로 묶인다). [경보 종류](#경보-종류)
- **ATC 로고**: 설정(테마, 움직임, 시계, LINEAR, AGENTS, AUTOMATION). 창은 마지막에 쓴 탭으로 다시 열린다(이 브라우저에 기억, 없으면 화면). AGENTS 탭에는 SOURCES, STANDS, CALLSIGNS와 관제 세션 안내 한 줄이 있고, SUPERVISOR의 정책 스위치는 모두 **AUTOMATION 탭**에 있다(2026-09-29부터). 탭 맨 위 한 줄이 지금 정책이다: `AUTOLAND off · MCC shadow · JEV off · FUEL HOLD off · REVIEW exclude`. ⚠ 모드는 호박색이다. **⚠ 모드로 올릴 때**(AUTOLAND `update`·`merge`, MCC `land`·`land+rts`·`rts`, JEV `replay`·`shadow`, FUEL HOLD `on`, REVIEW `deepseek`)는 고르는 중에 그 모드의 경고가 보이고, 저장을 누르면 "○○로 올리기" 확인 버튼이 한 번 더 나온다. 내리는 것(`off`, MCC `shadow`, REVIEW `exclude`)은 전처럼 바로 저장된다. 스위치마다 지금 모드의 경고만 보이고, 나머지 모드는 "다른 모드 n개"에 접혀 있다. REVIEW의 `deepseek`은 옛 이름이라 화면에는 `sonnet (deepseek)`으로 보인다(저장 값은 그대로). AUTOMATION 탭의 **REVIEW** 줄(`externalReview.security`)은 Codex 한도 때 보안 PR도 착륙 리뷰 세션(REVIEW, Claude Sonnet)에 보낼지 정한다. 기본 exclude, deepseek(옛 이름, 뜻은 "보냄")으로 바꾸면 보안 PR도 REVIEW가 리뷰한다(`.env`·비밀 경로와 FLIGHT 없는 PR은 계속 빠짐). 스트립에는 "REVIEW: SONNET (보안, Codex 한도)"로 보인다. 같은 탭의 **AUTOLAND** 줄(`autoland.mode`)은 착륙 자동화 스위치다: `off`(기본), `update`(behind인 CLEARED PR을 하나씩 갱신, 머지는 SUPERVISOR), `merge`(위임된 PR은 머지까지. vocado AGENTS.md에 예외를 적은 뒤에만). 모드마다 경고가 한 줄씩 보이고, GROUND STOP이 걸려 있으면 그 아래 **풀기** 버튼이 있다. 이 스위치는 이 화면에서만 바뀐다(관제 세션은 못 바꿈). 같은 탭의 **MCC** 줄 아래 **SHADOW GATE** 패널은 MCC를 `land`로 올릴 근거를 보여 준다: 판단한 atc PR(머지된 head에 INSPECTION·ESCALATE) 20건 이상, 첫 MCC 기록부터 5일 이상, would-land였는데 되돌린 PR 0건. 셋 다 맞으면 "준비됨"이다. 그 아래에는 불일치가 PR 링크와 함께 보인다: MCC가 findings였거나 INSPECTION이 없었는데 사람·structure가 머지한 PR, would-land였는데 되돌린 PR. 불일치를 보고 판단하는 것과 모드를 올리는 것은 SUPERVISOR가 MCC 줄에서 한다(패널은 읽기만). 관제 세션(TOWER·OCC·MCC·CROSSCHECK·REVIEW·ENGINEERING)은 2026-09-29부터 설정이 아니라 **FLEET 탭의 CONTROL SESSIONS 구역**(AIRCRAFT 목록 아래, 주소 `#fleet/control`)에 있다. 이 탭의 **CONTROL** 줄은 그리로 가는 링크 한 줄이다. 구역은 세션마다 떠 있는지 배지로 보인다: `BG <id>`(atc가 띄운 백그라운드), `tmux <세션>`(tmux pane), `interactive`(데스크톱 등, 그 창에서 닫는다), `not running`. 꺼져 있으면 **LAUNCH**: 다섯 세션 모두 그 폴더에서 백그라운드(`claude --bg`)로 띄운다(첫 메시지 `/loop … /tick`). 모델은 폴더 설정이 정한다: TOWER·OCC·REVIEW는 Claude Sonnet, MCC·CROSSCHECK는 Claude Opus. 떠 있으면 **STOP**(tmux pane에서 연 세션이면 묻고 나서 그 pane만 닫는다). ENGINEERING은 배지만 있다. FLEET가 보이는 동안 1분에 한 번 다시 읽는다. 같은 탭의 **JUDGES** 줄(`judges.jev`)은 판정 계열 Jev 스위치다: `off`(기본), `replay`(판정한 지난 CLASSIFY 초안을 다시 판정), `shadow`(새 CLASSIFY 초안을 판정해 두고 판정 뒤에만 보임). 켜면 티켓 제목과 목표·수정 허용 범위·완료 기준이 TypeSafe로 나간다(`rating:SEC`·Risk 티켓은 제목만). DISPATCH의 열린 ASSIGN도 같은 스위치로 판정하고, 그때는 AIRCRAFT의 지난 atc FLIGHT 3개의 제목도 나간다. atc 저장소 AIRCRAFT의 턴이 끝날 때 CAPTAIN의 마지막 메시지(경로·URL을 가리고 최대 1,500자)도 나간다. 이것도 이 화면에서만 바뀐다.

## 경보 종류

경보마다 등급이 있다(ECAM의 WARNING·CAUTION·ADVISORY). 상단 ALERTS 숫자와 ALERT 줄은 조치가 필요한 WARNING·CAUTION만 센다. ADVISORY는 숫자에서 빠지고 `+n ADV`로 옆에 보인다. 목록에는 세 등급이 모두 있다.

| 경보 | 등급 | 뜻 |
|---|---|---|
| LOSS OF SEPARATION | WARNING(빨강) | 두 세션이 같은 STAND를 겹쳐 건드림 |
| STRANDED | WARNING(빨강) | FLIGHT의 PR이 main이 아닌 브랜치에 머지돼 main에 닿지 않음(Linear가 Done이어도 뜬다, ATC-29) |
| AIRCRAFT HEALTH | CAUTION(호박) | AIRCRAFT의 NETWORK·LIMIT 같은 health 경보(ATC-45) |
| NO CONTACT | CAUTION(호박) | ENROUTE인데 STAND가 없는 FLIGHT(상위 이슈는 제외) |
| UNIDENTIFIED | CAUTION(호박) | 점유한 AIRCRAFT 없이 바뀐 STAND |
| NORDO STAND | CAUTION(호박) | 죽은 세션이 쥔 STAND. 그 STAND의 FLIGHT가 아직 ARRIVED·CANCELLED가 아니거나 FLIGHT가 없을 때 |
| NORDO STAND | ADVISORY(회색) | 죽은 세션이 쥔 STAND인데 그 FLIGHT가 ARRIVED·CANCELLED라 정리만 하면 됨 |

목록은 등급 순(WARNING → CAUTION → ADVISORY)이고, 같은 등급 안에서는 종류끼리 묶인다. ADVISORY만 있으면 ALERT 줄이 뜨지 않고 ALERTS는 `00 +n ADV`로 보인다. 그것을 누르면 목록이 열린다.
