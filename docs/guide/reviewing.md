# 판정하기

atc의 자동화는 **그림자 운용**에서 시작한다. 제안과 초안을 만들어 화면에만 보이고, 사용자가 "승인했을 것 / 거절했을 것"을 표시해 품질을 잰다. 기준(20건, 합의율 80%)이 차면 다음 단계로 간다.

## DISPATCH 탭: 배정 제안

5분마다 atc가 "어떤 FLIGHT를 어떤 AIRCRAFT에" 계획하고, OCC가 제안마다 티켓 본문을 읽어 메모·CAUTION·HOLD를 단다.

| 카드에서 볼 것 | 뜻 |
|---|---|
| FLIGHT → AIRCRAFT, 점수 | 우선순위·대기 일수·풀어 주는 FLIGHT·팀 적합도·충돌 위험·ROUTE |
| 분류 줄 | `BUILD · M · SEC · tail:TEAM_E`. 라벨이 없으면 회색 "(기본값)" |
| OCC 메모 | 본문에서 찾은 제약. CAUTION이면 보안·DB·사람 결정 대기 |
| HELD 목록 | 선행 FLIGHT나 사람 결정을 기다리는 제안. 선행이 끝나면 자동으로 풀린다 |
| `STAND 없이` 줄 | STAND 규칙 밖으로 준 SURVEY·CHECK. 받는 팀이 다른 FLIGHT의 STAND를 쥔 HOLDING이어도 나온다. 점수는 0 |
| `CHECK 독립성` 줄 | CHECK마다 붙는다. 검토 대상을 만든 팀을 뺐으면 그 팀 이름, 모르면 "확인 못 함". 점수는 0 |

- **승인했을 것**: 이 배정이 맞다고 보면.
- **거절했을 것**: 카드 안에 거절 양식이 열린다. 사유 칩을 여러 개 고를 수 있고, 필요하면 메모를 덧붙인다(칩·메모 없이도 기록은 되지만 사유가 있어야 나중에 쓸모가 있다). Esc로 닫는다. 칩은 이미 완료됨 · 상위 이슈(하위로 나뉨) · 선행 FLIGHT·PR 대기 · 사람 결정 필요 · 우선순위 미정 · 저장소 밖 작업 · AIRCRAFT 부적합 · 기타다. 기록되는 사유는 `이미 완료됨 · 저장소 밖 작업 — 메모`처럼 칩 이름 뒤에 메모가 붙은 한 줄이라, CROSSCHECK와 OCC도 그 글을 그대로 읽는다. 승인 운용(2b)의 거절도 같다.
- **거절 사유 → 배정 규칙**(점검 패널): 칩을 고른 거절마다 칩별로 센다. 줄마다 건수, 최근 예시 FLIGHT, 그리고 planner가 그 사유를 이미 스스로 거르는지(자동 거름 · 일부 거름 · 사람만)가 보인다. 마우스를 올리면 어떤 규칙으로 거르는지 나온다. "사람만"이나 "일부 거름"인 칩이 쌓이면 새 규칙을 만들 차례다. 칩이 생기기 전의 거절은 세지 않는다.
- **이미 끝났거나 작업 중인 FLIGHT는 제안하지 않는다**: LOGBOOK에 PR 머지가 기록된 FLIGHT(Linear가 아직 Todo여도)와 열린 PR이 있는 FLIGHT는 "제외" 목록에 `이미 완료됨 — PR vocado_nextjs#400 머지됨(LOGBOOK)`, `열린 PR #412 있음`으로 뜬다. 이미 열린 제안은 이 사유로 닫힌다(SUPERSEDED). 그러니 이런 제안을 "이미 완료됨"으로 거절할 일은 줄어든다. PR을 되돌리면 다시 후보가 된다.
- **HOLDING 팀에 가는 SURVEY·CHECK**: `type:SURVEY`나 `type:CHECK` 라벨이 붙은 FLIGHT는 워크트리가 필요 없어서, 이미 다른 FLIGHT를 들고 있는(HOLDING) 팀에도 하나까지 제안된다. AIRBORNE(지금 일하는 중)인 팀에는 가지 않는다. 판정할 때는 "그 팀이 지금 하던 일을 두고 이걸 볼 여유가 있나", "SURVEY·CHECK 라벨이 맞나"를 본다. 라벨 없는 FLIGHT는 BUILD로 보므로 이 길로 오지 않는다.
- **CHECK는 만든 팀에 가지 않는다**: LOGBOOK, 열린 PR의 STAND, 워크트리 점유, 청구 기록에서 검토 대상을 만든 팀을 찾아 뺀다. 대상은 Linear 관계와 제목(FLIGHT key, `PR #400`)에서만 찾으므로 본문에만 적혀 있으면 모른다. `CHECK 독립성: 확인 못 함`이면 받는 팀이 그 대상을 만들지 않았는지 직접 확인하고, 만든 팀이면 "AIRCRAFT 부적합"으로 거절한다. 만든 팀만 남으면 제안 대신 "제외" 목록에 `CHECK 독립성 — …`으로 뜬다.
- 조건부로 승인하고 싶으면(예: "PR #393 머지 뒤") HOLD로 두는 게 맞다.
- **2b 진입 점검**: 판정 20건 이상, 합의율 80% 이상. 켜면 승인한 제안이 FLIGHT PLAN으로 CAPTAIN에게 간다.
- **2b 켜기 점검표**: 켜기 전에 볼 항목이 준비됨·안 됨·확인 필요로 보인다. 2a 게이트, RECALL, send-guard, vocado READBACK 규칙, STAND 없는 FLIGHT, CREW CHANGE 발부, 알려진 빈틈 순서다. vocado READBACK 규칙은 FLIGHT PLAN(`[DISPATCH D-xxxx]` → `READBACK D-xxxx`)과 CREW CHANGE(`[OCC CC-xxxx]` → `READBACK CC-xxxx`)를 다 다뤄야 "준비됨"이고, "안 됨"이면 `vocado_nextjs/CLAUDE.md`에 더할 문장이 함께 나온다(그 파일은 SUPERVISOR가 고친다). send-guard는 서버가 테스트를 돌리지 않아 늘 "확인 필요"다(`node --test occ/send-guard.test.mjs`). 점검표는 보여 주기만 하고, 켜는 것은 SUPERVISOR다.

