# 팀 운영 (FLEET)

FLEET 탭에서 팀(AIRCRAFT)을 꾸리고, 쉬게 하고, 퇴역시킨다. 팀 정보는 `~/.local/state/atc/fleet.json`에 저장되고 DISPATCH planner가 쓴다.

## 팀 프로필

| 항목 | 뜻 | planner가 쓰는 법 |
|---|---|---|
| CREW COMPLEMENT | 기본 팀원 구성과 모델 | 그 구성이 할 수 없는 종류의 일은 주지 않음(예: flash-helper만 있으면 BUILD 없음) |
| TYPE RATING | 맡을 수 있는 일: SEC · UI · DATA · DOCS | 필요한 자격을 모두 가진 팀에만 제안 |
| ROUTE | 주 담당 Linear 프로젝트 | 담당이면 점수 +1 |
| TARGETS | 주간 FLIGHT 수, 정시성 | 표시만(점수에 안 씀). 실적은 LOGBOOK으로 센다(아래) |

정하지 않은 항목은 vocado 팀원 규칙에서 온 기본값을 따른다. SEC는 보안 작업을 맡을 팀원이 있어야 줄 수 있다.

## LOGBOOK과 실적

LOGBOOK은 AIRCRAFT가 끝낸(ARRIVED) FLIGHT의 기록이다. atc가 10분마다 GitHub에서 머지된 PR을 읽어 `~/.local/state/atc/logbook.jsonl`에 한 줄씩 적는다. 사람이 적을 것은 없다.

- **누구 몫인가**: 그 PR의 STAND(워크트리)를 점유했던 `TEAM_X` 세션. 여러 팀이 거쳤으면 마지막까지 만진 팀. 알 수 없으면 비워 두고(카드에 안 보임) 기록은 남긴다.
- **block time(팀 소요 시간)**: 그 STAND를 처음 점유한 시각부터 PR을 연 시각까지. 밤도 포함한 벽시계 시간이다. 점유가 PR보다 늦게 잡혔으면 착수 시각을 모르므로 `—`로 두고 정시율에서 뺀다.
- **착륙 대기**: PR을 연 시각부터 머지까지(리뷰·머지를 기다린 시간). 팀 속도와 섞이지 않게 따로 보여 주고 정시율에는 넣지 않는다.
- **되돌림**: `Revert "…"` PR이 머지되면 원래 FLIGHT에 REVERTED가 붙는다.

카드의 TARGETS 아래에 실적이 나온다.

| 줄 | 뜻 |
|---|---|
| 이번 주 3/3 | 이번 주(월요일 0시부터) ARRIVED 수 / 목표. 목표보다 적으면 노란색 |
| 정시 67% (목표 80%) | 최근 14일 FLIGHT 중 팀 소요 시간이 기대치 안인 비율. 목표보다 낮으면 노란색 |
| 14일 ARRIVED · 되돌림 · LOS | 최근 14일 합계. 되돌림과 LOS가 있으면 빨간색 |
| 착륙 대기 중앙값 5h | 최근 14일 FLIGHT의 착륙 대기 중앙값 |
| 최근 FLIGHT | 5건: FLIGHT(AD HOC), PR 번호, 팀 소요 시간(모르면 `—`), `+`착륙 대기, ON TIME / DELAYED, REVERTED, LOS, 날짜. FLIGHT를 누르면 PR이 열린다 |

기대 block time은 `wake` 라벨이 있으면 L 60분 · M 4시간 · H 2일이다. 라벨이 없거나 J거나 AD HOC이면 같은 FLIGHT TYPE·WAKE로 끝난 다른 FLIGHT(3건 이상)의 중앙값과 비교하고, 모자라면 정시율에서 뺀다. 실적은 보여 주기만 하고 배정 점수에는 쓰지 않는다.

## 관측 CREW와 drift

