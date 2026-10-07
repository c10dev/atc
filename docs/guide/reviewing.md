# 판정하기

atc의 자동화는 **그림자 운용**에서 시작한다. 제안과 초안을 만들어 화면에만 보이고, 사용자가 "승인했을 것 / 거절했을 것"을 표시해 품질을 잰다. 기준(20건, 합의율 80%)이 차면 다음 단계로 간다.

## HOME: 남은 승인과 brake

2026-10-02부터 DISPATCH는 사람 없이 난다: 서버가 필터와 상한을 통과한 ASSIGN·launch 카드를 스스로 승인한다([screens](screens.md)). 그래서 DISPATCH 탭은 없고, 사용자에게 남은 일은 **HOME**(`#home`) 한 곳에 모였다. 옛 `#dispatch` 주소(북마크, 큐와 메뉴 막대의 링크)도 HOME을 엽니다. 아무 일이 없으면 HOME에는 맨 아래 brake 줄만 있습니다.

| 구역 | 무엇이 보이나 | 할 수 있는 것 |
|---|---|---|
| QUEUE | 사용자의 결정을 기다리는 것(SUPERVISOR QUEUE 전체). 설정의 **DISPATCH 자동 운항**을 끄면 ASSIGN·launch 카드가 줄로 옵니다. RELEASE 카드(STAND 없이 7일 넘게 ENROUTE인 FLIGHT를 Todo로 되돌릴지)도 같습니다 | 줄의 **승인**·**거절**(누르면 줄 안에서 한 번 확인합니다. 거절은 사유를 적을 수 있고 같은 짝은 24시간 다시 제안하지 않습니다). 다른 줄(FLEET PLAN, UPDATE, 머지 …)의 버튼도 같은 자리입니다 |
| ALERTS | WARNING과 CAUTION 알림 | 눌러서 그 항목으로 갑니다 |
| STUCK | 막힌 FLIGHT 줄([FOLLOW](follow.md)의 막힘 한도를 넘은 것)과 이유 | 줄에서 **CANCEL…**(승인했지만 아직 안 보낸 카드), **RECALL…**(보낸 FLIGHT PLAN) |
| BRAKES(아래 패널의 **BRAKES** 탭. 어느 화면에서든 열린다. 접힌 머리에서는 정지가 걸려 있으면 `BRAKES 1 STOP`처럼 개수가 보인다) | 늘 있는 중립 줄: `GROUND STOP n` · `수동 출발 중지 n`, 자동화 스위치의 지금 상태 한 줄, DISPATCH 모드 | **ATFM…**(GROUND STOP 스위치, 수동 출발 중지, ATFM OFF, 머지 슬롯), **STOP ALL…**(관제 세션 모두 내림. 미리 보기를 먼저 봅니다), DISPATCH 2a↔2b 전환, **스위치 설정**(설정 창) |

배정의 이력은 **FLIGHT 서랍**의 `배정 기록`에서 읽습니다: 제안마다 단계 시각, 사유, 그리고 지금 할 수 있는 CANCEL…·RECALL…·**FRESH START…**. 자동 승인한 카드가 나중에 틀렸다고 드러난 몫은 **METRICS**의 MISFIRE에 날짜별로 있습니다. FOLLOW의 각 줄에도 같은 CANCEL…·RECALL…이 있습니다.

사라진 것: 카드를 하나씩 판정하는 화면, CROSSCHECK 동의 묶음과 BLIND 표본, HELD(PREFLIGHT) 목록, 2b 진입 점검(READINESS)과 DISPATCH 쪽 FLIGHT FOLLOWING 블록. 모두 자동 운항이 대신하거나 FOLLOW·METRICS가 이미 보여 주는 것입니다.

## SCHEDULE 초안: HOME의 QUEUE