## SCHEDULE 탭: 티켓 초안

OCC가 Linear에 쓸 변경을 초안으로 남긴다. 지금은 S1이라 Linear에 쓰지 않는다.

| 초안 | 내용 |
|---|---|
| CLASSIFY | 분류 라벨 제안: type · wake · rating. 후보 목록은 제목이 리서치·검토·비교·계획처럼 보이는 FLIGHT가 앞에 온다(SURVEY·CHECK로 분류되면 HOLDING 팀도 받을 수 있어서) |
| PRIORITIZE | 우선순위 제안(본문·댓글에 근거가 있을 때만) |
| NEW (AD HOC FLIGHT) | 사용자가 OCC에 요청한 새 티켓 |
| CLOSE | PR이 머지됐는데(LOGBOOK ARRIVED) Linear에서 아직 열린 FLIGHT를 Done으로. 카드에 PR 링크, 머지 시각, 본문이 `Fixes`인지가 있다. `Part of`(일부만)면 노란색으로 표시된다 |

- 카드에 "바뀔 것"과 OCC 근거가 있다. 맞으면 승인했을 것, 아니면 거절했을 것(사유 선택).
- 라벨이 당장 필요하면 카드 안내대로 Linear에서 직접 붙인다. 그러면 초안은 "Linear에 이미 반영됨"으로 스스로 닫힌다.
- 열린 초안은 5건까지. 3일 동안 판정이 없으면 EXPIRED.
- **CLOSE는 Linear에서 직접 닫는다.** vocado 규칙상 OCC는 이슈 상태를 바꾸지 않으므로 S2에서도 CLOSE는 발부되지 않는다. 승인한 CLOSE(그림자 운용이면 "승인했을 것")는 SCHEDULE 탭의 **LINEAR에서 직접 DONE** 목록에 이슈·PR 링크와 함께 뜬다. Linear에서 Done으로 바꾸면 다음 새로 고침에 목록과 초안이 함께 닫힌다. PR이 되돌려지면 초안은 스스로 SUPERSEDED된다.
- CLOSE 판정 기준: PR 본문이 `Fixes VOC-n`이고 완료 기준이 그 PR로 채워졌으면 승인, `Part of`이거나 남은 일·되돌림이 있으면 거절(사유 칩 "Part of — 일부만 끝남", "남은 작업이 있음" …).
- **S2 진입 점검**: 판정 20건 이상, 합의율 80% 이상. 그때 Linear 쓰기가 열린다(승인한 초안만, linear-guard로).
- **S2(승인 운용)**: SCHEDULE 탭의 "S2 승인 운용 켜기"로 켠다(만들어 두었고 기본은 꺼짐). 켜면 버튼이 "승인 / 거절"이 되고, 승인한 작업은 IN PROGRESS에 APPROVED → RELEASED(OCC가 Linear에 씀) → APPLIED(Linear에 보임)로 보인다. OCC가 쓰는 내용은 atc가 만들고, linear-guard가 그 입력과 다른 쓰기는 모두 막는다. 같은 호출은 한 번만 통과하므로 되풀이해도 댓글이 두 번 달리지 않는다. RELEASED인데 Linear에 반영되지 않았으면 OCC가 보고하고, Linear에서 직접 바꾸면 APPLIED로 닫힌다. 켜기 전 준비는 저장소의 `docs/occ.ko.md` "S2 켜는 법".

