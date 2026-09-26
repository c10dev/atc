# 빠른 시작

## 1. atc 띄우기

atc는 systemd 사용자 서비스로 늘 떠 있다. 주소는 `http://localhost:7700`.

```bash
systemctl --user status atc      # 상태
systemctl --user restart atc     # 코드가 바뀐 뒤 (빌드 포함)
journalctl --user -u atc -f      # 로그
```

처음 설치할 때는 저장소 README의 "실행" 절을 따른다. Linear 티켓을 보려면 `.env.local`에 `LINEAR_API_KEY`가 있어야 한다.

## 2. 점유 hook 확인

팀 세션이 어느 워크트리에서 일하는지는 Claude Code의 PostToolUse hook(`hooks/claim.mjs`)이 기록한다. `~/.claude/settings.json`에 설치돼 있어야 RADAR에 IDENTIFIED 점유가 뜬다. 없으면 대화 기록으로 추정한 ESTIMATED TRACK만 보인다.

## 3. 관제 세션 열기

| 세션 | 폴더 | 세션 이름 | 입력 |
|---|---|---|---|
| TOWER | `/home/c10/projects/atc/controller` | TOWER | `/loop 3m /tick` |
| OCC | `/home/c10/projects/atc/occ` | OCC | `/loop 10m /tick` |
| CROSSCHECK (선택) | `/home/c10/projects/atc/crosscheck` | CROSSCHECK | `/loop 10m /tick` |

- 첫 바퀴에서 `manual check`가 `CHANGED`를 내고, 세션이 지침(`CLAUDE.md`)을 읽은 뒤 `manual ack`한다. 이후 지침이 바뀌면 다음 바퀴에 스스로 다시 읽는다.
- 관제 세션은 코드를 고치지 않는다. Bash는 atc CLI·jq(OCC는 읽기 전용 `gh`도, CROSSCHECK는 atc CLI 중 읽기와 `crosscheck` 명령만)만, MCP는 읽기 도구만 된다.
- CROSSCHECK는 OCC와 다른 계열 모델(gpt-5.6-terra)로 돌아야 한다. `crosscheck/.claude/settings.json`에 모델이 적혀 있고, opencodex 프록시를 거쳐야 그 모델에 닿는다. 그래서 `claude` 대신 아래처럼 연다(평범한 `claude`로 열면 "selected model" 오류로 멈춘다 — 다른 모델로 몰래 돌지 않는다):

  ```bash
  cd /home/c10/projects/atc/crosscheck && env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost ocx claude
  ```

  `ANTHROPIC_BASE_URL`을 export해 두었으면 `ocx claude`가 그 값을 우선하고, `~/.claude/settings.json`의 `HTTPS_PROXY`(ClaudeRipple)가 로컬 프록시 요청을 가로채므로 `NO_PROXY`로 뺀다. 세션 안에서 모델을 물으면 `claude-ocx-native--gpt-5.6-terra`라고 답한다. 판정 방법은 [판정하기](reviewing.md)의 CROSSCHECK.

## 4. 팀 세션

팀 세션은 `TEAM_A` … 처럼 이름을 붙여 연다. 이름이 곧 REGISTRATION이고, atc는 이름으로 팀을 알아본다. 새 팀은 [팀 운영](fleet.md)의 ENTRY INTO SERVICE와 CREW BRIEFING으로 꾸린다.

## 5. 화면 한 바퀴

- **RADAR**: 지금 누가 어디서 무엇을 하는지.
- **DISPATCH**·**SCHEDULE**: 판정할 것이 있는지([판정하기](reviewing.md)).
- **FLEET**: 팀 구성과 상태.

탭마다 무엇을 보여 주는지는 [화면 안내](screens.md)에 있다.
