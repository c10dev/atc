### 추가
- UPDATE 막대(ATC-82, [docs/mcc.md](docs/mcc.md) "UPDATE bar as built"). 도는 서비스가 `origin/main`보다 뒤이면 상단에 `업데이트 있음 · c0ca22e → 4678e03 · PR 2 · CI ✓ [업데이트]`가 뜨고, 버튼이 MCC와 같은 `atc-rts` 유닛을 시작한다(MCC 모드와 상관없이). 막대가 진행을 따라간다: 시작 중, 진행 중, SSE가 다시 붙는 동안 "재시작 중"(LINK도 "끊김" 대신 "재시작"), 그다음 새 버전 알림. 거절되면 사유를 보이고, ROLLBACK 뒤에는 RTS가 멈췄다는 것과 푸는 법을 보이며, 범위가 `package*.json`이나 `deploy/*.service`·`*.timer`를 바꾸면 버튼 대신 사람이 배포해야 하는 사유를 보인다. `GET /api/update`가 상태, `POST /api/update/start`는 SUPERVISOR 전용(이 화면의 요청)이고 `mcc.jsonl`에 `{op: "rts", by: "supervisor"}`를 남긴다.
- 안내 쪽 "배포하기"(`docs/guide/deploy.md`): 막대, 그리고 손으로 배포할 때.

### 수정
- 임시 `ATC_STATE_DIR`이나 7700이 아닌 포트의 서버는 `atc-rts` 유닛(7700을 배포한다)을 시작하지 않는다. `/api/mcc/rts`도 마찬가지.
