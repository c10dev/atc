# 판정하기

atc의 자동화는 **그림자 운용**에서 시작한다. 제안과 초안을 만들어 화면에만 보이고, 사용자가 "승인했을 것 / 거절했을 것"을 표시해 품질을 잰다. 기준(20건, 합의율 80%)이 차면 다음 단계로 간다.

## DISPATCH 탭: 배정 제안

5분마다 atc가 "어떤 FLIGHT를 어떤 AIRCRAFT에" 계획하고, OCC가 제안마다 티켓 본문을 읽어 BRIEFING·메모·CAUTION·HOLD를 단다. 티켓 내용을 기억하지 못해도 카드만 보고 판정할 수 있게 위에서 아래로 읽는다.

| 카드에서 볼 것 | 뜻 |
|---|---|
| BRIEFING(맨 위 세 줄) | OCC가 쓴 쉬운 한국어 세 줄. **무슨 일**(끝나면 무엇이 달라지나), **왜 이 AIRCRAFT**(기지·TYPE RATING·같은 ROUTE 최근 FLIGHT), **걸리는 점**(선행·위험·사람이 정할 것) |
| `BRIEFING 대기` | OCC가 아직 세 줄을 쓰지 않았다. 대신 제목과 본문 첫 문장이 보인다. 다음 tick에 채워진다 |
| 사실 줄 | 서버가 계산한 것(모델 없음): PRIORITY, 대기 일수, ROUTE와 WAYPOINT("Beta Ready WAYPOINT(지금 구간) · 남은 3건 중 하나"), 선행 FLIGHT와 상태(끝났으면 초록 ✓, 아니면 주황), 그 AIRCRAFT가 같은 ROUTE에서 최근 맡은 FLIGHT, TRIP FUEL(비슷한 FLIGHT가 든 NET FUEL COST의 p50–p90과 어느 단계로 묶었는지: `TRIP FUEL $5.28–$15.6 · TYPE×WAKE BUILD·M (6)`, 모자라면 `TRIP FUEL —`), 그 AIRCRAFT가 캐시가 식은 채 HOLDING이면 COLD CACHE 경고(주황). TRIP FUEL과 COLD CACHE는 판정을 돕는 참고일 뿐 점수·배정에 들지 않는다. HELD 카드에는 CROSSCHECK 판정과 사유도 붙는다 |
| 점수 요소 · 본문 · 메모(접힘) | 누르면(키보드는 Enter) 점수 요소 표, OCC 메모, 티켓 본문 전체가 열린다. 본문은 열 때 Linear에서 읽는다. CAUTION 표시는 접혀 있어도 카드 머리에 보인다 |
| FLIGHT → AIRCRAFT, 점수 | 우선순위·대기 일수·풀어 주는 FLIGHT·팀 적합도·충돌 위험·파일 겹침(곧 고칠 파일을 날고 있는 FLIGHT가 이미 바꿈)·ROUTE·지금 WAYPOINT(그 ROUTE의 지금 구간 마일스톤에 붙은 FLIGHT)를 합친 점수. 요소별 점수는 접힌 자세히에 있다 |
| 분류 줄 | `BUILD · M · SEC · tail:TEAM_E`. 라벨이 없으면 회색 "(기본값)" |
| OCC 메모 | 본문에서 찾은 제약. CAUTION이면 보안·DB·사람 결정 대기 |
| HELD 목록 | 아직 시작할 상태가 아닌 제안(PREFLIGHT). CROSSCHECK가 FLIGHT 칩으로 disagree했거나 OCC가 HOLD한 것. 판정하지 않는다(아래 PREFLIGHT) |
| `CROSSCHECK 대기` | CROSSCHECK가 아직 보지 않은 제안. mark가 있는 제안 뒤에 온다 |
| CROSSCHECK 동의 묶음(ASSIGN 맨 위) | CROSSCHECK가 agree한 카드가 한 줄씩 모인다: 무슨 일 · FLIGHT · → AIRCRAFT · [동의]. [동의]는 "CROSSCHECK에 동의"와 같은 한 번 클릭 판정이다. ▸(키보드 Enter)로 펼치면 전체 카드가 보이고, 거절은 거기서 칩과 함께 한다. "모두 동의" 버튼은 일부러 없다 |
| `BLIND` | 약 5장에 1장은 판정할 때까지 CROSSCHECK 판정을 숨긴다(제안 ID로 정해져 새로고침해도 같다). 카드를 보고 직접 판정한다. CROSSCHECK가 agree해도 묶음에 들어가지 않고, 한 번 클릭 버튼도 없다 |
| `STAND 없이` 줄 | STAND 규칙 밖으로 준 SURVEY·CHECK. 받는 팀이 다른 FLIGHT의 STAND를 쥔 HOLDING이어도 나온다. 점수는 0 |
| `CHECK 독립성` 줄 | CHECK마다 붙는다. 검토 대상을 만든 팀을 뺐으면 그 팀 이름, 모르면 "확인 못 함". 점수는 0 |

