# ROUTE MAP 설계 (WAYPOINT)

[English](routes.md) · **한국어**

ROUTE MAP은 ROUTE(Linear 프로젝트)마다 WAYPOINT(Linear 프로젝트 마일스톤)를 잇는 경로를 보여 준다. 어느 WAYPOINT를 지났는지, 지금 어느 구간인지, 그 구간을 어떤 FLIGHT가 날고 있는지, 다음 WAYPOINT에 언제쯤 닿을지를 한눈에 본다. NETWORK 탭의 ROUTES 표 위에 있다.

> Status (2026-09-27): "구현 순서"의 1~4단계가 만들어졌다(ATC-2). 읽기 전용 WAYPOINT 데이터, `GET /api/routes`, NETWORK의 ROUTE MAP, ETA다. 10단계도 만들어졌다(ATC-8). 덮는 이슈가 없는 완료 기준을 OCC가 NEW 초안으로 올린다. 5~9단계는 아직 없다.

관련: [fleet.ko.md](fleet.ko.md) 7.3(NETWORK), `server/network.ts`(ROUTES 표), `server/sources/linear-projects.ts`(Linear 프로젝트와 마일스톤), `server/routes.ts`(이 설계), `server/following.ts`(FLIGHT를 모는 AIRCRAFT).

## 1. 현재 사실 (Current facts)

2026-09-27에 운영 중인 atc(`/api/network`, `/api/logbook`)와 Linear에서 읽기만 해서 모았다.

| 영역 | 수치 | ROUTE MAP에 주는 뜻 |
|---|---|---|
| vocado 마일스톤 | 열린 vocado 프로젝트 7개 중 4개가 마일스톤을 쓴다(마일스톤 14개). Song Catalog & Publication은 Foundation, Read Model, First Real Song, Web Surface가 100%이고 Beta Ready가 0%(`next`)다. Song Experience는 Differentiated Listening Experience v1이 83%다. Lyrics Canonical Data는 M1~M6이고 M2가 done이다 | 마일스톤은 SUPERVISOR가 이미 쓰는 계획이다. atc는 읽기만 하면 된다 |
| 마일스톤 순서 | Linear `sortOrder`는 프로젝트 쪽에 보이는 순서이고, 끝난 순서가 아니다. Beta Ready(`next`)가 Web Surface(`done`)보다 앞에 있다 | "지남"은 자리가 아니라 WAYPOINT마다의 상태로 정한다 |
| 마일스톤 필드 | `name`, `description`, `targetDate`, `progress`(0~100), `sortOrder`, `status`(`done`, `next`, `overdue`, `unstarted`), `issues`. vocado 마일스톤에는 아직 목표일이 없다 | 진행률과 상태는 Linear 값을 그대로 쓴다. 목표일은 있을 수도 없을 수도 있다 |
| 완료 기준 | 마일스톤 설명에 "Exit criteria:" 제목과 번호 목록이 있다 | 새 약속 없이 목록을 뽑을 수 있다 |
| atc 팀 | 새 Linear 팀 `ATC`에 프로젝트 "atc"와 M15~M20이 있다(M15 "Linear teams and ROUTE MAP" … M20 "Network planning"). 설명마다 완료 기준 목록이 있다 | ATC-1부터 atc는 여러 팀(`LINEAR_TEAM_KEYS`)을 읽지만, 프로젝트와 마일스톤은 아직 주 팀(`LINEAR_TEAM_KEY`)만 읽는다. 팀 목록을 따르면(5단계) atc의 계획도 ROUTE로 보인다 |
| 쿼리 비용 | 프로젝트 → 마일스톤 → 이슈를 한 번에 물으면 Linear가 거절한다(복잡도 10,000 초과). 루트 `projectMilestones`로 마일스톤 50개 × 이슈 50개는 통과한다 | 마일스톤은 따로, 쪽 단위로 읽는다 |
| LOGBOOK 귀속 | LOGBOOK 82건 중 FLIGHT key가 있는 것은 18건 | LOGBOOK만으로 ROUTE별 속도를 내기엔 얇다. Linear 완료 시각으로 메운다 |
| 지금의 NETWORK | ROUTE 7개. Beta Readiness가 가장 바쁘고(열린 FLIGHT 13, 14일 ARRIVED 12) 마일스톤이 없다 | 여러 ROUTE가 들어가야 하고, 대부분 WAYPOINT가 몇 개뿐이다 |

