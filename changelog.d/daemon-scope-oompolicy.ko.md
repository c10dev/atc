### 수정
- LAUNCH가 `claude`를 부르는 systemd scope(그래서 백그라운드 세션 daemon이 드는 곳)에 `OOMPolicy=continue`를 준다. 전에는 그 안의 프로세스 하나가 OOM으로 죽으면(팀 세션이 돌린 테스트 등) systemd가 scope 전체를 멈춰 백그라운드 세션이 모두 같이 끝났다(2026-09-30: 12개). 이 변경 뒤 LAUNCH가 새로 띄운 daemon부터 적용된다([docs/fleet.ko.md](docs/fleet.ko.md)).