- **승인했을 것**: 이 배정이 맞다고 보면.
- **`SUPERVISOR CONFIRM AT AIRCRAFT`**(카드의 점선 상자): 이 FLIGHT가 사용자 등급 파일(guard, `.claude/`, 루트 `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`)을 만질 것으로 예측됐다는 표시다. 승인은 그대로 되고, 승인 확인 창에도 같은 내용이 뜬다. 승인하면 그 AIRCRAFT는 파일을 고치기 전에 세션에서 직접 사용자에게 go를 묻는다. 상자에 경로, 그 세션에 붙여 넣을 한 줄(복사 버튼), 세션을 여는 법(`claude agents`에서 그 REGISTRATION 선택)이 있다. 그 한 줄을 붙여 넣어 go를 주는 것은 사용자이고, atc와 OCC는 대신 보내지 않는다.
- **`AWAITING SUPERVISOR`**(IN FLIGHT 줄과 FLIGHT FOLLOWING, 경보): CAPTAIN이 READBACK도 거절도 아닌 채 사용자의 go를 기다린다고 답했다. 그 세션에서 go를 주면(또는 READBACK이 오면) 풀린다.
- **거절했을 것**: 카드 안에 거절 양식이 열린다. 사유 칩을 여러 개 고를 수 있고, 필요하면 메모를 덧붙인다(칩·메모 없이도 기록은 되지만 사유가 있어야 나중에 쓸모가 있다). Esc로 닫는다. 칩은 이미 완료됨 · 상위 이슈(하위로 나뉨) · 선행 FLIGHT·PR 대기 · 사람 결정 필요 · 우선순위 미정 · 저장소 밖 작업 · AIRCRAFT 부적합 · 기타다. 기록되는 사유는 `이미 완료됨 · 저장소 밖 작업 — 메모`처럼 칩 이름 뒤에 메모가 붙은 한 줄이라, CROSSCHECK와 OCC도 그 글을 그대로 읽는다. 승인 운용(2b)의 거절도 같다.
- **칩이 차단 범위를 정한다**: FLIGHT 자체의 문제인 칩(이미 완료됨 · 상위 이슈 · 선행 FLIGHT·PR 대기 · 사람 결정 필요 · 우선순위 미정 · 저장소 밖 작업)이 하나라도 있으면 그 FLIGHT가 **모든 팀**에서 빠진다. 제외 목록에 `FLIGHT 보류 — 사람 결정 필요 (D-0023 판정) — 이슈가 바뀌거나 09-28 14:00부터 다시`처럼 뜨고, 24시간이 지나거나 Linear 이슈가 판정 뒤에 바뀌면(본문 수정, 댓글, 우선순위) 다시 후보가 된다. AIRCRAFT 부적합 · 기타 · 칩 없음이면 그 팀과의 짝만 24시간 막고 다른 팀에는 바로 제안될 수 있다. 그러니 "이 팀이라서"인지 "이 일이라서"인지 먼저 가르고 칩을 고른다.
- **거절 사유 → 배정 규칙**(점검 패널): 칩을 고른 거절마다 칩별로 센다. 줄마다 건수, 최근 예시 FLIGHT, 그리고 planner가 그 사유를 이미 스스로 거르는지(자동 거름 · 일부 거름 · 사람만)가 보인다. 마우스를 올리면 어떤 규칙으로 거르는지 나온다. "사람만"이나 "일부 거름"인 칩이 쌓이면 새 규칙을 만들 차례다. 칩이 생기기 전의 거절은 세지 않는다.
- **이미 끝났거나 작업 중인 FLIGHT는 제안하지 않는다**: LOGBOOK에 PR 머지가 기록된 FLIGHT(Linear가 아직 Todo여도)와 열린 PR이 있는 FLIGHT는 "제외" 목록에 `이미 완료됨 — PR vocado_nextjs#400 머지됨(LOGBOOK)`, `열린 PR #412 있음`으로 뜬다. 이미 열린 제안은 이 사유로 닫힌다(SUPERSEDED). 그러니 이런 제안을 "이미 완료됨"으로 거절할 일은 줄어든다. PR을 되돌리면 다시 후보가 된다.
- **HOLDING 팀에 가는 SURVEY·CHECK**: `type:SURVEY`나 `type:CHECK` 라벨이 붙은 FLIGHT는 워크트리가 필요 없어서, 이미 다른 FLIGHT를 들고 있는(HOLDING) 팀에도 하나까지 제안된다. AIRBORNE(지금 일하는 중)인 팀에는 가지 않는다. 판정할 때는 "그 팀이 지금 하던 일을 두고 이걸 볼 여유가 있나", "SURVEY·CHECK 라벨이 맞나"를 본다. 라벨 없는 FLIGHT는 BUILD로 보므로 이 길로 오지 않는다.
- **CHECK는 만든 팀에 가지 않는다**: LOGBOOK, 열린 PR의 STAND, 워크트리 점유, 청구 기록에서 검토 대상을 만든 팀을 찾아 뺀다. 대상은 Linear 관계와 제목(FLIGHT key, `PR #400`)에서만 찾으므로 본문에만 적혀 있으면 모른다. `CHECK 독립성: 확인 못 함`이면 받는 팀이 그 대상을 만들지 않았는지 직접 확인하고, 만든 팀이면 "AIRCRAFT 부적합"으로 거절한다. 만든 팀만 남으면 제안 대신 "제외" 목록에 `CHECK 독립성 — …`으로 뜬다.
- 조건부로 승인하고 싶으면(예: "PR #393 머지 뒤") HOLD로 두는 게 맞다.
- **PREFLIGHT — HELD는 판정하지 않는다**: 티켓이 아직 시작할 상태가 아닌 제안은 대기열에 오지 않고 HELD로 간다. CROSSCHECK가 FLIGHT 칩(이미 완료됨 · 상위 이슈 · 선행 FLIGHT·PR 대기 · 사람 결정 필요 · 우선순위 미정 · 저장소 밖 작업)으로 disagree하면 서버가 곧바로 보내고(카드에 `PREFLIGHT`, 모델과 칩), OCC가 HOLD하면 전처럼 간다(`HOLD`와 메모). AIRCRAFT 부적합 · 기타는 팀 선택 문제라 대기열에 남는다. HELD 카드에는 판정 버튼 대신 둘이 있다.
  - **대기열로**: 걸러진 게 틀렸다고 보면. 같은 제안이 대기열로 돌아와 판정을 기다리고(24시간은 지금부터), 다시 HOLD되지 않는다.
  - **FLIGHT 보류 확정**: 맞게 걸렀으면. 제안이 닫히고 그 FLIGHT가 모든 팀에서 24시간(이슈가 바뀌면 그 전까지) 빠진다. 선행 FLIGHT를 기다리는 HOLD에는 이 버튼이 없다(선행이 끝나면 저절로 풀린다).
  - 둘 다 판정이 아니라 2b 게이트(판정 건수·합의율)에 세지 않는다. 점검 패널의 `PREFLIGHT HELD n건 · 준비율`이 따로 보여 준다: 준비율은 HOLD 없이 판정까지 가서 준비 안 됨 거절도 아니었던 제안의 비율, 즉 들어오는 티켓이 얼마나 준비돼 있었나다.