## 2. 원칙 (Principles)

1. **읽기만 한다.** atc는 마일스톤을 읽고, 만들거나 옮기거나 고치지 않는다. 계획은 SUPERVISOR가 Linear에서 세운다.
2. **지났는지는 Linear가 정한다.** Linear가 `done`이라 하면 지난 WAYPOINT다. atc가 진행률을 다시 판단하지 않는다.
3. **계산은 한 곳에서.** WAYPOINT 상태, FLIGHT 수, 완료 기준, ETA는 `server/routes.ts`의 순수 함수이고 `node:test`로 시험한다. 화면은 그리기만 한다.
4. **모름도 답이다.** 완료가 너무 적거나, FLIGHT가 없거나, 목록이 잘렸으면 ETA는 "모름"이다. 짐작하지 않는다.
5. **이슈 쿼리는 건드리지 않는다.** `server/sources/linear.ts`(FLIGHT 보드)는 그대로 두고, WAYPOINT 소속은 마일스톤 쪽에서 읽는다.

## 3. 데이터

`server/sources/linear-projects.ts`의 프로젝트 쿼리 옆에 두 번째 쿼리를 둔다. 10분 캐시와 팀(`LINEAR_TEAM_KEY`)을 함께 쓴다.

```graphql
projectMilestones(first: 50, after: $after, filter: { project: { accessibleTeams: { some: { key: { eq: $team } } } } }) {
  pageInfo { hasNextPage endCursor }
  nodes { id name description targetDate progress sortOrder status project { name }
    issues(first: 50) { pageInfo { hasNextPage } nodes { identifier title state { name type } completedAt } } }
}
```

쪽은 10쪽(마일스톤 500개)까지 따라간다. 이슈가 50개를 넘는 마일스톤은 `truncated`로 표시한다. 마일스톤 쿼리가 실패해도 프로젝트는 읽히고, ROUTE MAP은 마일스톤을 못 읽었다고 알린다.

## 4. `GET /api/routes`

```json
{
  "at": "…",
  "ok": true,
  "milestones": true,
  "error": null,
  "windowDays": 28,
  "routes": [{
    "project": "Song Experience",
    "state": "started",
    "progress": 0.80,
    "targetDate": null,
    "open": { "active": 4, "blocked": 0, "planned": 3 },
    "aircraft": ["TEAM_F"],
    "rate": { "completed": 6, "perWeek": 1.5 },
    "waypoints": [{
      "id": "…", "name": "Differentiated Listening Experience v1",
      "state": "active", "linearStatus": "next", "progress": 0.83, "targetDate": null,
      "criteria": ["Material UI PRs expose …", "…"],
      "flights": [{ "key": "VOC-137", "title": "…", "phase": "done", "aircraft": null, "url": "…" }],
      "counts": { "done": 5, "active": 1, "blocked": 0, "planned": 1 },
      "truncated": false,
      "late": false,
      "eta": { "at": "2026-10-04", "remaining": 2, "cumulative": 2, "reason": null }
    }]
  }]
}
```

