### 추가
- CAPTAIN 보고 판정(Jev): atc AIRCRAFT의 턴이 끝날 때 판정 계열이 CAPTAIN의 마지막 메시지를 분류한다(끝났다고 보고, 결정을 청함, 일하다 멈춤, 놀고 있고 준비됨, 알 수 없음). 그림자 전용(ATC-89, [docs/fleet.ko.md](docs/fleet.ko.md) 8.8).
  - 같은 스위치(`off`면 아무것도 보내지 않음)와 1분 3건 공유 한도. `ATCC` AIRCRAFT만 읽고, 그 확인이 어떤 읽기보다 먼저다. 경로·URL·이메일·토큰을 가려 최대 1,500자만 나가고, 메시지는 저장하지 않는다(`sent: {chars}`).
  - `judges.jsonl`에 `target: "report"` 줄. FLEET 줄에 칩, 카드에 SUPERVISOR가 맞음·틀림을 표시하는 `JEV REPORT` 줄, FLEET PLAN 패널에 일치율.
  - "결정을 청함" 확률이 0.7(`judges.json`의 `reportDecisionMin`) 이상이면 턴마다 `info` `report` 문제 하나가 FLIGHT FOLLOWING에 붙는다(OCC 매뉴얼 `following.md` 행). health 코드, DISPATCH, FLEET PLAN은 바뀌지 않는다.