- **게이트는 팀 선택만 잰다**: 사유 칩이 모두 FLIGHT 칩(이미 완료됨 · 상위 이슈 · 선행 FLIGHT·PR 대기 · 사람 결정 필요 · 우선순위 미정 · 저장소 밖 작업)인 거절은 판정 건수와 합의율에서 빠지고 "준비 안 됨 거절 n건 (게이트 제외)"으로 따로 보인다. AIRCRAFT 부적합이나 기타가 하나라도 있거나 칩이 없으면 게이트에 센다. 그러니 "이 팀이라서" 거절할 때는 AIRCRAFT 부적합을 꼭 고른다. 칩 없이 한 예전 거절에는 나중에 칩을 달 수 있다(`POST /api/dispatch/proposals/<D-xxxx>/codes`, 거절한 제안에만). 이것은 게이트 계산만 바꾸고 FLIGHT 보류는 걸지 않는다.
- **2b 진입 점검**: 판정 20건 이상, 합의율 80% 이상(준비 안 됨 거절 제외). 켜면 승인한 제안이 FLIGHT PLAN으로 CAPTAIN에게 간다.
- **2b 켜기 점검표**: 켜기 전에 볼 항목이 준비됨·안 됨·확인 필요로 보인다. 2a 게이트, RECALL, send-guard, AIRPORT마다 하나씩 있는 READBACK 규칙(vocado READBACK 규칙, atc READBACK 규칙, …), STAND 없는 FLIGHT, CREW CHANGE 발부, 알려진 빈틈 순서다. AIRPORT READBACK 규칙은 그 저장소 CLAUDE.md가 FLIGHT PLAN(`[DISPATCH D-xxxx]` → `READBACK D-xxxx`)과 CREW CHANGE(`[OCC CC-xxxx]` → `READBACK CC-xxxx`)를 다 다뤄야 "준비됨"이고, "안 됨"이면 그 저장소 CLAUDE.md에 더할 문장이 함께 나온다(vocado `CLAUDE.md`는 SUPERVISOR가 고치고, 다른 AIRPORT는 그 팀이 고친다). send-guard는 서버가 테스트를 돌리지 않아 늘 "확인 필요"다(`node --test occ/send-guard.test.mjs`). 점검표는 보여 주기만 하고, 켜는 것은 SUPERVISOR다.