OCC가 Linear에 쓸 변경을 초안으로 남긴다. SCHEDULE 탭은 2026-10-02에 없어졌다(`#schedule`은 HOME을 연다). 남은 것은 이렇게 나뉘었다: **S2(승인 운용)에서 판정을 기다리는 초안은 HOME의 QUEUE 줄**이고(줄마다 **승인**·**거절**, 한 번 확인. TARGET·ROUTE는 적용하는 길이 없어 **동의**·**거절**로 기록만 한다), 지연 WAYPOINT는 HOME의 **LATE WAYPOINTS**, 승인한 CLOSE는 HOME의 **LINEAR에서 직접 DONE**, SCHEDULE S1↔S2 스위치는 아래 패널의 BRAKES 탭, 새 이슈 제안(NEW)은 RELEASE의 후보다. 사라진 것: S1에서 초안을 "승인했을 것 / 거절했을 것"으로 판정하는 화면, CROSSCHECK 칩, 판정 계열 칩, 후보·RECENT·IN PROGRESS 표, 맨 아래 READINESS 줄(S2 진입 점검, ROUTES WITHOUT WAYPOINTS). S1에서는 초안이 QUEUE에 오지 않고, 서버의 SCHEDULE AUTO가 켜져 있으면 서버가 승인한다.

| 초안 | 내용 |
|---|---|
| CLASSIFY | 분류 라벨 제안: type · wake · rating. 후보 목록은 제목이 리서치·검토·비교·계획처럼 보이는 FLIGHT가 앞에 온다(SURVEY·CHECK로 분류되면 HOLDING 팀도 받을 수 있어서) |
| PRIORITIZE | 우선순위 제안(본문·댓글에 근거가 있을 때만) |
| TAIL | FLIGHT의 `tail:TEAM_X`를 그 팀으로 정하자는 제안. 사용자가 OCC에 말한 배정이나, `tail:` 없이 팀이 이미 몰고 있는 FLIGHT에서 나온다. 카드에 지금 `tail:`, 바뀔 것(`+ tail:TEAM_J`, `− tail:TEAM_A`), 근거가 있다. 다른 팀이 몰고 있는 `tail:`을 바꾸면 빨간 **CAUTION** 줄이 붙는다. 판정은 CLASSIFY·PRIORITIZE처럼 S2 진입 점검에 센다. 후보 목록의 TAIL은 그 팀이 몰고 있다는 기록(STAND, DEPARTURE LOG, READBACK)을 함께 보인다 |
| WAYPOINT | 마일스톤이 없는 FLIGHT를 그 ROUTE의 WAYPOINT(Linear 마일스톤)에 붙이자는 제안. 카드에 "WAYPOINT 없음 · ROUTE", 바뀔 것(`WAYPOINT 없음 → ROUTE · WAYPOINT`), OCC 근거(그 WAYPOINT의 완료 기준 번호)가 있다. 그 기준이 정말 이 FLIGHT를 덮는지 보고 판정한다. 후보 목록에는 WAYPOINT가 있는 ROUTE에서 어느 WAYPOINT에도 없는 열린 FLIGHT와 붙일 수 있는 WAYPOINT가 보인다. 판정은 S2 진입 점검에 센다. 마일스톤은 만들거나 바꾸지 않고 이슈의 milestone 칸만 바꾼다 |
| NEW (AD HOC FLIGHT) | 사용자가 OCC에 요청한 새 티켓. `WAYPOINT` 줄이 있으면 그 마일스톤에 붙을 이슈다. "완료 기준에서 올린 초안(WAYPOINT gap)"이면 OCC가 Linear 마일스톤의 완료 기준 가운데 아직 이슈가 없는 것을 옮긴 것이다. 본문 `## 목표`에 인용된 기준을 보고, 그 기준을 이 이슈가 맡는 게 맞는지 판정한다. 비슷한 FLIGHT가 있으면 atc가 받지 않으니, gap 초안에는 비슷한 FLIGHT가 없다 |
| TARGET · ROUTE | AIRCRAFT 하나의 FLEET 목표(`flightsPerWeek`, `onTime`)나 ROUTE(맡는 프로젝트)를 바꾸자는 초안. 카드에 지금 값, 바뀔 것, OCC 근거, atc가 붙인 숫자(14일 ARRIVED, 주별 ARRIVED, ROUTE 대기)가 있다. S2에서도 "승인했을 것 / 거절했을 것"만 받고 FLEET에 쓰지 않는다 — 바꾸려면 FLEET 탭에서 직접. 이 판정은 S2 진입 점검에 세지 않는다 |
| CLOSE | PR이 머지됐는데(LOGBOOK ARRIVED) Linear에서 아직 열린 FLIGHT를 Done으로. 카드에 PR 링크, 머지 시각, 본문이 `Fixes`인지가 있다. `Part of`(일부만)면 노란색으로 표시된다 |