카드의 OBSERVED CREW는 선언한 CREW COMPLEMENT 옆에 최근 14일 동안 실제로 본 팀원을 보여 준다. 그 등록번호 이름의 세션(지금 살아 있는 세션과 이름이 같았던 지난 세션)이 부른 서브에이전트를 agent type·모델별로 묶어, 부른 횟수와 마지막 시각을 적는다.

atc는 세션 메타데이터만 읽는다: 서브에이전트의 agent type, 부를 때 준 모델, 파일 시각, 세션 이름. 대화 기록, 지시문, 작업 설명은 읽지 않는다.

관측한 팀원은 선언한 POSITION에 이렇게 맞춘다.

| 관측 | POSITION |
|---|---|
| `ui-builder`, `ui-qa`, `flash-helper`처럼 선언한 POSITION이나 agent와 이름이 같은 타입 | 그 POSITION |
| `general-purpose`·`claude` + Opus 모델 | `backend`(agent에 opus가 든 팀원) |
| `general-purpose`·`claude` + 모델 지정 없음 | `backend`로 본다. CAPTAIN의 모델(Opus)을 물려받기 때문이다. 실제 모델은 보이지 않아 모델 칸은 비어 있다 |
| `Explore`, `Plan`, `claude-code-guide` 같은 내장 타입, 그 밖의 타입 | 맞추지 않음. 선언에 agent로 적으면 맞춘다 |

drift 두 줄의 뜻:

- **선언에 없음: Explore** — 불렀지만 선언에 없는 타입. 모델을 줬으면 `general-purpose (sonnet)`처럼 붙는다. 자주 쓰면 COMPLEMENT에 넣을지 정한다.
- **최근 14일 안 씀: flash-helper** — 선언했지만 기간 안에 부르지 않은 POSITION. 잘못이 아니라 "안 보였다"는 뜻이다. Codex 리뷰(`security` 구성의 reviewer)처럼 서브에이전트로 부르지 않는 POSITION은 늘 여기에 뜬다.

이름이 같은 세션이 없으면 관측 CREW는 나오지 않는다. agent team처럼 팀원이 따로 세션으로 도는 경우 그 팀원은 보이지 않는다(CAPTAIN이 Agent로 부른 팀원은 보인다).

## CREW CHANGE

운항 중인 AIRCRAFT(퇴역하지 않았고 그 이름의 세션이 살아 있음)의 CREW COMPLEMENT를 바꿔 저장하면, atc가 CAPTAIN에게 줄 **CREW CHANGE** 지시문을 만든다. 카드에 **CREW CHANGE 대기**로 나온다.

- 내리고(−) 타는(+) 팀원과 모델, 그리고 TYPE RATING 영향이 보인다. 예: 유일한 구현 팀원을 내리면 "BUILD·MAINT·TEST를 더는 날 수 없음", 판정할 팀원이 없으면 "CHECK를 더는 날 수 없음".
- 지시문은 `[ATC FLEET] CREW CHANGE · HOTEL (TEAM_H) · CC-0001`로 시작하고, 팀원을 멈추거나 그 모델로 만드는 법을 적은 뒤 `"TEAM_H CREW CHANGE CC-0001 COMPLETE"` 한 줄로 답하라고 끝난다.
- **직접 전달(2a·2b 모두)**: **복사**를 눌러 그 팀의 CAPTAIN 세션에 붙여 넣고 **전달함**을 누른다. 대기 카드가 사라지고 기록에 전달 시각이 남는다.
- **OCC가 보냄(2b, DISPATCH가 approval 모드일 때만)**: 카드의 **승인**을 누르면 OCC가 다음 바퀴에 `[OCC CC-0001] CREW CHANGE · HOTEL (TEAM_H)`로 시작하는 문구를 CAPTAIN에게 보낸다([교신 규칙](radio.md)). 승인은 SUPERVISOR만 한다. shadow 모드에서는 승인 버튼이 없다(서버도 409로 거절).
  - 카드 머리: **CREW CHANGE 대기**(pending) → **CREW CHANGE 승인됨 — OCC 발부 대기**(approved) → **CREW CHANGE SENT — READBACK 대기**(sent, 보낸 본문 그대로 보임) → CAPTAIN이 `READBACK CC-0001`로 답하면 카드가 사라진다(acknowledged).
  - 보낸 뒤 10분 넘게 READBACK이 없으면 카드에 늦음 경고가 뜬다. OCC가 같은 문구를 한 번 더 보내고, 그래도 없으면 SUPERVISOR에게 보고한다.
  - 승인한 뒤에도 보내기 전이면 **전달함**으로 직접 닫을 수 있다(shadow로 되돌렸을 때도). 보낸(sent) 건은 전달함으로 닫지 않는다 — READBACK을 기다린다.
