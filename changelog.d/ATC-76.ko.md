### 추가
- FLEET가 AIRCRAFT마다 세션 출처와 permission mode를 보이고, STOP·RESTART·REFRESH는 백그라운드 세션에만 한다(ATC-76, [docs/fleet.ko.md](docs/fleet.ko.md) 8.5.2). 2026-09-28에 interactive 팀 세션 10개가 모두 데스크톱 세션이었고, 출처가 조종·계정·수명·2b 전달을 갈랐다.
  - 출처: 세션의 `kind`가 백그라운드면 `background`, 아니면 프로세스 명령줄과 부모의 것을 pid마다 한 번 `/proc`에서 읽는다(읽기만, 신호·attach 없음, 계정 정보 없음). `~/.claude/remote/…`면 `desktop`, 그냥 `claude`면 `terminal`, 그 밖은 `unknown`. permission mode는 `--permission-mode`에서, 백그라운드 세션은 그 세션을 띄운 LAUNCH 기록에서 읽는다. 관제 세션 LAUNCH 기록에도 이제 `permissionMode`가 있다.
  - `GET /api/fleet`의 AIRCRAFT마다 `origin`과 `permissionMode`가 있다. FLEET 목록 줄과 카드에 `BG`·`DESKTOP`·`TERM`·`?`와 permission mode가 `BG <id>` 대신 보인다(id는 툴팁). 백그라운드가 아닌 세션의 카드에는 그 출처의 손 절차가, ACCOUNT 줄에는 BG·DESKTOP 세션이 어느 로그인을 따르는지가 보인다.
  - 카드의 STOP, `POST /api/fleet/:registration/stop`, FLEET PLAN 실행(STOP, RESTART, REFRESH, RETIRE의 세션 멈춤)은 출처가 `background`인지 본다. 다른 출처는 그 출처의 손 절차와 함께 거절한다(Claude 앱에서 닫기, 터미널에서 `/exit`, `/clear` 뒤 CREW BRIEFING 붙여 넣기).
  - `GET /api/dispatch/brief`에 제안 AIRCRAFT마다 `delivery`가 있다. AIRCRAFT의 permission mode가 OCC와 다르면 DISPATCH 카드와 IN FLIGHT 줄에 `MODE <m> ≠ OCC <m>`이 뜬다. 그 세션이 FLIGHT PLAN을 사용자 승인까지 붙들 수 있어서다. 막지 않는다.
