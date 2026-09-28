### 추가
- STAND 없는 FLIGHT의 ARRIVED 후보(OCC가 확인)와, 그것이 실적에 세지도록 LOGBOOK 줄(ATC-72, [docs/fleet.ko.md](docs/fleet.ko.md) 5.1.1). atc는 여전히 ARRIVED를 스스로 적지 않는다.
  - GitHub·Linear는 계정 하나로 쓰여서, 그 FLIGHT를 모는 팀 세션 기록의 호출(`gh pr review|comment`, `gh issue comment`, `gh api` 쓰기, Linear `save_comment`)로 팀을 안다. 시각으로 실제 GitHub 리뷰·댓글과 짝짓는다.
  - CHECK: 검토하는 팀이 출발 뒤 대상 PR에 남긴 리뷰나 PR 댓글. SURVEY: FLIGHT를 담은 문서만의 머지 PR, FLIGHT를 적은 GitHub 댓글, 결과 링크를 단 Linear 댓글. 팀을 모르거나, 다른 작성자이거나, 출발 전이면 후보가 없다.
  - 후보는 `dispatch brief`(`arrivalCandidates`: 증거, 이유, 칠 `command`)와 DISPATCH 카드의 "ARRIVED 후보"에 보인다. OCC가 증거를 확인하고 명령을 친다.
  - 직접 배정(D-xxxx 없음): 팀의 READBACK이 DEPARTURE LOG `readback` 줄(`stand: null`)이 되고, `atcctl dispatch arrived <FLIGHT> --aircraft <TEAM_X> -- '<링크>'`로 확인한다.
  - 확인된 STAND 없는 ARRIVED는 `pr` 없는 LOGBOOK `arrived` 줄(`standFree: {arrivedVia, evidence, workDoneAt, proposal}`)을 써서 TARGETS·CHECKRIDE·FUEL F4가 센다. PR만 보는 곳은 이 줄을 빼고, 옛 줄은 그대로 읽힌다.
  - `gate3.standFree.timely`: 일이 끝난 뒤 24시간 안에 확인된 STAND 없는 ARRIVED의 비율.