## SCHEDULE 탭: 티켓 초안

OCC가 Linear에 쓸 변경을 초안으로 남긴다. 지금은 S1이라 Linear에 쓰지 않는다.

| 초안 | 내용 |
|---|---|
| CLASSIFY | 분류 라벨 제안: type · wake · rating. 후보 목록은 제목이 리서치·검토·비교·계획처럼 보이는 FLIGHT가 앞에 온다(SURVEY·CHECK로 분류되면 HOLDING 팀도 받을 수 있어서) |
| PRIORITIZE | 우선순위 제안(본문·댓글에 근거가 있을 때만) |
| TAIL | FLIGHT의 `tail:TEAM_X`를 그 팀으로 정하자는 제안. 사용자가 OCC에 말한 배정이나, `tail:` 없이 팀이 이미 몰고 있는 FLIGHT에서 나온다. 카드에 지금 `tail:`, 바뀔 것(`+ tail:TEAM_J`, `− tail:TEAM_A`), 근거가 있다. 다른 팀이 몰고 있는 `tail:`을 바꾸면 빨간 **CAUTION** 줄이 붙는다. 판정은 CLASSIFY·PRIORITIZE처럼 S2 진입 점검에 센다. 후보 목록의 TAIL은 그 팀이 몰고 있다는 기록(STAND, DEPARTURE LOG, READBACK)을 함께 보인다 |
| WAYPOINT | 마일스톤이 없는 FLIGHT를 그 ROUTE의 WAYPOINT(Linear 마일스톤)에 붙이자는 제안. 카드에 "WAYPOINT 없음 · ROUTE", 바뀔 것(`WAYPOINT 없음 → ROUTE · WAYPOINT`), OCC 근거(그 WAYPOINT의 완료 기준 번호)가 있다. 그 기준이 정말 이 FLIGHT를 덮는지 보고 판정한다. 후보 목록에는 WAYPOINT가 있는 ROUTE에서 어느 WAYPOINT에도 없는 열린 FLIGHT와 붙일 수 있는 WAYPOINT가 보인다. 판정은 S2 진입 점검에 센다. 마일스톤은 만들거나 바꾸지 않고 이슈의 milestone 칸만 바꾼다 |
| NEW (AD HOC FLIGHT) | 사용자가 OCC에 요청한 새 티켓. `WAYPOINT` 줄이 있으면 그 마일스톤에 붙을 이슈다. "완료 기준에서 올린 초안(WAYPOINT gap)"이면 OCC가 Linear 마일스톤의 완료 기준 가운데 아직 이슈가 없는 것을 옮긴 것이다. 본문 `## 목표`에 인용된 기준을 보고, 그 기준을 이 이슈가 맡는 게 맞는지 판정한다. 비슷한 FLIGHT가 있으면 atc가 받지 않으니, gap 초안에는 비슷한 FLIGHT가 없다 |
| TARGET · ROUTE | AIRCRAFT 하나의 FLEET 목표(`flightsPerWeek`, `onTime`)나 ROUTE(맡는 프로젝트)를 바꾸자는 초안. 카드에 지금 값, 바뀔 것, OCC 근거, atc가 붙인 숫자(14일 ARRIVED, 주별 ARRIVED, ROUTE 대기)가 있다. S2에서도 "승인했을 것 / 거절했을 것"만 받고 FLEET에 쓰지 않는다 — 바꾸려면 FLEET 탭에서 직접. 이 판정은 S2 진입 점검에 세지 않는다 |
| CLOSE | PR이 머지됐는데(LOGBOOK ARRIVED) Linear에서 아직 열린 FLIGHT를 Done으로. 카드에 PR 링크, 머지 시각, 본문이 `Fixes`인지가 있다. `Part of`(일부만)면 노란색으로 표시된다 |