- QUEUE 줄에 초안의 종류와 대상, OCC 근거 한 줄이 있다. 맞으면 승인, 아니면 거절(사유 선택).
- 라벨이 당장 필요하면 Linear에서 직접 붙인다. 그러면 초안은 "Linear에 이미 반영됨"으로 스스로 닫힌다.
- 열린 초안은 5건까지. 3일 동안 판정이 없으면 EXPIRED.
- **CLOSE는 Linear에서 직접 닫는다.** vocado 규칙상 OCC는 이슈 상태를 바꾸지 않으므로 S2에서도 CLOSE는 발부되지 않는다. 승인한 CLOSE(그림자 운용이면 "승인했을 것")는 HOME의 **LINEAR에서 직접 DONE** 목록에 이슈·PR 링크와 함께 뜬다. Linear에서 Done으로 바꾸면 다음 새로 고침에 목록과 초안이 함께 닫힌다. PR이 되돌려지면 초안은 스스로 SUPERSEDED된다.
- CLOSE 판정 기준: PR 본문이 `Fixes VOC-n`이고 완료 기준이 그 PR로 채워졌으면 승인, `Part of`이거나 남은 일·되돌림이 있으면 거절(사유 칩 "Part of — 일부만 끝남", "남은 작업이 있음" …).
- **LATE WAYPOINTS**: ETA가 WAYPOINT(Linear 마일스톤)의 목표일을 넘거나 목표일이 지났으면 HOME에 예외로 뜬다(있을 때만). 판정할 것은 아니다. OCC는 새 경고를 세션에서 한 번 보고하고, 목록에는 풀릴 때까지 남는다("OCC 보고 …"). 목표일을 옮길지, 일을 줄일지, FLIGHT를 더 배정할지는 SUPERVISOR가 정한다. ETA 계산은 NETWORK 탭 ROUTE MAP과 같다.
- **WAYPOINT 없는 ROUTE**: 열린 FLIGHT가 있는데 WAYPOINT(마일스톤)가 하나도 없는 ROUTE는 ETA를 셀 수 없고 WAYPOINT 초안도 쓸 곳이 없다. 이 목록은 화면에서 없어졌다(OCC는 새 ROUTE를 세션에서 한 번 알린다). WAYPOINT가 필요하면 Linear에서 그 프로젝트에 마일스톤을 만든다(OCC는 만들지 않는다).
- **S2 진입 점검**: 판정 20건 이상, 합의율 80% 이상. 그때 Linear 쓰기가 열린다(승인한 초안만, linear-guard로). 점검 숫자를 보이던 SCHEDULE 화면의 READINESS 줄은 없어졌다.
- **S2(승인 운용)**: 아래 패널 BRAKES 탭의 `SCHEDULE SHADOW — S2로`로 켠다(만들어 두었고 기본은 꺼짐). 켜면 초안이 QUEUE 줄에 "승인 / 거절"로 오고, 승인한 작업은 APPROVED → RELEASED(OCC가 Linear에 씀) → APPLIED(Linear에 보임)로 진행한다. OCC가 쓰는 내용은 atc가 만들고, linear-guard가 그 입력과 다른 쓰기는 모두 막는다. 같은 호출은 한 번만 통과하므로 되풀이해도 댓글이 두 번 달리지 않는다. RELEASED인데 Linear에 반영되지 않았으면 OCC가 보고하고, Linear에서 직접 바꾸면 APPLIED로 닫힌다. 켜기 전 준비는 저장소의 `docs/occ.ko.md` "S2 켜는 법".

## RECALL: 보낸 FLIGHT PLAN 거둬들이기

승인했지만 아직 보내지 않은 카드는 FOLLOW 줄이나 FLIGHT 서랍(배정 기록)의 **CANCEL…**을 누르고 확인한다(보낸 뒤에는 RECALL). 카드는 `SUPERVISOR가 취소함`으로 닫히고 같은 짝은 24시간 다시 제안되지 않는다.