- **ROUTE**: 상태가 `completed`·`canceled`가 아닌 Linear 프로젝트 전부, 그리고 보드에 열린 FLIGHT가 있는 프로젝트. WAYPOINT가 있는 ROUTE가 먼저, 없는 ROUTE(`waypoints: []`)가 뒤에 온다. 각 무리 안에서는 ROUTES 표처럼 바쁜(열린 FLIGHT가 많은) 순, 같으면 이름순이다.
- **ROUTE의 `open`과 `aircraft`**: FLIGHT 보드에서 그 프로젝트의 열린 FLIGHT를 단계별로 센 수(ROUTES 표처럼 상위 이슈는 뺀다)와 그 FLIGHT를 모는 AIRCRAFT. WAYPOINT가 있든 없든 모든 ROUTE에 있다.
- **WAYPOINT 상태**: Linear status가 `done`이면 `passed`. 나머지 중 `sortOrder`로 첫 것이 `active`, 그 밖은 `planned`다. Linear의 `overdue`는 `linearStatus`와 "지연"으로 보인다.
- **FLIGHT 단계**: `done`(completed), `blocked`(열려 있고 FLIGHT 보드에서 열린 `blockedBy`가 있음), `active`(started), `planned`(그 밖의 열린 상태). canceled와 duplicate는 뺀다.
- **AIRCRAFT**: FOLLOWING(`targetsOf`)과 같은 규칙. ASSIGN 제안의 AIRCRAFT, 없으면 첫 `tail:` 라벨.
- **완료 기준**: 설명에 "exit criteria"나 "완료 기준"이 든 제목 줄이 있으면 그 아래 다음 제목까지의 번호 항목(`1.` 또는 `1)`). 없으면 설명 전체의 번호 항목. 항목마다 첫 줄만, Markdown 강조는 벗긴다.

## 5. ETA

- **속도**: 최근 28일에 끝난 그 ROUTE의 FLIGHT 수(중복 없이). LOGBOOK에 창 안의 ARRIVED가 있거나, WAYPOINT FLIGHT의 Linear `completedAt`이 창 안이면 센다. `perWeek = completed / 4`.
- **남은 FLIGHT**: WAYPOINT의 열린 FLIGHT(진행·막힘·계획). ROUTE는 순서대로 가므로, WAYPOINT의 ETA는 그 앞의 지나지 않은 WAYPOINT들의 남은 FLIGHT도 더한다. `eta = now + 누적 남은 FLIGHT / 하루 속도`.
- **모름**: 창 안 완료가 3개 미만(`reason: "few-samples"`), 지나지 않았는데 열린 FLIGHT가 없음(`"no-flights"`), 목록이 잘림(`"truncated"`).
- **지연**: 목표일이 ETA보다 앞이거나, 지나지 않았는데 목표일이 이미 지났다. 지난 WAYPOINT는 ETA가 없다.

## 6. 화면

ROUTE마다 한 줄: ROUTE 이름, 진행률, 그다음 가로 SVG 경로. WAYPOINT 없는 ROUTE는 "WAYPOINT 없음" 표시가 붙은 점선 하나로, 열린 FLIGHT 수(진행·계획·막힘)와 모는 AIRCRAFT를 보인다. 이 줄들은 WAYPOINT가 있는 ROUTE 뒤에 온다.

- 지난 WAYPOINT ●, 지금 구간 ◉과 진행률, 앞으로 ○. 지금 구간으로 들어가는 선은 진행률만큼 실선, 나머지는 점선이다.
- 지금 구간 위: 그 WAYPOINT의 FLIGHT를 모는 AIRCRAFT마다 ✈와 REGISTRATION(셋까지, 넘으면 "+n").
- WAYPOINT는 버튼이다(Tab, Enter, Space). 열면 목표일, ETA와 지연 표시, 완료 기준, 단계별 FLIGHT 목록과 AIRCRAFT가 보인다.
- 좁은 화면(390px)에서는 WAYPOINT 간격을 지킨 채 경로가 자기 상자 안에서 가로로 넘어간다. 쪽 전체는 가로로 넘치지 않는다. WAYPOINT 이름은 줄여서 보이고 전체는 자세히에 있다.
- 색은 `:root` 토큰만: 지남 `--radar`, 지금 구간 `--cyan`, 앞으로 `--faint`, 지연 `--amber`, 막힘 `--alert`. 지금 구간의 ✈와 FLIGHT 목록의 ✈는 `--radar`.

## 7. 구현 순서 (Implementation order)