- 보내기 전(승인 대기·승인됨)에 또 바꾸면 처음 구성 기준으로 합친 새 지시문(`CC-0002`)이 앞의 것을 대신한다. 승인됐던 것이면 새 지시문을 다시 승인한다. 원래 구성으로 되돌리면 대기 건만 닫힌다.
- 이미 보낸(sent) 건은 대신하지 않는다. 새 지시문은 그 다음 변경으로 따로 생기고, 승인해 두어도 앞 건의 READBACK이 온 뒤에 나간다(카드에 기다리는 CC 번호가 보인다).
- 아직 운항 전인 AIRCRAFT는 CREW CHANGE 없이 CREW BRIEFING에 새 구성이 들어간다.

기록은 `~/.local/state/atc/crew-changes.jsonl`에 추가만 한다. 2b를 켜기 전에 DISPATCH 탭 "2b 켜기 점검표"의 **CREW CHANGE 발부**와 **vocado READBACK 규칙**(`[OCC CC-xxxx]` → `READBACK CC-xxxx`까지)을 확인한다.

## 새 팀 들이기

1. **ENTRY INTO SERVICE**를 누른다. 다음 빈 등록번호(`TEAM_G` …)와 AIRPORT가 채워진다.
2. **CONFIGURATION**(팀 구성 템플릿)을 고른다.

   | 템플릿 | 팀원 | 자격 |
   |---|---|---|
   | 일반 | 기본값(Opus, ui-builder, ui-qa, flash-helper) | UI · DATA · DOCS |
   | 보안·DB | Opus + Codex 리뷰 | SEC · DATA · DOCS |
   | UI | Opus + ui-builder + ui-qa | UI · DOCS |
   | 리서치·문서 | Opus + flash-helper | DATA · DOCS |

3. 카드의 **LAUNCH**를 누른다. atc가 그 AIRPORT 저장소에서 등록번호 이름의 백그라운드 세션을 띄우고 CREW BRIEFING을 첫 지시로 넣는다(아래 "세션 띄우고 멈추기").
   - 손으로 열고 싶으면 **CREW BRIEFING**을 복사해, 그 저장소에서 새 세션을 열고 이름을 등록번호로 붙인 뒤 붙여 넣는다.
4. 세션이 뜨면 atc가 이름으로 알아보고 NOT IN SERVICE → IN SERVICE가 된다.

Linear에 `tail:TEAM_G` 라벨이 없으면 먼저 만든다.

## 세션 띄우고 멈추기: LAUNCH · STOP

atc가 AIRCRAFT 세션을 직접 띄우고 멈춘다(2026-09-28부터). Claude Code 백그라운드 세션(`claude --bg`)이다.

