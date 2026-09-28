### 추가
- OCC SCHEDULE `TAIL` 작업(ATC-68, [docs/occ.ko.md](docs/occ.ko.md) "TAIL as built", [docs/fleet.ko.md](docs/fleet.ko.md) "TAIL drafts as built"). DISPATCH 밖에서 한 배정이 손으로 붙이는 대신 `tail:TEAM_X` 라벨로 남는다.
  - `atcctl schedule draft TAIL <FLIGHT> <TEAM_X> -- <근거>`. payload는 REGISTRATION 하나다. REGISTRATION이 `teamPattern`에 맞지 않거나, FLEET에 없거나 RETIRED이면, Linear에 `tail:TEAM_X` 라벨이 없으면(ENGINEERING이나 사용자가 만든다. 읽기 전용 라벨 조회 `server/sources/linear-labels.ts`), FLIGHT에 이미 그 `tail:`이 있으면 atc가 받지 않는다. CLASSIFY·PRIORITIZE와 달리 닫히지 않은 FLIGHT면 된다.
  - 발부는 `save_issue` 하나에 `addLabels`(새 `tail:`)와 `removeLabels`(다른 `tail:`), 그리고 `[OCC S-xxxx]` 댓글이다. 나머지 라벨은 `lane:`까지 그대로 두고 상태·담당은 건드리지 않는다. 다음 Linear 읽기에 라벨이 보이면 APPLIED.
  - 다른 팀의 `tail:`을 그 팀이 AIRBORNE이거나 그 FLIGHT의 STAND를 쥔 채 바꾸면 초안에 CAUTION이 붙는다.
  - `schedule brief`의 `candidates.tail`: `tail:` 없이 팀이 몰고 있는 열린 FLIGHT와 그 근거(STAND, 최근 7일 DEPARTURE LOG, DISPATCH ASSIGN이나 TOWER CLEARANCE의 READBACK). atc는 이것으로 초안을 쓰지 않는다.
  - SCHEDULE 탭은 TAIL 카드를 PRIORITIZE처럼 보인다(지금 `tail:`, 바뀔 것, CAUTION, 수동 반영 안내). TAIL 후보 목록도 있고, TAIL 판정은 S2 진입 점검에 센다. OCC SCHEDULE 절차에 "TAIL 전에"가 생겼다.
  - SCHEDULE 탭 후보의 메타 줄이 줄바꿈된다. 긴 CLOSE 줄이 390 px에서 화면을 가로로 밀었다.
  - 되돌린 옛 atc가 `schedule.jsonl`을 읽으면 `TAIL` 줄을 건너뛰지 않는다: 다음 브리핑에 열린 TAIL 초안을 SUPERSEDED로(발부된 것은 APPLIED로) 닫는다. Linear에는 쓰지 않는다.
