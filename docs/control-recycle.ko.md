# CONTROL STOP CHECK: 관제 세션 STOP 확인과 중복 경고 (ATC-521)

[control-recycle.md](control-recycle.md) 5절의 한국어 요약이다(그 문서의 나머지는 영어판만 있다).

CONTROL STOP·CONTROL RECYCLE·APPLY NOW는 `claude stop`이 종료 코드 0이면 `ok: true`로 기록했다. 2026-10-02 22:26의 RECYCLE이 MCC job 4d8c68ae(acct-1)를 "멈췄다"고 기록했지만 그 `state.json`은 끝내 `stopped`가 되지 않았고(마지막 줄 22:22 `done`), 10-03 08:45에 깨어나 PR #527을 착륙시킨 뒤 새 MCC 옆에서 같이 tick했다. atc는 그것을 몰랐다.

- **STOP을 확인한다.** 백그라운드 관제 세션에 `claude stop`이 종료 코드 0으로 돌아오면, `stopControl`(FLEET STOP 단추, 일괄 STOP, RECYCLE, APPLY NOW가 모두 거치는 한 함수)이 그 job의 `state.json`을 최대 20초 다시 읽는다. `stopped`일 때만 `ok: true`이고, 아니면 `ok: false`, `unverified: true`와 따로 적은 사유(`claude stop은 종료 코드 0이었지만 job state.json이 done이라 …`)가 남는다. `claude stop 실패`와 다른 글이다. tmux pane 멈춤은 그대로다.
- **RECYCLE은 종료 코드만 믿고 새로 띄우지 않는다.** 확인이 안 된 STOP이면 `performRecycle`은 `result: "stop-unverified"`로 끝나고 `launchControl`을 부르지 않는다.
- **알림 둘, 모두 WARNING.** `control|unverified|<세션>|<job>`: 최근 6시간에 막은 STOP의 job이 지금도 `stopped`가 아니고 SUPERVISOR가 오탐으로 표시하지 않은 것(job이 `stopped`가 되면 저절로 사라진다). `control|duplicate|<세션>`: 같은 관제 이름의 살아 있는 job이 둘 이상 — STALE이 아니고, state가 `stopped`가 아니고, `state.json`을 쓴 지 60분 안(`DUP_RECENT_MIN`). 글에 관제 세션, job id, ACCOUNT, state가 든다. 10-01의 끝난 STALE 유령 줄은 세지 않는다.
- **스위치 하나, 기본 on.** 설정 창 OPERATIONS의 CONTROL STOP CHECK 블록(`control-stop-check.json`의 `controlStopCheck`). SUPERVISOR만(이 화면의 Origin) 바꾼다. atcctl 명령도 관제 세션의 변경도 없다. 끄면 옛 판정(종료 코드)으로 돌아가고 중복 검사가 빠진다. 바꾸면 FLIGHT RECORDER에 `policy control-stop-check-mode`로 남는다. 선언이 `server/switches/`에 있어 이 PR은 `user` 등급이다.
- **오작동 수.** 결정마다 FLIGHT RECORDER에 `control stop-check` 줄이 남는다: `blocked`(검사가 ok를 막음), `duplicate`(중복 WARNING), `contradicted`(나중에 검사가 틀렸다고 드러남: 막은 job이 뒤늦게 `stopped`가 됨, 중복 경고가 2분 안에 저절로 풀림), `dismissed`(SUPERVISOR가 `오탐으로 표시`). 설정 블록에 최근 7일·30일 수, 오탐 몫(contradicted·dismissed인 서로 다른 결정 ÷ blocked + duplicate), 지금 열린 중복, 최근 결정 다섯 줄이 보인다.