받을 AIRCRAFT의 대화가 커서(FLEET의 FOB가 호박색·경고색, REFRESH 기준 300k 또는 창의 40 %) 새 세션으로 시작하게 하고 싶으면 같은 카드의 **FRESH START…**(FLIGHT 서랍)를 누르고 확인한다. atc가 그 백그라운드 세션을 멈추고, 첫 프롬프트가 CREW BRIEFING에 이어 이 FLIGHT PLAN인 새 세션을 띄운다. 그 FLIGHT PLAN은 보낸 것으로 기록되고(`FRESH START로 보냄`) OCC는 다시 보내지 않으며, READBACK부터는 평소와 같다. 버튼은 세션이 **백그라운드**이고 대화가 기준을 넘었고 끝나지 않은 FLIGHT의 STAND가 없고 턴 중이 아닐 때만 나온다. 아니면 그 줄에 이유(`FRESH START 불가 — …`)가 보인다. 데스크톱·터미널 세션은 atc가 멈추지 않으니 그 세션에서 `/clear`하고 CREW BRIEFING을 붙여 넣는다. 띄우기가 거절되면(백그라운드 세션 상한 등) 세션은 멈춘 채고 카드는 승인된 그대로이니, FLEET에서 LAUNCH하거나 CANCEL한다.

**자동 FRESH START**(ATC-560): AIRPORT 스위치가 `always`(배포 값)면 이 버튼을 누르지 않아도 된다. OCC가 승인된 카드를 보내려 할 때 받을 AIRCRAFT의 세션이 이미 FLIGHT를 날았으면, atc가 같은 STOP·LAUNCH를 스스로 하고 FLIGHT PLAN을 새 세션의 첫 프롬프트로 보낸다. 세션의 첫 FLIGHT, 열린 PR·끝나지 않은 FLIGHT의 STAND가 있는 AIRCRAFT, 쉬는 백그라운드 세션이 아닌 AIRCRAFT, LIMIT·FUEL hold는 다시 띄우지 않고 지금처럼 보낸다(사유는 FLIGHT RECORDER에 남는다). `over`는 대화가 base + 50k(보통 약 100k)를 넘을 때만, `off`는 버튼만이다. 스위치와 AIRPORT마다 최근 7일 오작동 수는 설정 창 AUTOMATION → OPERATIONS → **FRESH START**에 있다.

2b에서 FLIGHT PLAN을 보냈거나 CAPTAIN이 READBACK했는데 거둬들여야 하면(우선순위가 바뀜, 잘못 배정됨 등), FOLLOW 줄이나 FLIGHT 서랍의 **RECALL…**을 누르고 사유를 적는다.

- OCC가 CAPTAIN에게 RECALL 문구를 보낸다. CAPTAIN은 작업을 멈추고 STAND(워크트리)를 정리하지 않은 채 두고 "READBACK D-xxxx RECALL"로 답한다. 그러면 RECALLED가 된다.
- RECALL 중에는 "RECALL 중"으로 보이고, 10분 넘게 답이 없으면 "RECALL READBACK 없음 10분+"가 뜬다.
- FLIGHT는 다시 후보가 된다. 같은 팀에는 24시간 제안하지 않는다.
- STAND가 생긴 뒤(DEPARTED)에는 RECALL 버튼이 없다. 그때는 CAPTAIN에게 직접 말한다. STAND 없는 FLIGHT(SURVEY·CHECK)는 DEPARTED여도 ARRIVED 전이면 RECALL할 수 있다. 그 RECALL 문구는 STAND 대신 중간 결과를 남기라고 한다.
- 출발 중지가 켜져 있어도 RECALL은 된다.

## STAND 없는 FLIGHT: READBACK에 DEPARTED, 보고로 ARRIVED

2b에서 SURVEY·CHECK는 워크트리가 없어 STAND로 출발을 알 수 없고, PR 머지(LOGBOOK)로 도착을 알 수도 없다.