- 카드에 "바뀔 것"과 OCC 근거가 있다. 맞으면 승인했을 것, 아니면 거절했을 것(사유 선택).
- 라벨이 당장 필요하면 카드 안내대로 Linear에서 직접 붙인다. 그러면 초안은 "Linear에 이미 반영됨"으로 스스로 닫힌다.
- 열린 초안은 5건까지. 3일 동안 판정이 없으면 EXPIRED.
- **CLOSE는 Linear에서 직접 닫는다.** vocado 규칙상 OCC는 이슈 상태를 바꾸지 않으므로 S2에서도 CLOSE는 발부되지 않는다. 승인한 CLOSE(그림자 운용이면 "승인했을 것")는 SCHEDULE 탭의 **LINEAR에서 직접 DONE** 목록에 이슈·PR 링크와 함께 뜬다. Linear에서 Done으로 바꾸면 다음 새로 고침에 목록과 초안이 함께 닫힌다. PR이 되돌려지면 초안은 스스로 SUPERSEDED된다.
- CLOSE 판정 기준: PR 본문이 `Fixes VOC-n`이고 완료 기준이 그 PR로 채워졌으면 승인, `Part of`이거나 남은 일·되돌림이 있으면 거절(사유 칩 "Part of — 일부만 끝남", "남은 작업이 있음" …).
- **LATE WAYPOINTS**: ETA가 WAYPOINT(Linear 마일스톤)의 목표일을 넘거나 목표일이 지났으면 S2 점검 아래에 뜬다. 판정할 것은 아니다. OCC는 새 경고를 세션에서 한 번 보고하고, 목록에는 풀릴 때까지 남는다("OCC 보고 …"). 목표일을 옮길지, 일을 줄일지, FLIGHT를 더 배정할지는 SUPERVISOR가 정한다. ETA 계산은 NETWORK 탭 ROUTE MAP과 같다.
- **ROUTES WITHOUT WAYPOINTS**: 열린 FLIGHT가 있는데 WAYPOINT(마일스톤)가 하나도 없는 ROUTE와 그 열린 FLIGHT 수가 LATE WAYPOINTS 아래에 뜬다. 판정할 것은 아니다. 그 ROUTE는 ETA를 셀 수 없고 WAYPOINT 초안도 쓸 곳이 없다. OCC는 새 ROUTE를 세션에서 한 번 알린다. WAYPOINT가 필요하면 Linear에서 그 프로젝트에 마일스톤을 만든다(OCC는 만들지 않는다). 만들면 다음 새로 고침에 목록에서 빠진다.
- **S2 진입 점검**: 판정 20건 이상, 합의율 80% 이상. 그때 Linear 쓰기가 열린다(승인한 초안만, linear-guard로).
- **S2(승인 운용)**: SCHEDULE 탭의 "S2 승인 운용 켜기"로 켠다(만들어 두었고 기본은 꺼짐). 켜면 버튼이 "승인 / 거절"이 되고, 승인한 작업은 IN PROGRESS에 APPROVED → RELEASED(OCC가 Linear에 씀) → APPLIED(Linear에 보임)로 보인다. OCC가 쓰는 내용은 atc가 만들고, linear-guard가 그 입력과 다른 쓰기는 모두 막는다. 같은 호출은 한 번만 통과하므로 되풀이해도 댓글이 두 번 달리지 않는다. RELEASED인데 Linear에 반영되지 않았으면 OCC가 보고하고, Linear에서 직접 바꾸면 APPLIED로 닫힌다. 켜기 전 준비는 저장소의 `docs/occ.ko.md` "S2 켜는 법".