## RECALL: 보낸 FLIGHT PLAN 거둬들이기

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
- 보고 없이 24시간이 지나면 늦은 것(overdue)에 뜬다. OCC는 CAPTAIN에게 직접 물을 수 없으니 SUPERVISOR가 챙긴다.
- 2b → 3 점검의 DEPARTED 비율에는 STAND가 필요한 FLIGHT만 센다. STAND 없는 FLIGHT는 READBACK 비율에만 들어가고, READBACK·ARRIVED 수가 따로 보인다.

## CROSSCHECK: 예비 판정 먼저 보기

CROSSCHECK 세션이 켜져 있으면, 열린 제안과 초안마다 OCC와 다른 계열의 모델이 예비 판정을 먼저 달아 둔다. 카드의 점선 칩이 그것이다: `CROSSCHECK agree · 본문상 제약 없음`, `CROSSCHECK disagree · 이미 완료됨`.

- **CROSSCHECK에 동의**: 한 번 클릭으로 같은 판정을 낸다. 그림자 운용이면 승인했을 것/거절했을 것, 승인 운용(2b·S2)이면 승인/거절이다. disagree에 동의하면 CROSSCHECK의 이유가 거절 사유로 들어간다. 승인 운용에서 승인하면 FLIGHT PLAN이 나가거나 Linear에 쓰이므로 확인 창이 한 번 더 뜬다.
- **한 번 클릭 비율**(점검 패널): 판정마다 "CROSSCHECK에 동의"로 냈는지, 버튼을 직접 골랐는지 기록한다. 3/10이면 한 번 클릭이 가능했던 판정(판정 전에 CROSSCHECK 칩이 있던 것) 10건 중 3건을 한 번 클릭으로 냈다는 뜻이다. 칩 없이 한 판정은 세지 않는다. 이 비율이 높은데 일치율도 높으면, 합의율이 CROSSCHECK를 따라가는 습관 때문에 부풀었을 수 있다. 게이트를 넘기 전에 몇 건은 칩을 보기 전에 스스로 판단해 본다. 이 기록이 생기기 전의 판정은 세지 않는다.
- **뒤집기**: 칩과 생각이 다르면 평소 버튼(승인했을 것, 거절했을 것 …)을 누르고 사유를 적는다. 그 판정과 사유가 다음 바퀴부터 CROSSCHECK의 기준 예시가 된다.
- **mark는 참고일 뿐이다.** 제안·초안 상태를 바꾸지 않고, 게이트(20건·80%)에도 들어가지 않는다. 게이트는 사람 판정만 센다.
- **CROSSCHECK 일치** 줄(점검 패널): 사람이 판정한 건 중 판정 전에 mark가 있던 건에서, mark가 사람 판정과 맞은 비율. 게이트 기준은 아니고, 나중에 위험이 낮은 일(SEC가 아닌 CLASSIFY 등)을 자동으로 넘길지 정할 근거다.
- 모델별로도 보인다: 일치 줄 아래 `└ muse-spark-1.3-contributor 3/4 75%`처럼 모델마다 한 줄. 칩에도 mark를 단 모델의 짧은 이름이 시각 옆에 있고, 전체 id는 칩과 RECENT에 마우스를 올리면 보인다. 모델 이름이 생기기 전의 mark는 `unknown`으로 센다.
- 본문이나 OCC 메모에 PR 조건("PR #393 머지 뒤")이 있으면, CROSSCHECK가 `gh pr view`로 그 PR의 상태를 확인하고 이유에 적는다(예: `PR #393 머지 전이면 HOLD — gh: OPEN`).
- HOLD 중인 제안에는 mark가 달리지 않는다.

CROSSCHECK 세션을 여는 법은 [빠른 시작](quickstart.md)의 관제 세션 표에 있다.

## 얼마나 자주

하루 몇 번, 새 카드가 있을 때 판정하면 충분하다. CROSSCHECK 칩이 있으면 대부분은 한 번 클릭으로 끝나고, 뒤집을 건에만 사유를 쓰면 된다. 판정이 쌓이는 속도가 곧 다음 단계로 가는 속도다.