- CAPTAIN이 READBACK하면 바로 DEPARTED가 된다(`departedVia: "readback"`, STAND 없음). 진행 중 목록에 ARRIVED까지 남고, 그 팀의 STAND 없는 칸 하나를 잡는다. 24시간이 지나도 만료되지 않는다.
- CAPTAIN이 마쳤다고 알리면 OCC가 `dispatch arrived D-xxxx -- '<결과 링크나 한 줄>'`로 적는다. 그러면 ARRIVED가 되고 보고 한 줄(링크)이 카드에 남는다. ARRIVED한 FLIGHT는 Linear가 아직 Todo여도 7일 동안 다시 제안하지 않는다.
- **ARRIVED 후보**(ATC-72): 보고가 없어도 atc가 일이 끝난 흔적을 찾아 카드의 진행 중 줄에 "ARRIVED 후보 · 대상 PR 리뷰 · 증거 ↗"처럼 보인다. CHECK는 그 팀이 검토 대상 PR에 남긴 리뷰, SURVEY는 문서만의 머지 PR·FLIGHT key를 단 댓글·결과 링크를 단 Linear 댓글이다. 팀은 그 팀 세션 기록의 `gh`·Linear 호출로 안다(계정이 하나라 작성자로는 모른다). 후보는 제안일 뿐이다: OCC가 증거를 열어 보고 맞으면 적힌 명령을 친다. atc는 스스로 ARRIVED를 적지 않는다.
- D-xxxx 없이 직접 배정된 STAND 없는 FLIGHT도 된다. 팀의 READBACK이 착수(DEPARTURE LOG)가 되고, 후보는 진행 중 표 아래 "ARRIVED 후보" 목록에 보인다. OCC는 `dispatch arrived <FLIGHT> --aircraft <TEAM_X> -- '<링크>'`로 적는다.
- 확인된 ARRIVED는 LOGBOOK에 PR 없는 줄로 남아 TARGETS(이번 주·정시), CHECKRIDE, FUEL에 센다. FLEET 카드 최근 FLIGHT에는 PR 번호 대신 "STAND 없음 · 후보 확인"이나 "STAND 없음 · 보고"가 붙는다.
- 보고 없이 24시간이 지나면 늦은 것(overdue)에 뜬다. OCC는 CAPTAIN에게 직접 물을 수 없으니 SUPERVISOR가 챙긴다.
- 2b → 3 점검의 DEPARTED 비율에는 STAND가 필요한 FLIGHT만 센다. STAND 없는 FLIGHT는 READBACK 비율에만 들어가고, READBACK·ARRIVED 수가 따로 보인다. 그 아래 "일이 끝난 뒤 24시간 안 ARRIVED"는 최근 30일 STAND 없는 ARRIVED가 제때 확인된 비율이다(24시간 넘게 확인 안 된 후보는 놓친 것).

## LAUNCH 카드와 RESUME 카드: 세션이 없는 AIRCRAFT

atc가 띄운 백그라운드 AIRCRAFT는 마지막 턴 뒤 60분쯤 쉬면 Claude Code가 세션을 거둔다(FLEET에는 NOT IN SERVICE). 그래도 DISPATCH 후보로 남는다.

