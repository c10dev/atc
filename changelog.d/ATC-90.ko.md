### 변경
- DISPATCH가 멈춘 팀을 비어 있는 팀으로 보지 않는다(ATC-90, [docs/dispatch.ko.md](docs/dispatch.ko.md) 5.1.2). health가 `RESUME`·`STALLED`이거나, 머지된 PR이 없는 In Progress FLIGHT(`tail:` 라벨이나 쥔 STAND)를 아직 쥔 AIRCRAFT에는 새 ASSIGN을 내지 않는다.
  - "excluded"에 사유와 쥔 FLIGHT가 보인다: `TEAM_G — VOC-72 아직 진행 중(PR 없음)`, `TEAM_H — RESUME 필요(한도 풀림 22:10Z)`.
  - 쥔 FLIGHT는 WAKE만큼 슬롯을 쓴다. 슬롯이 남은 팀은 그 안에 드는 FLIGHT를 받을 수 있고, STAND 없는 FLIGHT(SURVEY·CHECK)는 FLIGHT를 쥔 팀도 받는다.
  - 그런 AIRCRAFT의 열린 제안은 `AIRCRAFT 멈춤 — …`으로 SUPERSEDED된다. SUPERVISOR 판정이 아니라서 24시간 짝 규칙을 시작하지 않는다.
