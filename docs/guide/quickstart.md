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
- CROSSCHECK는 OCC와 다른 계열 모델로 돌아야 한다. 기본은 Muse Spark 1.3(`claude-ocx-opencode-go--muse-spark-1.3-contributor[1m]`)이고, 대체 모델은 GPT-5.6 Terra(`claude-ocx-native--gpt-5.6-terra`)다. DeepSeek(flash)은 flash-helper와 같은 모델이라 FLEET 규칙상 DISPATCH·SCHEDULE 판정(mark)에 쓰지 않는다(착륙 리뷰는 SUPERVISOR 결정으로 REVIEW 세션이 DeepSeek을 쓴다). 모델은 `crosscheck/.claude/settings.json`에 적혀 있고, opencodex 프록시를 거쳐야 닿는다. 그래서 `claude` 대신 아래처럼 연다(평범한 `claude`로 열면 "selected model" 오류로 멈춘다 — Claude로 몰래 돌지 않는다):

  ```bash
  cd /home/c10/projects/atc/crosscheck && env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost ocx claude --strict-mcp-config
  ```

  - `ANTHROPIC_BASE_URL`을 export해 두었으면 `ocx claude`가 그 값을 우선하고, `~/.claude/settings.json`의 `HTTPS_PROXY`(ClaudeRipple)가 로컬 프록시 요청을 가로채므로 `NO_PROXY`로 뺀다.
  - `--strict-mcp-config`는 MCP 서버를 하나도 싣지 않는다. Muse는 일부 MCP 도구 스키마(중첩 10단계 초과)를 받지 못해 두 번째 요청에서 멈추기 때문이다. 그래서 CROSSCHECK는 MCP 없이 판정한다. 본문·댓글은 `dispatch flight`로 읽고, 거기 나온 PR이 머지됐는지는 읽기 전용 `gh pr view|checks|list`로 확인한다(OCC와 같은 Bash guard 방식, 쓰는 gh 명령과 `gh pr diff`는 막힘).
  - 대체 모델로 바꾸려면 settings의 `model`을 terra id로 고친다.
  - **Claude Desktop에서 열 때**: Desktop은 settings의 `model`을 따르지 않고 앱에서 고른 모델을 쓴다. `crosscheck` 폴더로 세션을 열고 이름을 CROSSCHECK로 붙인 뒤, **앱의 모델 메뉴에서 `muse-spark-1.3-contributor`를 고르고** `/loop 10m /tick`을 입력한다. 기본 모델(opus)로 두면 예비 판정이 모두 막힌다.
  - 예비 판정(mark)을 달 때마다 guard가 그 세션의 기록에서 실제 모델을 확인한다. Muse·Terra가 아니면 막고("앱에서 모델을 Muse로 바꾸거나 터미널에서 ocx claude로 여세요"), 통과하면 그 실제 모델 이름을 mark에 남긴다. 그래서 DISPATCH·SCHEDULE 탭의 모델별 일치율에는 경로별 이름이 따로 보인다(`muse-spark-1.3-contributor`는 Desktop, `claude-ocx-…muse…`는 터미널).

  판정 방법은 [판정하기](reviewing.md)의 CROSSCHECK.

- REVIEW는 Codex가 한도에 걸렸을 때 PR을 리뷰하는 착륙 리뷰 세션이다. DeepSeek V4.1 Flash로 돈다(CROSSCHECK의 Muse와 따로). tmux `atc-review`로 연다:

  ```bash
  tmux new-session -d -s atc-review -c /home/c10/projects/atc/review 'env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost ocx claude --strict-mcp-config'
  ```

  - 그 뒤 `tmux send-keys -t atc-review '/loop 10m /tick' Enter`. Desktop에서 열면 앱의 모델 메뉴에서 `deepseek-v4.1-flash`를 고른다.
  - 리뷰를 남길 때마다 guard가 실제 모델을 확인한다. DeepSeek V4.1 Flash가 아니면 막는다. 보안·기밀 PR은 atc가 자료를 주지 않는다. 자세한 것은 [`review/README.ko.md`](../../review/README.ko.md).

## 4. 팀 세션

팀 세션은 `TEAM_A` … 처럼 이름을 붙여 연다. 이름이 곧 REGISTRATION이고, atc는 이름으로 팀을 알아본다. 새 팀은 [팀 운영](fleet.md)의 ENTRY INTO SERVICE와 CREW BRIEFING으로 꾸린다.

## 5. 화면 한 바퀴

- **RADAR**: 지금 누가 어디서 무엇을 하는지.
- **DISPATCH**·**SCHEDULE**: 판정할 것이 있는지([판정하기](reviewing.md)).
- **FLEET**: 팀 구성과 상태.

탭마다 무엇을 보여 주는지는 [화면 안내](screens.md)에 있다.