- **LAUNCH 카드**: 그런 AIRCRAFT로 가는 카드에는 `LAUNCH on approve`가 붙는다. 2b에서 승인하면 atc가 FLEET의 LAUNCH와 같은 길로 그 세션을 띄우고(마지막 LAUNCH의 permission mode·모델), 새 세션이 뜨면 OCC가 FLIGHT PLAN을 보낸다. 그 사이 카드는 승인된 채 `LAUNCHING — 새 세션을 기다림`이다. 승인 한 번이 전부이고, 승인하지 않으면 아무것도 뜨지 않는다.
- **상한**: 살아 있는 백그라운드 세션과, 승인했지만 아직 세션이 안 뜬 LAUNCH 카드를 합쳐 상한(기본 6, `ATC_MAX_LAUNCHED`)까지다. 차면 카드에 `LAUNCH 대기 — 백그라운드 … / 상한 6 …`이 보이고 승인이 막힌다. 자리가 나면 승인한다.
- **LAUNCH 실패**: 띄우지 못했거나 30분 안에 새 세션이 안 뜨면 카드가 `LAUNCH 실패 — 사유`로 닫히고 FLIGHT PLAN은 나가지 않는다. FLIGHT FOLLOWING에 하루 뜬다. 다음 계획에 같은 카드가 다시 나오니 원인(예: 그 저장소 trust)을 고친 뒤 다시 승인하면 된다.
- **RESUME 카드**: 사용 한도로 턴이 잘린 채 세션이 사라진 AIRCRAFT는 한도가 풀린 뒤 같은 FLIGHT·같은 AIRCRAFT의 RESUME 카드로 돌아온다(LAUNCH 카드이기도 하다). 카드에는 STAND(워크트리)와 브랜치, 마지막 커밋, CAPTAIN의 마지막 보고 한 줄이 실린다. 보내는 FLIGHT PLAN은 "resume, don't restart" — 처음부터 다시 하지 말고 거기서 이어서 하라고 적는다. 같은 끊김에는 한 번만 나온다(거절하면 다시 나오지 않는다). 세션이 살아 있는 AIRCRAFT의 `RESUME 필요`는 전처럼 그 세션에서 "계속"을 보낸다.
- 데스크톱·터미널에서 연 AIRCRAFT는 atc가 띄우지 않으니 세션이 없으면 후보가 아니다.

## 자동 승인(켜면): 조건을 갖춘 카드는 서버가 승인

설정 창 OPERATIONS의 "AUTO APPROVE"에 스위치 둘이 있고 **기본은 둘 다 off**다. 이 화면에서만 바꾸고(관제 세션은 못 바꾼다) `on`을 고르면 확인을 묻는다. `shadow`는 서버가 "승인했을 것"만 `auto-approve.jsonl`에 적는다. 먼저 shadow로 며칠 보고 켜기를 권한다.

- **ASSIGN·SCHEDULE**(`autoApprove`): 열린 SETTLED ASSIGN 카드(LAUNCH 아님)와 SCHEDULE 초안을 서버가 승인한다. CROSSCHECK는 은퇴해 mark를 보지 않는다. 카드에는 승인한 쪽이 `auto`로 남는다(`via auto`).
- **launch 카드**(`autoApproveLaunch`): LAUNCH 카드와 RESUME 카드를 승인하고 세션을 띄우기까지 서버가 한다. 상한(`ATC_MAX_LAUNCHED`)이 안 찼고, ACCOUNT가 FUEL hold가 아니고, LAUNCH가 막히지 않았고, 방금 LAUNCH가 실패한 AIRCRAFT가 아니고(30분 쉼), 하루 6번 안일 때만 한다.
- **그래도 SUPERVISOR 몫:** BLIND 표본(5장에 1장), HELD 카드, OCC가 주의를 단 카드, FUEL hold인 AIRCRAFT의 카드. 하루 상한(자동 승인 40건, 굴러가는 24시간)을 넘으면 그 카드는 기다린다.
- **센 숫자에서 빠진다:** 서버가 한 승인은 사람 판정이 아니라서 게이트(판정 20건에 80%)와 옛 CROSSCHECK 일치율에 들어가지 않는다.

## SCHEDULE·FLEET PLAN은 사람 없이 돈다(기본 on)

설정 창 OPERATIONS의 "SCHEDULE·FLEET PLAN AUTO"에 스위치 둘(SCHEDULE, FLEET PLAN)이 있고 **기본은 둘 다 on**이다. 끄는 것은 SUPERVISOR뿐이고 이 화면에서만 바뀐다(관제 세션은 못 바꾼다). 켜 두면 승인 줄에 사람이 누를 것이 없다.