1. `linear-projects.ts`에서 마일스톤 읽기(만듦).
2. `server/routes.ts` 순수 함수와 `GET /api/routes`(만듦).
3. NETWORK 탭의 ROUTE MAP(만듦).
4. ROUTE 완료 속도로 ETA, 지연 표시(만듦).
5. `LINEAR_TEAM_KEYS`(ATC-1)의 모든 팀에서 프로젝트와 마일스톤 읽기. `ATC` ROUTE가 vocado ROUTE 옆에 보인다. 아직 없음.
6. atc 게이트를 WAYPOINT에 잇기: 판정 게이트, 2b 점검표, ATFM 켜기 조건을 M15~M20의 완료 기준으로 보인다. 아직 없음.
7. OCC 브리핑: ETA와 지연 경고(만듦, ATC-24). `schedule brief`에 `waypointEtas`와 `slips`가 더해진다(`server/waypoint-slips.ts`). OCC는 새 지연 경고를 SUPERVISOR에게 한 번 보고하고 ack하며, SCHEDULE 탭 LATE WAYPOINTS에 보인다(docs/occ.ko.md 5.7).
8. DISPATCH: 지금 구간 WAYPOINT의 FLIGHT에 점수를 더 준다. 아직 없음.
9. SCHEDULE: WAYPOINT가 없는 ROUTE의 FLIGHT에 "마일스톤 지정" 초안. 아직 없음.
10. SCHEDULE: WAYPOINT gap(만듦, ATC-8). `schedule brief`에 `waypointGaps`가 더해진다(`server/waypoint-gaps.ts`). ROUTE마다 지금 구간과 그다음 WAYPOINT의 완료 기준(번호 목록이 없으면 설명)과 이슈를 함께 보인다. 기준과 이슈를 짝짓는 것은 서버가 아니라 OCC가 판단하고, 덮는 이슈가 없는 기준을 `NEW --gap --milestone <WAYPOINT>`로 바퀴마다 2건까지 올린다(docs/occ.ko.md 5.6). `NEW`는 그 프로젝트의 마일스톤을 가질 수 있고, S2 발부 호출에 그 id가 들어간다.

## 8. 위험 (Risks)

| 위험 | 대응 |
|---|---|
| 마일스톤 순서가 끝난 순서와 다르다 | 상태는 Linear status로 정한다. 순서는 지금 구간을 고를 때만 쓴다 |
| 적은 FLIGHT로 낸 속도는 크게 흔들린다 | 완료 3개 미만이면 모름. 창은 28일 |
| 뒤 WAYPOINT의 FLIGHT가 먼저 끝난다 | 자기 WAYPOINT에서 완료로 세고 속도에도 들어간다. ETA는 남은 일만 센다 |
| 마일스톤이 늘면 쿼리 비용이 는다 | 따로 둔 쪽 단위 쿼리, 10분 캐시, 마일스톤마다 이슈 50개와 잘림 표시 |
| 완료 기준을 다르게 쓴다 | 설명 전체의 번호 항목으로 물러선다. 목록이 없으면 기준이 없을 뿐 오류가 아니다 |

## 9. 아직 없는 것 (Not built yet)

- 주 팀만이 아니라 `LINEAR_TEAM_KEYS`의 모든 팀에서 프로젝트와 마일스톤 읽기(5단계).
- atc 게이트와 WAYPOINT 잇기(6단계), DISPATCH WAYPOINT 점수(8단계), SCHEDULE "마일스톤 지정" 초안(9단계).
- WAYPOINT 없는 ROUTE에 대한 OCC 알림(API는 이미 `waypoints: []`로 남긴다).

## 결정 (Decisions) (2026-09-27, TEAM_J와 structure)

1. `GET /api/routes`는 새 엔드포인트다. `/api/network`는 그대로다.
2. 지금 구간 WAYPOINT는 `sortOrder`로 첫 미완료(Linear의 `next`)다. `overdue`는 지연으로 보인다.
3. 속도는 LOGBOOK ARRIVED와 Linear `completedAt`을 합친다. LOGBOOK 82건 중 FLIGHT가 있는 것이 18건뿐이라서다.
4. ETA는 ROUTE를 따라 누적한다.
5. WAYPOINT 없는 ROUTE도 지도와 API(`waypoints: []`)에 남긴다. 다른 ROUTE 뒤에, 열린 FLIGHT와 AIRCRAFT와 함께 둔다. 가장 바쁜 Beta Readiness에 마일스톤이 없어서, 숨기면 가장 중요한 경로가 빠진다. 나중에 OCC의 "WAYPOINT 없는 ROUTE" 알림이 이것을 근거로 삼을 수 있다.
