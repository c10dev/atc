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
| REVIEW (Codex 한도 때) | `/home/c10/projects/atc/review` | REVIEW | `/loop 10m /tick` |

- 첫 바퀴에서 `manual check`가 `CHANGED`를 내고, 세션이 지침(`CLAUDE.md`)을 읽은 뒤 `manual ack`한다. 이후 지침이 바뀌면 다음 바퀴에 스스로 다시 읽는다.
- 관제 세션은 코드를 고치지 않는다. Bash는 atc CLI·jq(OCC는 읽기 전용 `gh`도)만, MCP는 읽기 도구만 된다.
- OCC와 REVIEW는 **Claude Sonnet**(`claude-sonnet-5-5`)이다. 모델은 각 폴더의 `.claude/settings.json`이 정하고, 설정 창 AGENTS → CONTROL의 **LAUNCH**가 다른 관제 세션처럼 `claude --bg`로 띄운다. CROSSCHECK는 은퇴해 더 띄우지 않는다(ATC-371).

- REVIEW는 Codex가 한도에 걸렸을 때 PR을 리뷰하는 착륙 리뷰 세션이다. Claude Sonnet으로 돌고, LAUNCH나 `review/`에서 `claude --bg -n REVIEW --permission-mode auto --strict-mcp-config "/loop 10m /tick"`로 연다.
  - 리뷰를 남길 때마다 guard가 실제 모델을 확인한다. Claude Sonnet이 아니면 막는다. 비밀·키 경로와 FLIGHT 없는 PR은 atc가 자료를 주지 않는다. 보안 PR은 설정 창 REVIEW 줄(`externalReview.security`)이 `deepseek`(옛 이름, 뜻은 "보냄")일 때만 간다. 자세한 것은 [`review/README.ko.md`](../../review/README.ko.md).

## 4. 팀 세션

팀 세션은 `TEAM_A` … 처럼 이름을 붙여 연다. 이름이 곧 REGISTRATION이고, atc는 이름으로 팀을 알아본다. 새 팀은 [팀 운영](fleet.md)의 ENTRY INTO SERVICE와 CREW BRIEFING으로 꾸린다.

## 5. 화면 한 바퀴

- **RADAR**: 지금 누가 어디서 무엇을 하는지.
- **HOME**: 판정할 것이 있는지([판정하기](reviewing.md)).
- **FLEET**: 팀 구성과 상태.

탭마다 무엇을 보여 주는지는 [화면 안내](screens.md)에 있다.