- **SCHEDULE:** 서버가 열린 CLASSIFY·TAIL·CLOSE·WAYPOINT·NEW 초안을 사람 판정 없이 승인한다(`via auto`). 발부는 OCC가 전처럼 한다. NEW는 **Backlog**에 이슈를 만든다: 풀어서 Todo로 보내는 것은 SUPERVISOR 몫이다. PRIORITIZE, ROUTE, TARGET 변경은 제안으로 남는다. CLOSE는 승인되지만 Done은 여전히 Linear에서 직접 옮긴다.
- **FLEET PLAN:** 서버가 LAUNCH·STOP·RESTART·REFRESH·AOG 제안을 승인 단추와 같은 길로 실행한다. FUEL hold, `ATC_MAX_LAUNCHED`, 하루 상한(전체 40건, LAUNCH 계열 6번)을 지키고, 방금 건드린 AIRCRAFT는 쉰다. ENTRY·ACCOUNT CHANGE·REPOSITION·RETIRE·RETURN과 데스크톱 세션의 REFRESH는 제안으로 남는다.
- **오작동 세기:** 서버가 한 일을 사람이나 뒤 초안이 되돌리면 센다(라벨 되돌림, CLOSE 다시 열림, TAIL 바뀜, STOP 뒤 1시간 안 LAUNCH, 1시간 뒤에도 노는 LAUNCH, RESTART 반복). 하루별 개수는 `GET /api/autonomy/auto`에서 본다.
- 자세한 규칙은 docs/dispatch.md "Agreement-based approval as built (ATC-334)".

## CROSSCHECK는 은퇴했다(ATC-371)

CROSSCHECK 세션은 더 띄우지 않고, 서버의 어떤 규칙(자동 승인, ATFM 자동 대상, PREFLIGHT HOLD)도 CROSSCHECK mark를 기다리지 않는다. 새 mark는 받지 않는다(`POST …/crosscheck`는 410). 은퇴 전에 남은 mark는 기록으로 읽힌다: 옛 카드와 초안의 점선 칩, NETWORK의 GATES 줄(은퇴 — 옛 기록). 칩이 있는 옛 열린 SCHEDULE 초안에는 "CROSSCHECK에 동의" 단추가 남아 있다.
## JEV 판정 줄

- **JEV 일치**: 판정 계열 Jev가 CLASSIFY 초안에 낸 분류가 사람 판정과 맞은 비율. SCHEDULE 점검 패널은 2026-10-02에 없어져 화면에는 보이지 않고, 서버 기록(`GET /api/schedule/brief`의 `judges`)에만 남는다. 켜고 끄는 것은 설정 창 AGENTS 탭의 JUDGES다(설계: `docs/fleet.ko.md` 6.1).
- **JEV** 줄 셋(DISPATCH 점검 패널, 판정 계열이 켜져 있거나 mark가 있을 때): Jev가 열린 ASSIGN 제안마다 세 가지를 묻는다. 본문이 시작하기에 충분한가(Ready), 다른 일을 기다린다고 적혀 있나(Prerequisite), AIRCRAFT의 최근 atc FLIGHT와 얼마나 가까운가(Same area). 줄은 `Ready = no → 거절`, `Prerequisite = yes → 선행 대기`(`waiting-on-prior` 칩이나 OCC HOLD), `Same area 가까움 → 승인`이 사람 결과와 맞은 건수다. 참고용이고 점수·HOLD·상태에는 영향이 없다. mark는 RECENT의 `JEV` 칩(툴팁에 세 답)으로 닫힌 제안에만 보이고, 열린 카드에는 보이지 않는다. 쓸지는 판정한 제안이 20건 넘은 뒤 SUPERVISOR가 정한다(설계: `docs/fleet.ko.md` 6.1).
- **JEV REPORT**(FLEET 줄의 칩, AIRCRAFT 카드의 줄, FLEET PLAN 패널 위쪽 줄): AIRCRAFT의 턴이 끝날 때 Jev가 CAPTAIN의 마지막 메시지를 `reported done`·`asks for a decision`·`stopped mid-work`·`idle and ready`·`can't tell`로 분류한다(atc 저장소 AIRCRAFT만, 경로·URL을 가려서 최대 1,500자). 카드의 **맞음 / 틀림**으로 분류가 맞았는지 표시하면 패널에 `JEV REPORT 맞음 m/n`이 센다. 결정이 필요하다는 확률이 70% 이상이면 FLIGHT FOLLOWING에 항목이 하나 붙는다. 참고용이고 health 코드·DISPATCH·FLEET PLAN에는 영향이 없다(설계: `docs/fleet.ko.md` 8.8).

## 얼마나 자주

하루 몇 번, 새 카드가 있을 때 판정하면 충분하다. 판정이 쌓이는 속도가 곧 다음 단계로 가는 속도다.