## RECALL: 보낸 FLIGHT PLAN 거둬들이기

승인했지만 아직 보내지 않은 카드는 진행 중 목록의 **CANCEL…**을 누르고 확인한다(보낸 뒤에는 RECALL). 카드는 `SUPERVISOR가 취소함`으로 닫히고 같은 짝은 24시간 다시 제안되지 않는다.

2b에서 FLIGHT PLAN을 보냈거나 CAPTAIN이 READBACK했는데 거둬들여야 하면(우선순위가 바뀜, 잘못 배정됨 등), DISPATCH 탭 진행 중 목록의 **RECALL…**을 누르고 사유를 적는다.

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

## CROSSCHECK: 예비 판정 먼저 보기

CROSSCHECK 세션이 켜져 있으면, 열린 제안과 초안마다 OCC와 다른 계열의 모델이 예비 판정을 먼저 달아 둔다. 카드의 점선 칩이 그것이다: `CROSSCHECK agree · 본문상 제약 없음`, `CROSSCHECK disagree · 이미 완료됨`.

- **CROSSCHECK에 동의**: 한 번 클릭으로 같은 판정을 낸다. 그림자 운용이면 승인했을 것/거절했을 것, 승인 운용(2b·S2)이면 승인/거절이다. disagree에 동의하면 CROSSCHECK의 이유와 사유 칩(점선 칩 안의 `사람 결정 필요` 같은 표시)이 그대로 거절 사유로 들어가고, 칩대로 차단 범위가 정해진다. 칩이 없는 CROSSCHECK에 동의하면 짝만 막힌다. 승인 운용에서 승인하면 FLIGHT PLAN이 나가거나 Linear에 쓰이므로 확인 창이 한 번 더 뜬다.
- **한 번 클릭 비율**(점검 패널): 판정마다 "CROSSCHECK에 동의"로 냈는지, 버튼을 직접 골랐는지 기록한다. 3/10이면 한 번 클릭이 가능했던 판정(판정 전에 CROSSCHECK 칩이 있던 것) 10건 중 3건을 한 번 클릭으로 냈다는 뜻이다. 칩 없이 한 판정은 세지 않는다. blind 카드의 판정도 세지 않는다(한 번 클릭이 막혀 있어서). 이 비율이 높은데 일치율도 높으면, 합의율이 CROSSCHECK를 따라가는 습관 때문에 부풀었을 수 있다. 게이트를 넘기 전에 몇 건은 칩을 보기 전에 스스로 판단해 본다. 이 기록이 생기기 전의 판정은 세지 않는다.
- **BLIND 합의율**(점검 패널): blind 카드에서 낸 판정만의 합의율이다. CROSSCHECK를 보지 않고 판단했을 때의 숫자라, 전체 합의율보다 크게 낮으면 동의 묶음의 [동의]를 기본값처럼 누르고 있다는 신호다(anchoring 점검). 게이트 기준은 아니다.
- **뒤집기**: 칩과 생각이 다르면 평소 버튼(승인했을 것, 거절했을 것 …)을 누르고 사유를 적는다. 그 판정과 사유가 다음 바퀴부터 CROSSCHECK의 기준 예시가 된다.
- **mark는 참고일 뿐이다.** 제안·초안 상태를 바꾸지 않고, 게이트(20건·80%)에도 들어가지 않는다. 게이트는 사람 판정만 센다.
- **CROSSCHECK 일치** 줄(점검 패널): 사람이 판정한 건 중 판정 전에 mark가 있던 건에서, mark가 사람 판정과 맞은 비율. 게이트 기준은 아니고, 나중에 위험이 낮은 일(SEC가 아닌 CLASSIFY 등)을 자동으로 넘길지 정할 근거다.
- **JEV 일치** 줄(SCHEDULE 점검 패널, 판정 계열이 켜져 있거나 mark가 있을 때): 판정 계열 Jev가 CLASSIFY 초안에 낸 분류가 사람 판정과 맞은 비율. 지난 판정을 다시 돌린 `replay` mark도 센다. Jev의 mark는 판정한 초안에만 RECENT의 칩(`JEV agree`)으로 보인다. 판정 전에는 보이지 않아서 판단이 쏠리지 않는다. 켜고 끄는 것은 설정 창 AGENTS 탭의 JUDGES다(설계: `docs/fleet.ko.md` 6.1).
- **JEV** 줄 셋(DISPATCH 점검 패널, 판정 계열이 켜져 있거나 mark가 있을 때): Jev가 열린 ASSIGN 제안마다 세 가지를 묻는다. 본문이 시작하기에 충분한가(Ready), 다른 일을 기다린다고 적혀 있나(Prerequisite), AIRCRAFT의 최근 atc FLIGHT와 얼마나 가까운가(Same area). 줄은 `Ready = no → 거절`, `Prerequisite = yes → 선행 대기`(`waiting-on-prior` 칩이나 OCC HOLD), `Same area 가까움 → 승인`이 사람 결과와 맞은 건수다. 참고용이고 점수·HOLD·상태에는 영향이 없다. mark는 RECENT의 `JEV` 칩(툴팁에 세 답)으로 닫힌 제안에만 보이고, 열린 카드에는 보이지 않는다. 쓸지는 판정한 제안이 20건 넘은 뒤 SUPERVISOR가 정한다(설계: `docs/fleet.ko.md` 6.1).
- **JEV REPORT**(FLEET 줄의 칩, AIRCRAFT 카드의 줄, FLEET PLAN 패널 위쪽 줄): AIRCRAFT의 턴이 끝날 때 Jev가 CAPTAIN의 마지막 메시지를 `reported done`·`asks for a decision`·`stopped mid-work`·`idle and ready`·`can't tell`로 분류한다(atc 저장소 AIRCRAFT만, 경로·URL을 가려서 최대 1,500자). 카드의 **맞음 / 틀림**으로 분류가 맞았는지 표시하면 패널에 `JEV REPORT 맞음 m/n`이 센다. 결정이 필요하다는 확률이 70% 이상이면 FLIGHT FOLLOWING에 항목이 하나 붙는다. 참고용이고 health 코드·DISPATCH·FLEET PLAN에는 영향이 없다(설계: `docs/fleet.ko.md` 8.8).
- 모델별로도 보인다: 일치 줄 아래 `└ claude-opus-5-5 3/4 75%`처럼 모델마다 한 줄(2026-09-29 전 ocx 시절 mark는 `muse-spark-1.3`으로 따로 보인다). 칩에도 mark를 단 모델의 짧은 이름이 시각 옆에 있고, 전체 id는 칩과 RECENT에 마우스를 올리면 보인다. 모델 이름이 생기기 전의 mark는 `unknown`으로 센다.
- 본문이나 OCC 메모에 PR 조건("PR #393 머지 뒤")이 있으면, CROSSCHECK가 `gh pr view`로 그 PR의 상태를 확인하고 이유에 적는다(예: `PR #393 머지 전이면 HOLD — gh: OPEN`).
- HOLD 중인 제안에는 mark가 달리지 않는다. FLIGHT 칩 disagree mark가 달리면 그 제안은 곧바로 HELD로 간다(PREFLIGHT). "CROSSCHECK에 동의"는 대기열에 남은 제안(팀 선택 문제, agree)에만 쓴다.

CROSSCHECK 세션을 여는 법은 [빠른 시작](quickstart.md)의 관제 세션 표에 있다.

## 얼마나 자주

하루 몇 번, 새 카드가 있을 때 판정하면 충분하다. CROSSCHECK 칩이 있으면 대부분은 한 번 클릭으로 끝나고, 뒤집을 건에만 사유를 쓰면 된다. 판정이 쌓이는 속도가 곧 다음 단계로 가는 속도다.