- **LAUNCH**: 세션이 없는 카드에 보인다. permission mode(`auto` 기본, `acceptEdits`, `default`)와 모델(비우면 기본값)을 고르고 누른다. 세션은 base AIRPORT 저장소에서 뜨고, 이름은 등록번호, 첫 지시는 CREW BRIEFING이다. 곧 카드에 `BG <id>`가 붙는다.
- **STOP**: atc가 띄운 백그라운드 세션에만 보인다. 멈춰도 대화는 남는다. 터미널에서 `claude attach <id>`로 들여다보거나 `claude --resume`으로 다시 연다.
- **퇴역**: 백그라운드 세션을 모는 AIRCRAFT를 퇴역시키면 세션도 멈출지 묻는다.
- 데스크톱·터미널에서 직접 연 세션은 atc가 멈추지 않는다. 그 창에서 닫는다.
- 막히는 경우: 이미 같은 이름의 세션이 있음, 백그라운드 세션이 상한(기본 6, `ATC_MAX_LAUNCHED`)에 닿음, RETIRED, base AIRPORT 없음, 그 저장소를 Claude Code가 신뢰하지 않음(그 저장소에서 `claude`를 한 번 열어 trust를 수락한다).
- 띄운 세션은 사용량 한도를 쓴다. atc의 비밀(`.env.local`)은 세션에 넘기지 않는다. `bypassPermissions`는 고를 수 없다.
- 관제 세션(TOWER·OCC·CROSSCHECK·REVIEW)은 세션을 띄우거나 멈출 수 없다. 이 화면에서 보낸 요청만 받는다.
- LAUNCH·STOP은 모두 FLIGHT RECORDER에 남는다.

## CHECKRIDE: TYPE RATING 근거와 추천

FLEET 탭 카드 아래의 CHECKRIDE는 팀마다, TYPE RATING(SEC · UI · DATA · DOCS)마다 LOGBOOK에서 근거를 모아 보여 준다. 추천만 하고, rating은 SUPERVISOR가 버튼을 누를 때만 바뀐다.

**근거가 되는 FLIGHT**: 그 팀이 몰아 ARRIVED한 FLIGHT 중 그 rating이 필요했던 것. rating은 이 순서로 정한다.

1. Linear 라벨(`rating:SEC` 등, Risk 그룹은 SEC) — 근거에 "라벨"
2. SUPERVISOR가 받아들인(agree·approve) SCHEDULE CLASSIFY 초안의 rating — 근거에 "SCHEDULE S-0003"
3. 둘 다 없으면 근거로 세지 않는다. AD HOC도 세지 않는다.

**추천**(처음 제안값, 운용하며 조정):

| 표시 | 뜻 | 버튼 |
|---|---|---|
| 부여 추천 | 가지지 않은 rating인데 최근 30일 그 rating FLIGHT 3건 이상, 되돌림 0, Codex 지적 라운드 평균 3 미만 | 부여 |
| 재검토 추천 | 가진 rating인데 최근 14일 그 rating FLIGHT에서 되돌림이 났거나, 2건 이상의 지적 라운드 평균이 3 이상 | 회수 |
| 추천 안 함 | 근거는 충분하지만 SEC를 맡을 CREW가 없음(flash-helper만). 이유가 보인다 | — |
| 근거 쌓는 중 | 근거가 아직 모자람(예: 근거 1/3) | — |
| 보유 | 가진 rating, 문제 없음 | — |

근거 N건을 펼치면 FLIGHT, PR, 출처, Codex 지적 라운드, REVERTED가 보인다. **부여**·**회수**는 확인 창을 거쳐 팀 프로필의 TYPE RATING을 바꾸고(고치기 화면과 같은 규칙), 누가 무엇을 근거로 했는지 FLIGHT RECORDER에 남는다. 자동으로 부여하거나 회수하지 않는다.

## 쉬게 하기와 퇴역

- **AOG**: 사유와 해제 예정일을 남기고 잠시 배정을 멈춘다. DISPATCH에 "AOG — 사유"로 보인다.
- **RETIREMENT**: 목록과 계획에서 뺀다. RETIRED 목록에 남고 복귀할 수 있다. 살아 있는 세션을 닫지는 않는다.

## 이름

`TEAM_X`는 REGISTRATION으로 그대로 둔다. vocado 규칙, `tail:` 라벨, planner가 모두 이 이름에 걸려 있다. atc의 말로 팀은 CAPTAIN이 이끄는 CREW가 모는 AIRCRAFT다.
