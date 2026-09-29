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
| REVIEW (Codex 한도 때) | `/home/c10/projects/atc/review` | REVIEW | `/loop 10m /tick` |

- 첫 바퀴에서 `manual check`가 `CHANGED`를 내고, 세션이 지침(`CLAUDE.md`)을 읽은 뒤 `manual ack`한다. 이후 지침이 바뀌면 다음 바퀴에 스스로 다시 읽는다.
- 관제 세션은 코드를 고치지 않는다. Bash는 atc CLI·jq(OCC는 읽기 전용 `gh`도, CROSSCHECK는 atc CLI 중 읽기와 `crosscheck` 명령만)만, MCP는 읽기 도구만 된다.
- CROSSCHECK는 OCC와 다른 모델로 돈다. OCC는 Claude Sonnet, CROSSCHECK는 **Claude Opus**(`claude-opus-5-5`)다. REVIEW는 **Claude Sonnet**(`claude-sonnet-5-5`)이다. 모델은 각 폴더의 `.claude/settings.json`이 정하고, 설정 창 AGENTS → CONTROL의 **LAUNCH**가 다른 관제 세션처럼 `claude --bg`로 띄운다. 손으로 열 때는 그 폴더에서:

  ```bash
  claude --bg -n CROSSCHECK --permission-mode auto --strict-mcp-config "/loop 10m /tick"
  ```

  - `--strict-mcp-config`는 MCP 서버를 싣지 않는다. CROSSCHECK는 본문·댓글을 `dispatch flight`로 읽고, PR이 머지됐는지는 읽기 전용 `gh pr view|checks|list`로 확인한다(쓰는 gh 명령과 `gh pr diff`는 막힘).
  - 예비 판정(mark)을 달 때마다 guard가 그 세션의 기록에서 실제 모델을 확인한다. Claude Opus가 아니면 막고, 통과하면 그 실제 모델 이름을 mark에 남긴다. Desktop에서 열면 앱의 모델 메뉴에서 Opus를 고른다.
  - 2026-09-29 전에는 `ocx claude`로 Muse Spark 1.3·GPT-5.6 Terra에 돌렸다. 그 길은 끊었다. 옛 mark는 모델별 일치율에 `muse-spark-1.3`으로 따로 보인다.

  판정 방법은 [판정하기](reviewing.md)의 CROSSCHECK.

- REVIEW는 Codex가 한도에 걸렸을 때 PR을 리뷰하는 착륙 리뷰 세션이다. Claude Sonnet으로 돌고, LAUNCH나 `review/`에서 `claude --bg -n REVIEW --permission-mode auto --strict-mcp-config "/loop 10m /tick"`로 연다.
  - 리뷰를 남길 때마다 guard가 실제 모델을 확인한다. Claude Sonnet이 아니면 막는다. 비밀·키 경로와 FLIGHT 없는 PR은 atc가 자료를 주지 않는다. 보안 PR은 설정 창 REVIEW 줄(`externalReview.security`)이 `deepseek`(옛 이름, 뜻은 "보냄")일 때만 간다. 자세한 것은 [`review/README.ko.md`](../../review/README.ko.md).

## 4. 팀 세션

팀 세션은 `TEAM_A` … 처럼 이름을 붙여 연다. 이름이 곧 REGISTRATION이고, atc는 이름으로 팀을 알아본다. 새 팀은 [팀 운영](fleet.md)의 ENTRY INTO SERVICE와 CREW BRIEFING으로 꾸린다.

## 5. 화면 한 바퀴

- **RADAR**: 지금 누가 어디서 무엇을 하는지.
- **DISPATCH**·**SCHEDULE**: 판정할 것이 있는지([판정하기](reviewing.md)).
- **FLEET**: 팀 구성과 상태.

탭마다 무엇을 보여 주는지는 [화면 안내](screens.md)에 있다.
