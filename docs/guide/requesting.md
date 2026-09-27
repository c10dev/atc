# 일 맡기기

일의 크기에 따라 두 길이 있다.

| 상황 | 방법 | 화면 |
|---|---|---|
| 작은 수정 (5줄 이하, 문서, 의존성) | 팀 세션에 직접 맡긴다. 티켓 없이 PR 본문의 "Explicit user task"에 요청을 적는다 | STRIPS에 **AD HOC** |
| 티켓이 필요한 일 (기능, 컴포넌트, 화면 수정 …) | OCC 세션에 말한다(**CHARTER REQUEST**) | SCHEDULE 탭에 **AD HOC FLIGHT** 초안 |

## CHARTER DESK: OCC에 요청하기

OCC 세션이 요청 창구(CHARTER DESK)다. 운항표(Linear)에 없는 일을 받아 티켓 초안으로 만든다.

```
CHARTER REQUEST ─▶ AD HOC FLIGHT 초안 ─▶ FILED ─▶ ASSIGN ─▶ ENROUTE ─▶ ARRIVED
 (OCC에 말하기)     (SCHEDULE 탭 판정)    (Linear Todo)  (DISPATCH)  (팀 작업)   (머지)
```

1. OCC 세션에 무엇을 원하는지 말한다. 예: "홈 화면에 추천 곡 카드 컴포넌트 만들어 줘. Song Experience 쪽."
2. OCC가 SCHEDULE `NEW` 초안을 쓴다. 제목, 프로젝트, vocado 템플릿 본문(목표·수정 허용 범위·금지 사항·완료 기준, 보안 작업이면 Codex Engineering Task), type·wake·rating, 맞는 팀이 분명하면 `tail:`, 그리고 비슷한 티켓 목록.
3. SCHEDULE 탭에서 판정한다([판정하기](reviewing.md)).
4. **지금은 S1(그림자 운용)이라 Linear에 실제로 만들지 않는다.** 필요하면 카드의 제목·본문·라벨로 Linear에 직접 만든다. S2부터는 승인한 초안을 OCC가 Linear에 쓴다.

OCC는 사용자가 요청했을 때만 새 티켓 초안을 쓴다. 스스로 티켓을 지어내지 않는다.

일이 끝난 뒤 Linear 정리도 OCC가 돕는다: PR이 머지됐는데(LOGBOOK에 ARRIVED) 이슈가 열려 있으면 `CLOSE` 초안을 쓴다. 이슈 상태는 사용자가 Linear에서 직접 Done으로 바꾼다([판정하기](reviewing.md)). 팀 PR 본문에 `Fixes VOC-n`을 쓰게 하면(일부만이면 `Part of VOC-n`) CLOSE 후보가 정확해진다.

## 팀에 직접 맡길 때

- 누구에게 맡길지는 FLEET 탭에서 고른다: 필요한 TYPE RATING을 갖고, 가능하면 ROUTE(담당 프로젝트)가 맞고, PARKED인 팀.
- 티켓이 있는 일이면 CAPTAIN이 Linear를 In Progress로 바꾼다(Linear에는 CAPTAIN만 쓴다).
- 사람이 직접 준 배정이 DISPATCH 제안보다 우선한다. 팀이 STAND를 잡으면 같은 FLIGHT의 제안은 물러난다.

## 특정 팀에 묶어 두기: TAIL ASSIGNMENT

티켓에 Linear 라벨 `tail:TEAM_X`를 붙이면 DISPATCH가 그 팀에만 제안한다. 그 팀이 바쁘면 다른 팀에 주지 않고 기다린다. 새 팀이면 라벨을 먼저 만들어야 한다.
