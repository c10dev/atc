### 변경
- DUTY가 1M context 창으로 돈다: `duty/settings.json`의 `model`이 `claude-sonnet-5-5`(200k) 대신 `claude-sonnet-5-5[1m]`이라, 긴 근무도 Claude Code가 대화를 압축하기 전에 들어간다([docs/duty.md](docs/duty.md) 3, 7절). 이미 떠 있는 DUTY 프로세스는 다시 뜰 때(유휴 종료, NEW SHIFT, 재시작)까지 옛 모델을 쓴다. 설정은 `user` 등급이다.
